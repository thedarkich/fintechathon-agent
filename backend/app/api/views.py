"""Explicit public projections. Nothing internal (hashes, raw secrets, other customers) leaves here."""

from app.agent.actions import REGISTRY
from app.agent.core import Ctx
from app.agent.policy import explain, explain_signal
from app.bank import transfers
from app.models import Message, Plan
from app.money import yuan


def message_view(m: Message) -> dict:
    return {"id": m.id, "at": m.at, "role": m.role, "text": m.text, "lang": m.lang, "plan_id": m.plan_id,
            "cards": m.cards}


def details(ctx: Ctx, action: str, r: dict | None) -> list[dict]:
    """The facts a customer checks before saying yes, as label and value pairs (the confirmation card).
    Actions not listed here are shown by their one-line description instead."""
    if not r:
        return []
    zh = ctx.lang == "zh"

    def row(label_zh: str, label_en: str, value: str) -> dict:
        return {"label": label_zh if zh else label_en, "value": value}

    if action in ("transfer", "schedule_transfer"):
        who = r["payee"] if zh else r["payee_en"]
        note = r.get("payee_note") if zh else r.get("payee_note_en")
        if note:
            who += f"（{note}）" if zh else f" ({note})"
        bank = r["bank"] if zh else transfers.bank_en(r["bank"])
        rows = [row("收款人", "To", who), row("收款账户", "Account", f"{bank} ****{r['account_tail']}"),
                row("金额", "Amount", yuan(r["fen"]))]
        if action == "transfer":
            rows.append(row("付款账户", "From", r["source"] if zh else r["source_en"]))
            arrival = r.get("arrival", "instant")
            text = {"instant": ("实时到账", "Now"), "standard": ("2 小时后", "In 2 hours"),
                    "next_day": ("次日凌晨", "Early tomorrow")}[arrival][0 if zh else 1]
            if arrival != "instant":
                text += "，到账前可以撤销" if zh else "; you can cancel until then"
            rows.append(row("到账", "Arrives", text))
        else:
            when = r["run_at"][:16].replace("T", " ")
            if r.get("repeat") == "monthly":
                when += "，每月重复" if zh else ", every month"
            rows.append(row("时间", "When", when))
        if r.get("memo"):
            rows.append(row("备注", "Note", r["memo"]))
        return rows
    if action == "merchant_order":
        rows = [row("商品", "Item", f"{r['item_name'] if zh else r['item_name_en']}（{r['shop'] if zh else r['shop_en']}）"),
                row("金额", "Amount", yuan(r["fen"])), row("送达", "Delivered", r["deliver_on"])]
        if r.get("recipient"):
            rows.append(row("收货人", "For", r["recipient"]["name"] if zh else r["recipient"]["name_en"]))
        rows.append(row("付款", "Paid from", r["pay_from_label"] if zh else r.get("pay_from_label_en", r["pay_from_label"])))
        return rows
    if action == "collect":
        names = ("、" if zh else ", ").join(p["name"] if zh else p["name_en"] for p in r["people"])
        return [row("向谁收款", "From", names), row("总额", "Total", yuan(r["total_fen"])),
                row("每人", "Each pays", yuan(r["share_fen"]))]
    if action == "reserve_create":
        rows = [row("名称", "Name", r["name"]), row("金额", "Amount", yuan(r["fen"]))]
        if r.get("release_on"):
            rows.append(row("没用完的钱", "Unused money", f"{r['release_on']} 后退回活期" if zh else f"returns after {r['release_on']}"))
        return rows
    if action in ("wealth_subscribe", "wealth_redeem"):
        rows = [row("产品", "Product", r["product"] if zh else r["product_en"]), row("金额", "Amount", yuan(r["fen"]))]
        if r.get("arrives_on"):
            rows.append(row("到账", "Arrives", r["arrives_on"]))
        return rows
    if action == "subscription_cancel":
        return [row("取消", "Cancel", r["merchant"]), row("每期", "Each charge", yuan(r["fen"]))]
    if action == "transfer_cancel":
        return [row("撤销给", "Transfer to", r["payee"] if zh else r["payee_en"]), row("金额", "Amount", yuan(r["fen"]))]
    return []


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
            "signal_codes": s.get("signals", []),
            "text": text, "details": details(ctx, s["action"], resolved),
            "after": s.get("after", []), "run_at": s.get("run_at_resolved"),
            "error": (error.get("zh") if ctx.lang == "zh" else error.get("en")) if error else None,
            "error_code": error.get("code") if error else None,
            "irreversible": bool(s.get("irreversible")),
            "fen": (resolved or {}).get("fen"),
        })
    return {"id": plan.id, "status": plan.status, "tier": plan.tier, "source": plan.source, "flags": plan.flags,
            "approval_hash": plan.approval_hash if plan.status == "awaiting_approval" else None,
            "ask": plan.ask, "steps": steps, "created_at": plan.created_at, "request": plan.request}
