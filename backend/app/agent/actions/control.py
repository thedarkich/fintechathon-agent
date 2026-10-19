"""Stopping what was set up earlier, in words: a scheduled transfer, or a plan with steps still waiting to run."""

import copy
from dataclasses import replace

from pydantic import Field
from sqlmodel import select

from app.agent import audit
from app.agent.core import Action, Args, Ask, Ctx, Refuse, register
from app.agent.resolve import find_contact
from app.models import Contact, Plan, ScheduledTransfer
from app.money import yuan

# --- a scheduled transfer (one-off or monthly) ---


class ScheduledCancelArgs(Args):
    contact: str | None = Field(default=None, max_length=40)  # the contact, or the id of a scheduled transfer the bank offered


def scheduled_label(row: ScheduledTransfer, contact: Contact, lang: str) -> str:
    when = row.run_at[:16].replace("T", " ")
    if lang == "zh":
        return f"{when} 向 {contact.name} 转 {yuan(row.amount_fen)}" + ("，每月重复" if row.repeat == "monthly" else "")
    return f"{yuan(row.amount_fen)} to {contact.name_en or contact.name} on {when}" + (", every month" if row.repeat == "monthly" else "")


def scheduled_cancel_resolve(ctx: Ctx, args: ScheduledCancelArgs) -> dict:
    rows = list(ctx.session.exec(select(ScheduledTransfer).where(
        ScheduledTransfer.user_id == ctx.user.id, ScheduledTransfer.status.in_(("scheduled", "waiting_approval")))
        .order_by(ScheduledTransfer.run_at)))
    if args.contact:
        by_id = [r for r in rows if r.id == args.contact]
        if by_id:
            rows = by_id
        else:
            found = find_contact(ctx.session, ctx.user.id, args.contact)
            matches = {found.value.id} if found.value else {p.id for p in found.options}
            rows = [r for r in rows if r.contact_id in matches]
    if not rows:
        raise Refuse("NOTHING_SCHEDULED", "没有正在等待执行的预约转账。", "There is no scheduled transfer waiting to run.")
    contacts = {r.contact_id: ctx.session.get(Contact, r.contact_id) for r in rows}
    if len(rows) > 1:
        raise Ask("contact", "要停止哪一笔预约转账？", "Which scheduled transfer should I stop?",
                  [{"value": r.id, "label_zh": scheduled_label(r, contacts[r.contact_id], "zh"),
                    "label_en": scheduled_label(r, contacts[r.contact_id], "en")} for r in rows[:6]])
    row, contact = rows[0], contacts[rows[0].contact_id]
    return {"scheduled_id": row.id, "contact": contact.name, "contact_en": contact.name_en or contact.name, "fen": row.amount_fen,
            "run_at": row.run_at, "repeat": row.repeat, "status_before": row.status}


def scheduled_cancel_run(ctx: Ctx, r: dict) -> dict:
    row = ctx.session.get(ScheduledTransfer, r["scheduled_id"])
    if row is None or row.status not in ("scheduled", "waiting_approval"):
        raise Refuse("NOTHING_SCHEDULED", "这笔预约转账已经执行或停止了。", "That scheduled transfer has already run or stopped.")
    row.status, row.detail = "cancelled", "stopped by the customer"
    ctx.session.add(row)
    return {"stopped": True}


def scheduled_cancel_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    row = ctx.session.get(ScheduledTransfer, r["scheduled_id"])
    if row and row.status == "cancelled":
        row.status, row.detail = r["status_before"], None
        ctx.session.add(row)
        return {"restored": True}
    return {"restored": False}


def scheduled_cancel_describe(ctx: Ctx, r: dict) -> str:
    when = r["run_at"][:16].replace("T", " ")
    monthly = r["repeat"] == "monthly"
    return ctx.t(f"停止预约转账：{when} 向 {r['contact']} 转 {yuan(r['fen'])}" + ("，以后每月的也不再转" if monthly else ""),
                 f"Stop the scheduled transfer of {yuan(r['fen'])} to {r['contact_en']} on {when}" + (" and every month after" if monthly else ""))


register(Action(
    name="scheduled_cancel", args=ScheduledCancelArgs,
    help="Stop a scheduled or monthly transfer before it runs. contact = who it goes to (optional; the bank asks which if several).",
    resolve=scheduled_cancel_resolve, run=scheduled_cancel_run, describe=scheduled_cancel_describe,
    reply=lambda ctx, r, res: ctx.t(f"已停止，向 {r['contact']} 的预约转账不会再执行。",
                                    f"Stopped. The scheduled transfer to {r['contact_en']} will not run."),
    rule="Y_SCHEDULE_CANCEL", compensate=scheduled_cancel_compensate,
    examples=["取消每月给妈妈的转账", "stop the monthly transfer to Mom"],
))


# --- a plan with steps still waiting (the birthday plan's orders, for example) ---

TOPICS = [("生日", "birthday"), ("蛋糕", "cake"), ("花", "flower"), ("房租", "rent"), ("预留", "set aside")]


class PlanCancelArgs(Args):
    plan: str | None = Field(default=None, max_length=40)  # words from the request ('生日', 'birthday') or a plan id
    undo: bool = False  # also undo the steps already done, where they can be (money set aside comes back)


def plan_label(p: Plan) -> str:
    return f"“{p.request[:28]}” · {p.created_at[5:16].replace('T', ' ')}"


def plan_cancel_resolve(ctx: Ctx, args: PlanCancelArgs) -> dict:
    plans = [p for p in ctx.session.exec(select(Plan).where(Plan.user_id == ctx.user.id, Plan.status == "scheduled")
                                         .order_by(Plan.created_at.desc()))
             if ctx.plan is None or p.id != ctx.plan.id]
    if args.plan:
        key = args.plan.strip().casefold()
        words = next((pair for pair in TOPICS if key in pair or any(w in key for w in pair)), (key,))
        matching = [p for p in plans if p.id == args.plan or any(w in p.request.casefold() for w in words)]
        plans = matching or plans  # nothing matches: offer every waiting plan rather than none
    if not plans:
        raise Refuse("NOTHING_TO_STOP", "没有正在等待执行的计划。", "There is no plan waiting to run.")
    if len(plans) > 1:
        raise Ask("plan", "要停止哪一个计划？", "Which plan should I stop?",
                  [{"value": p.id, "label_zh": plan_label(p), "label_en": plan_label(p)} for p in plans[:6]])
    p = plans[0]
    waiting = [s for s in p.steps if s.get("status") in ("pending", "waiting")]
    done = [s for s in p.steps if s.get("status") == "done" and s["action"] not in ("contact_lookup",)]
    return {"plan_id": p.id, "request": p.request[:60], "waiting": len(waiting), "done": len(done), "undo": args.undo}


def plan_cancel_run(ctx: Ctx, r: dict) -> dict:
    # the executor imports every action, so importing it at the top would be a cycle
    from app.agent import executor

    target = ctx.session.get(Plan, r["plan_id"])
    if target is None or target.status != "scheduled":
        raise Refuse("NOTHING_TO_STOP", "这个计划已经执行完或已停止。", "That plan has already finished or stopped.")
    sub = replace(ctx, plan=target)
    steps = copy.deepcopy(target.steps)
    stopped = 0
    for step in steps:
        if step.get("status") in ("pending", "waiting"):
            step["status"] = "cancelled"
            stopped += 1
    undone = executor.compensate(sub, target, steps) if r["undo"] else 0
    target.status, target.ask = ("rolled_back" if undone else "cancelled"), None
    executor.save(target, steps)
    ctx.session.add(target)
    audit.append(ctx.session, ctx.user.id, "cancelled", {"stopped": stopped, "compensated": undone, "rollback": r["undo"],
                                                         "by_plan": ctx.plan.id if ctx.plan else None}, target.id)
    return {"stopped": stopped, "undone": undone}


def plan_cancel_describe(ctx: Ctx, r: dict) -> str:
    undo = r["undo"] and r["done"]
    return ctx.t(f"停止计划“{r['request']}”：还没执行的 {r['waiting']} 步不再执行" + (f"，并撤销已完成的 {r['done']} 步" if undo else ""),
                 f"Stop the plan “{r['request']}”: its {r['waiting']} remaining step(s) will not run"
                 + (f", and the {r['done']} finished step(s) are undone" if undo else ""))


def plan_cancel_reply(ctx: Ctx, r: dict, res: dict) -> str:
    text = ctx.t(f"已停止计划“{r['request']}”，{res['stopped']} 步不再执行", f"Stopped “{r['request']}”: {res['stopped']} step(s) will not run")
    if res["undone"]:
        text += ctx.t(f"，已撤销 {res['undone']} 步（预留的钱已退回）", f", and {res['undone']} step(s) were undone (money set aside is back)")
    elif r["done"] and not r["undo"]:
        text += ctx.t("。已完成的步骤保持不变，需要的话可以说“撤销这个计划”。", ". Finished steps stay as they are; say “undo the plan” to reverse them too")
    return text + ctx.t("。", ".")


register(Action(
    name="plan_cancel", args=PlanCancelArgs,
    help="Stop a plan whose steps are still waiting to run (e.g. the birthday orders). plan = words from it ('生日', "
         "'birthday') or its id; undo = also undo finished steps where possible.",
    resolve=plan_cancel_resolve, run=plan_cancel_run, describe=plan_cancel_describe, reply=plan_cancel_reply,
    rule="Y_STOP_PLAN",
    examples=["停止生日计划", "cancel the birthday plan and give the money back"],
))
