"""Explicit public projections. Nothing internal (hashes, raw secrets, other customers) leaves here."""

from app.agent.actions import REGISTRY
from app.agent.core import Ctx
from app.agent.policy import explain, explain_signal
from app.models import Message, Plan


def message_view(m: Message) -> dict:
    return {"id": m.id, "at": m.at, "role": m.role, "text": m.text, "lang": m.lang, "plan_id": m.plan_id,
            "cards": m.cards}


def plan_view(plan: Plan, ctx: Ctx) -> dict:
    steps = []
    for s in plan.steps:
        action = REGISTRY.get(s["action"])
        resolved = s.get("resolved")
        text = action.describe(ctx, resolved) if action and resolved else s["action"]
        error = s.get("error")
        steps.append({
            "id": s["id"], "action": s["action"], "status": s.get("status") or "new", "tier": s.get("tier"),
            "rule": s.get("rule"), "rule_text": explain(s["rule"], ctx.lang) if s.get("rule") else None,
            "signals": [explain_signal(x, ctx.lang) for x in s.get("signals", [])],
            "text": text, "after": s.get("after", []), "run_at": s.get("run_at_resolved"),
            "error": (error.get("zh") if ctx.lang == "zh" else error.get("en")) if error else None,
            "error_code": error.get("code") if error else None,
            "irreversible": bool(s.get("irreversible")),
            "fen": (resolved or {}).get("fen"),
        })
    return {"id": plan.id, "status": plan.status, "tier": plan.tier, "source": plan.source, "flags": plan.flags,
            "approval_hash": plan.approval_hash if plan.status == "awaiting_approval" else None,
            "ask": plan.ask, "steps": steps, "created_at": plan.created_at, "request": plan.request}
