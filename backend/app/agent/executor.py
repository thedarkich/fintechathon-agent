"""Plan lifecycle (docs/SPEC.md §6).

prepare: resolve every step against the customer's records, decide its tier, run green queries
         whose inputs are ready, and ask for approval of the rest.
approve: the exact approved details (by hash) at the approved tier, verified when red.
execute: run steps in dependency order, committing after each. A failing step rolls back its own
         partial work and the plan's earlier steps are compensated where that is safe.
"""

import copy
import hashlib
import hmac
import re
from dataclasses import replace
from datetime import date, datetime, time, timedelta

from pydantic import ValidationError
from sqlalchemy.orm.attributes import flag_modified

from app import clock
from app.agent import audit, policy
from app.agent.actions import REGISTRY
from app.agent.core import TIERS, Ask, Ctx, Refuse
from app.bank.ledger import BankError
from app.clock import CST
from app.models import Conversation, Notification, Plan, now_iso

MAX_STEPS = 8
REF = re.compile(r"^\$(s\d{1,2})\.([a-z_]+)$")
FINISHED = {"done", "failed", "cancelled", "skipped", "compensated"}


class PlanError(Exception):
    def __init__(self, status: int, code: str, en: str, zh: str):
        super().__init__(en)
        self.status, self.code, self.en, self.zh = status, code, en, zh


def save(plan: Plan, steps: list[dict]) -> None:
    plan.steps = copy.deepcopy(steps)
    plan.updated_at = now_iso()
    flag_modified(plan, "steps")


def order(steps: list[dict]) -> list[dict]:
    done, result = set(), []
    remaining = list(steps)
    while remaining:
        for step in remaining:
            if all(d in done for d in step.get("after", [])):
                result.append(step)
                done.add(step["id"])
                remaining.remove(step)
                break
        else:
            raise PlanError(422, "CYCLE", "The plan's steps depend on each other in a loop.", "计划步骤存在循环依赖。")
    return result


def substitute(value, results: dict):
    if isinstance(value, str):
        match = REF.match(value)
        if match and match.group(1) in results and match.group(2) in (results[match.group(1)] or {}):
            return results[match.group(1)][match.group(2)]
        return value
    if isinstance(value, dict):
        return {k: substitute(v, results) for k, v in value.items()}
    if isinstance(value, list):
        return [substitute(v, results) for v in value]
    return value


def run_time(ctx: Ctx, step: dict, results: dict) -> datetime | None:
    spec = step.get("run_at")
    if not spec:
        return None
    if isinstance(spec, dict):
        source, _, field_name = str(spec.get("ref", "")).partition(".")
        base = (results.get(source) or {}).get(field_name)
        if not base:
            raise Refuse("BAD_SCHEDULE", "无法确定执行时间。", "I couldn't work out when to run this step.")
        day = clock.to_date(base) + timedelta(days=int(spec.get("offset_days", 0)))
        moment = datetime.combine(day, time(9, 0), CST)
    else:
        value = str(spec)
        moment = clock.parse(value.replace(" ", "T")) if len(value) > 10 else datetime.combine(
            date.fromisoformat(value), time(9, 0), CST)
    return moment if moment > ctx.now else None


def approval_hash(plan: Plan, steps: list[dict]) -> str:
    pending = [(s["id"], s["action"], s.get("resolved"), s.get("tier"), s.get("run_at_resolved"))
               for s in steps if s.get("status") == "pending"]
    body = audit.canonical([plan.id, pending])
    return hashlib.sha256(body.encode()).hexdigest()


def results_of(steps: list[dict]) -> dict:
    return {s["id"]: s.get("result") for s in steps if s.get("status") == "done"}


def fail_step(ctx: Ctx, plan: Plan, step: dict, code: str, zh: str, en: str) -> None:
    step.update(status="failed", error={"code": code, "zh": zh, "en": en})
    audit.append(ctx.session, ctx.user.id, "step_failed", {"step": step["id"], "action": step["action"], "code": code}, plan.id)


def prepare(ctx: Ctx, plan: Plan) -> Plan:
    ctx.plan = plan
    steps = copy.deepcopy(plan.steps)
    results = results_of(steps)
    earlier_by_day: dict[date, int] = {}
    earlier_by_contact: dict[str | None, int] = {}
    plan.ask = None
    for step in order(steps):
        if step.get("status") in FINISHED:
            continue
        action = REGISTRY[step["action"]]
        try:
            parsed = action.args.model_validate(substitute(step["args"], results))
        except ValidationError as exc:
            fields = sorted({str(e["loc"][0]) for e in exc.errors() if e["loc"]})
            fail_step(ctx, plan, step, "BAD_ARGS", f"参数无效：{', '.join(fields)}", f"Invalid details: {', '.join(fields)}")
            plan.status = "failed"
            save(plan, steps)
            return plan
        try:
            resolved = action.resolve(ctx, parsed)
            when = run_time(ctx, step, results)
        except Ask as ask:
            plan.status = "clarifying"
            plan.ask = {"step_id": step["id"], "field": ask.field, "zh": ask.zh, "en": ask.en, "options": ask.options}
            audit.append(ctx.session, ctx.user.id, "clarification", {"step": step["id"], "field": ask.field,
                                                                     "options": len(ask.options)}, plan.id)
            save(plan, steps)
            return plan
        except Refuse as refusal:
            fail_step(ctx, plan, step, refusal.code, refusal.zh, refusal.en)
            plan.status = "failed"
            save(plan, steps)
            return plan
        step["resolved"] = resolved
        step["run_at_resolved"] = clock.iso(when) if when else None
        audit.append(ctx.session, ctx.user.id, "resolution", {"step": step["id"], "action": step["action"],
                                                              "resolved": resolved}, plan.id)
        pay_day = date.fromisoformat(resolved["pay_day"]) if resolved.get("pay_day") else (
            when.date() if when else ctx.today)
        contact = resolved.get("contact_id")
        decision = policy.decide(ctx, action, resolved, pay_day=pay_day,
                                 earlier_same_day_fen=earlier_by_day.get(pay_day, 0),
                                 earlier_to_contact_fen=earlier_by_contact.get(contact, 0), flagged=bool(plan.flags))
        if action.payment:
            earlier_by_day[pay_day] = earlier_by_day.get(pay_day, 0) + decision["payment_fen"]
            earlier_by_contact[contact] = earlier_by_contact.get(contact, 0) + decision["payment_fen"]
        if later := policy.safer_arrival(action, resolved, decision):  # shown on the slip and covered by its hash
            resolved.update(arrival=later,
                            arrival_reason=next(s for s in decision["signals"] if s in policy.SAFER_ARRIVAL_SIGNALS))
        step.update(tier=decision["tier"], rule=decision["rule"], signals=decision["signals"],
                    day_total_fen=decision["day_total_fen"])
        audit.append(ctx.session, ctx.user.id, "policy", {"step": step["id"], **decision}, plan.id)
        if decision["blocked_by"]:
            fail_step(ctx, plan, step, "LOCKED", "安全锁已开启，该操作暂时不能执行。",
                      "A safety lock is on, so this step can't run right now.")
            step["error"]["lock"] = decision["blocked_by"]
            plan.status = "failed"
            save(plan, steps)
            return plan
        deps_done = all(d in results for d in step.get("after", []))
        if action.query and when is None and deps_done:
            step["result"] = action.run(ctx, resolved)
            step["status"] = "done"
            results[step["id"]] = step["result"]
            audit.append(ctx.session, ctx.user.id, "step_done", {"step": step["id"], "action": step["action"]}, plan.id)
            after_run(ctx, plan, step)
        else:
            step["status"] = "pending"
    pending = [s for s in steps if s.get("status") == "pending"]
    if not pending:
        plan.status = "done"
    else:
        plan.tier = max((s["tier"] for s in pending), key=lambda t: TIERS[t])
        plan.status = "awaiting_approval"
        plan.approval_hash = approval_hash(plan, steps)
        audit.append(ctx.session, ctx.user.id, "approval_requested",
                     {"tier": plan.tier, "steps": [s["id"] for s in pending], "hash": plan.approval_hash}, plan.id)
    save(plan, steps)
    return plan


def approve(ctx: Ctx, plan: Plan, supplied_hash: str, *, verified: bool, method: str | None = None) -> Plan:
    if plan.status != "awaiting_approval" or not plan.approval_hash:
        raise PlanError(409, "NOT_AWAITING", "This plan is not waiting for approval.", "该计划不在待确认状态。")
    if not hmac.compare_digest(supplied_hash or "", plan.approval_hash):
        raise PlanError(409, "PLAN_CHANGED", "The plan changed. Review it again.", "计划内容已变化，请重新确认。")
    if plan.tier == "red" and not verified:
        raise PlanError(403, "VERIFICATION_REQUIRED", "This needs strong verification.", "该操作需要强验证。")
    steps = copy.deepcopy(plan.steps)
    for step in steps:
        if step.get("status") == "pending":
            step["approved_tier"] = step["tier"]
    plan.approved_at = now_iso()
    if verified:
        plan.verified_at = plan.approved_at
    save(plan, steps)
    audit.append(ctx.session, ctx.user.id, "approved", {"tier": plan.tier, "verified": verified, "method": method,
                                                        "hash": plan.approval_hash}, plan.id)
    ctx.session.commit()
    return execute(ctx, plan)


def after_run(ctx: Ctx, plan: Plan, step: dict) -> None:
    scheduled_id = (step.get("meta") or {}).get("scheduled_id")
    if scheduled_id:
        from app.agent.scheduler import scheduled_done

        scheduled_done(ctx, scheduled_id)
    if step["action"] == "handoff":
        conversation = ctx.session.get(Conversation, plan.conversation_id)
        if conversation:
            conversation.escalated = True
            conversation.escalated_reason = (step.get("resolved") or {}).get("reason") or "customer"
            ctx.session.add(conversation)
        audit.append(ctx.session, ctx.user.id, "operator", {"event": "escalated"}, plan.id)


def execute(ctx: Ctx, plan: Plan) -> Plan:
    ctx.plan = plan
    plan_id = plan.id
    steps = copy.deepcopy(plan.steps)
    plan.status = "running"
    failure = None
    reapprove = False
    for step in order(steps):
        if step.get("status") not in ("pending", "waiting"):
            continue
        states = {s["id"]: s.get("status") for s in steps}
        deps = [states.get(d) for d in step.get("after", [])]
        if any(state in ("failed", "cancelled", "skipped", "compensated") for state in deps):
            step["status"] = "skipped"
            continue
        if any(state != "done" for state in deps):
            step["status"] = "waiting"
            continue
        if step.get("run_at_resolved") and clock.parse(step["run_at_resolved"]) > ctx.now:
            step["status"] = "waiting"
            continue
        action = REGISTRY[step["action"]]
        resolved = substitute(step["resolved"], results_of(steps))
        # a scheduled step runs as of its scheduled time, even if the demo clock jumped past it
        step_ctx = replace(ctx, now=clock.parse(step["run_at_resolved"])) if step.get("run_at_resolved") else ctx
        pay_day = date.fromisoformat(resolved["pay_day"]) if resolved.get("pay_day") else step_ctx.today
        decision = policy.decide(step_ctx, action, resolved, pay_day=pay_day, flagged=bool(plan.flags))
        if decision["blocked_by"]:
            fail_step(ctx, plan, step, "LOCKED", "安全锁已开启，该步骤未执行。", "A safety lock is on, so this step did not run.")
            failure = step
            break
        if TIERS[decision["tier"]] > TIERS[step.get("approved_tier", "green")]:
            step.update(status="pending", tier=decision["tier"], rule=decision["rule"], signals=decision["signals"],
                        day_total_fen=decision["day_total_fen"])
            audit.append(ctx.session, ctx.user.id, "policy", {"step": step["id"], "recheck": True, **decision}, plan_id)
            reapprove = True
            continue
        audit.append(ctx.session, ctx.user.id, "step_started", {"step": step["id"], "action": step["action"]}, plan_id)
        save(plan, steps)
        ctx.session.commit()
        try:
            step["result"] = action.run(step_ctx, resolved)
        except (BankError, Refuse) as exc:
            ctx.session.rollback()
            plan = ctx.session.get(Plan, plan_id)
            ctx.plan = plan
            fail_step(ctx, plan, step, exc.code, exc.zh, exc.en)
            failure = step
            break
        except Exception:
            ctx.session.rollback()
            plan = ctx.session.get(Plan, plan_id)
            ctx.plan = plan
            fail_step(ctx, plan, step, "INTERNAL", "执行出错，该步骤没有生效。", "Something went wrong; this step had no effect.")
            failure = step
            break
        step["status"] = "done"
        step["resolved"] = resolved
        audit.append(ctx.session, ctx.user.id, "step_done", {"step": step["id"], "action": step["action"],
                                                             "result": step["result"]}, plan_id)
        after_run(ctx, plan, step)
        save(plan, steps)
        ctx.session.commit()
    if failure is not None:
        for step in steps:
            if step.get("status") in ("pending", "waiting"):
                step["status"] = "skipped"
        compensated = compensate(ctx, plan, steps)
        plan.status = "rolled_back" if compensated else "failed"
    elif reapprove:
        pending = [s for s in steps if s.get("status") == "pending"]
        plan.tier = max((s["tier"] for s in pending), key=lambda t: TIERS[t])
        plan.status = "awaiting_approval"
        plan.approval_hash = approval_hash(plan, steps)
        audit.append(ctx.session, ctx.user.id, "approval_requested",
                     {"tier": plan.tier, "steps": [s["id"] for s in pending], "recheck": True}, plan_id)
        notify(ctx, f"plan:{plan_id}:reapprove:{plan.approval_hash[:8]}", "info",
               "计划中的一步需要您再次确认", "A step in your plan needs approval again",
               "执行前复核发现当天累计金额已超过 ¥1,000，需要强验证。", "A check before running found today's total is now over ¥1,000, so it needs strong verification.")
    elif any(s.get("status") == "waiting" for s in steps):
        plan.status = "scheduled"
    else:
        plan.status = "done"
    save(plan, steps)
    ctx.session.commit()
    return plan


def compensate(ctx: Ctx, plan: Plan, steps: list[dict]) -> int:
    count = 0
    results = results_of(steps)
    for step in reversed(order(steps)):
        if step.get("status") != "done":
            continue
        action = REGISTRY[step["action"]]
        if action.query:
            continue
        if action.compensate is None:
            step["irreversible"] = True
            continue
        try:
            outcome = action.compensate(ctx, substitute(step["resolved"], results), step.get("result") or {})
        except (BankError, Refuse):
            step["irreversible"] = True
            continue
        step["status"] = "compensated"
        step["compensation"] = outcome
        audit.append(ctx.session, ctx.user.id, "compensated", {"step": step["id"], "action": step["action"],
                                                               "outcome": outcome}, plan.id)
        count += 1
    return count


def cancel(ctx: Ctx, plan: Plan, *, rollback: bool) -> Plan:
    ctx.plan = plan
    if plan.status in ("cancelled", "rolled_back"):
        raise PlanError(409, "ALREADY_STOPPED", "This plan was already stopped.", "该计划已停止。")
    if plan.status in ("done", "failed") and not rollback:
        raise PlanError(409, "ALREADY_FINISHED", "This plan has finished. Ask me to undo it instead.", "该计划已完成，可以选择撤销。")
    steps = copy.deepcopy(plan.steps)
    stopped = 0
    for step in steps:
        if step.get("status") in ("pending", "waiting"):
            step["status"] = "cancelled"
            stopped += 1
    compensated = compensate(ctx, plan, steps) if rollback else 0
    plan.status = "rolled_back" if compensated else "cancelled"
    plan.ask = None
    audit.append(ctx.session, ctx.user.id, "cancelled", {"stopped": stopped, "compensated": compensated,
                                                         "rollback": rollback}, plan.id)
    save(plan, steps)
    ctx.session.commit()
    return plan


def answer(ctx: Ctx, plan: Plan, value) -> Plan:
    if plan.status != "clarifying" or not plan.ask:
        raise PlanError(409, "NO_QUESTION", "There is no open question on this plan.", "该计划没有待回答的问题。")
    steps = copy.deepcopy(plan.steps)
    step = next(s for s in steps if s["id"] == plan.ask["step_id"])
    field_name = plan.ask["field"]
    options = plan.ask.get("options") or []
    if options and "value" in options[0] and value not in [o["value"] for o in options]:
        raise PlanError(422, "BAD_CHOICE", "Pick one of the offered choices.", "请从给出的选项中选择。")
    name, _, index = field_name.partition(".")
    if index:
        step["args"][name][int(index)] = value
    elif field_name == "risk_assessment":
        pass
    else:
        step["args"][field_name] = value
    audit.append(ctx.session, ctx.user.id, "clarification", {"step": step["id"], "field": field_name, "answered": True}, plan.id)
    save(plan, steps)
    plan.status = "clarifying"
    return prepare(ctx, plan)


def edit(ctx: Ctx, plan: Plan, step_id: str, args: dict) -> Plan:
    if plan.status != "awaiting_approval":
        raise PlanError(409, "NOT_EDITABLE", "Only a plan waiting for approval can be edited.", "只有待确认的计划可以修改。")
    steps = copy.deepcopy(plan.steps)
    step = next((s for s in steps if s["id"] == step_id), None)
    if step is None or step.get("status") != "pending":
        raise PlanError(404, "STEP_NOT_FOUND", "That step can't be edited.", "该步骤不能修改。")
    action = REGISTRY[step["action"]]
    merged = {**step["args"], **args}
    try:
        action.args.model_validate(merged)
    except ValidationError:
        raise PlanError(422, "BAD_ARGS", "Those details are not valid.", "修改内容无效。") from None
    step["args"] = merged
    for key in ("resolved", "tier", "rule", "signals", "status", "approved_tier"):
        step.pop(key, None)
    audit.append(ctx.session, ctx.user.id, "edited", {"step": step_id, "fields": sorted(args)}, plan.id)
    save(plan, steps)
    return prepare(ctx, plan)


def notify(ctx: Ctx, key: str, kind: str, title: str, title_en: str, body: str, body_en: str,
           suggestion: str | None = None, suggestion_en: str | None = None) -> None:
    from sqlmodel import select

    exists = ctx.session.exec(select(Notification).where(Notification.user_id == ctx.user.id, Notification.key == key)).first()
    if exists:
        return
    ctx.session.add(Notification(user_id=ctx.user.id, key=key, at=clock.iso(ctx.now), kind=kind, title=title,
                                 title_en=title_en, body=body, body_en=body_en, suggestion=suggestion,
                                 suggestion_en=suggestion_en))
    audit.append(ctx.session, ctx.user.id, "notification", {"key": key, "kind": kind})
