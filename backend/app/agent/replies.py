"""Everything the assistant says about the bank is written here, by code, from step results.

The model never writes an amount, a balance or an outcome. Each round reports only the steps that
changed since the last report, and the approval card carries the exact details being approved.
"""

import copy
import json

from sqlalchemy.orm.attributes import flag_modified

from app.agent import locks, policy
from app.agent.actions import REGISTRY
from app.agent.core import Ctx
from app.models import Plan

NEEDS = {"password_change": "new_password", "pin_change": "new_pin"}


def approval_card(ctx: Ctx, plan: Plan) -> dict:
    steps = []
    secrets = []
    for step in plan.steps:
        if step.get("status") != "pending":
            continue
        action = REGISTRY[step["action"]]
        if step["action"] in NEEDS:
            secrets.append(NEEDS[step["action"]])
        steps.append({
            "id": step["id"], "action": step["action"], "tier": step["tier"], "rule": step["rule"],
            "rule_text": policy.explain(step["rule"], ctx.lang),
            "signals": [policy.explain_signal(s, ctx.lang) for s in step.get("signals", [])],
            "text": action.describe(ctx, step["resolved"]),
            "run_at": step.get("run_at_resolved"),
            "day_total_fen": step.get("day_total_fen"),
        })
    return {"type": "approval", "plan_id": plan.id, "approval_hash": plan.approval_hash, "tier": plan.tier,
            "needs": "verify" if plan.tier == "red" else "confirm", "secrets": secrets, "steps": steps}


PICKED = {"subscription_cancel", "subscription_remind", "wealth_subscribe"}  # follow-ups can fill these from a list


def planned(step: dict, plan: Plan | None = None) -> str:
    """A step for the planner's memory, as it was planned: the action and the arguments taken from the customer's
    words ("妈妈", 200). Never what they resolved to in the bank's records (names, notes, accounts, merchants), so
    no account data and no outside text reaches the model through the history. A follow-up that picked from a list
    ('取消第一个') is remembered by what the customer said, since its arguments came from the list."""
    if plan is not None and plan.source == "followup" and step["action"] in PICKED:
        return f"{step['action']} (said {json.dumps(plan.request, ensure_ascii=False)})"
    args = {k: v for k, v in (step.get("args") or {}).items() if v not in (None, "", [], {})}
    return f"{step['action']} {json.dumps(args, ensure_ascii=False, sort_keys=True)}" if args else step["action"]


def compose(ctx: Ctx, plan: Plan) -> tuple[str, list[dict], str]:
    """Returns (text, cards, summary). The summary is the code-written context the planner sees next turn."""
    lines: list[str] = []
    cards: list[dict] = []
    summary: list[str] = []
    steps = copy.deepcopy(plan.steps)
    for step in steps:
        if step.get("reported") == step.get("status"):
            continue
        action = REGISTRY[step["action"]]
        status = step.get("status")
        resolved = step.get("resolved") or {}
        if status == "done":
            lines.append(action.reply(ctx, resolved, step.get("result") or {}))
            if action.card:
                card = action.card(ctx, resolved, step.get("result") or {})
                if card:
                    cards.append(card)
            summary.append(f"[done] {planned(step, plan)}")
        elif status == "failed":
            error = step.get("error") or {}
            text = error.get("zh") if ctx.lang == "zh" else error.get("en")
            if error.get("lock"):
                lock = next((x for x in locks.active(ctx.session, ctx.user.id) if x.reason == error["lock"]), None)
                if lock:
                    text = f"{text} {locks.describe(lock, ctx.lang)}"
            lines.append(text or ctx.t("这一步没有完成。", "This step did not complete."))
            summary.append(f"[failed] {step['action']}: {error.get('code')}")
        elif status == "waiting" and step.get("run_at_resolved"):
            when = step["run_at_resolved"][:16].replace("T", " ")
            lines.append(ctx.t(f"已安排：{when} 执行“{action.describe(ctx, resolved)}”。执行前会再检查一次额度和安全规则。",
                               f"Scheduled for {when}: {action.describe(ctx, resolved)}. Limits and safety rules are checked again before it runs."))
            summary.append(f"[scheduled {when}] {planned(step, plan)}")
        elif status == "compensated":
            lines.append(ctx.t(f"已撤销：{action.describe(ctx, resolved)}", f"Undone: {action.describe(ctx, resolved)}"))
            summary.append(f"[undone] {step['action']}")
        elif status in ("cancelled", "skipped"):
            lines.append(ctx.t(f"未执行：{action.describe(ctx, resolved)}" if resolved else "已取消一步。",
                               f"Not done: {action.describe(ctx, resolved)}" if resolved else "One step was cancelled."))
            summary.append(f"[{status}] {step['action']}")
        else:
            continue
        if step.get("irreversible") and status == "done" and plan.status in ("rolled_back", "failed"):
            lines.append(ctx.t("（这一步已经完成，无法自动撤销。）", "(This step had already happened and can't be undone automatically.)"))
        step["reported"] = status
    if plan.status == "clarifying" and plan.ask:
        lines.append(plan.ask["zh"] if ctx.lang == "zh" else plan.ask["en"])
        cards.append({"type": "question", "plan_id": plan.id, "field": plan.ask["field"], "options": plan.ask["options"]})
        asked = next((s for s in steps if s["id"] == plan.ask.get("step_id")), None)
        summary.append(f"[asked] {plan.ask['field']}" + (f" for {planned(asked, plan)}" if asked else ""))
    elif plan.status == "awaiting_approval":
        card = approval_card(ctx, plan)
        cards.append(card)
        # the confirmation card carries the details and the reason; the text only says what kind of yes it needs
        if plan.tier == "red":
            lines.append(ctx.t("这笔要验证身份，请核对：", "This one needs your PIN and a code. Please check:"))
        else:
            lines.append(ctx.t("请核对：", "Please check:"))
        summary.append("[awaiting approval] " + "; ".join(planned(s, plan) for s in steps if s.get("status") == "pending"))
    elif plan.status == "rolled_back":
        lines.append(ctx.t("计划未能全部完成，已撤销可以安全撤销的步骤。", "The plan couldn't finish, so I undid the steps that can be safely undone."))
    elif plan.status == "cancelled":
        lines.append(ctx.t("已停止，剩余步骤不会执行。", "Stopped. The remaining steps won't run."))
    plan.steps = steps
    flag_modified(plan, "steps")
    text = "\n".join(line for line in lines if line)
    return text, cards, " | ".join(summary)
