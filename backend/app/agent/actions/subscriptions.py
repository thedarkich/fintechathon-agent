"""Recurring charges and direct debits. The brief lists subscription queries as yellow, so they are."""

from pydantic import Field

from app import clock
from app.agent.core import Action, Args, Ask, Ctx, Refuse, register
from app.agent.resolve import find_subscription
from app.bank import analysis
from app.bank.categories import label
from app.models import Subscription
from app.money import yuan


def subscriptions_run(ctx: Ctx, r: dict) -> dict:
    subs = analysis.refresh_subscriptions(ctx.session, ctx.user.id, ctx.today)
    trials = set(analysis.new_trials(subs, ctx.today))
    return {
        "items": [{"id": s.id, "merchant": s.merchant, "fen": s.amount_fen, "cycle": s.cycle, "status": s.status,
                   "next_charge_on": s.next_charge_on, "category": s.category, "new": s.id in trials,
                   "remind_days_before": s.remind_days_before, "charges": s.charges}
                  for s in subs],
        "overlaps": analysis.overlaps(subs),
        "monthly_fen": analysis.monthly_cost(subs),
    }


def subscriptions_reply(ctx: Ctx, r: dict, res: dict) -> str:
    active = [s for s in res["items"] if s["status"] == "active"]
    if not active:
        return ctx.t("没有发现正在扣费的订阅。", "No active recurring charges found.")
    cycle = {"monthly": ctx.t("每月", "monthly"), "yearly": ctx.t("每年", "yearly")}
    lines = [ctx.t(f"发现 {len(active)} 项自动扣费，约合每月 {yuan(res['monthly_fen'])}：",
                   f"{len(active)} recurring charges, about {yuan(res['monthly_fen'])} a month:")]
    for s in active:
        lines.append(f"· {s['merchant']} {yuan(s['fen'])} {cycle[s['cycle']]}" + ctx.t(f"，下次 {s['next_charge_on']}", f", next {s['next_charge_on']}")
                     + (ctx.t("（近期新开通）", " (started recently)") if s["new"] else ""))
    for group in res["overlaps"]:
        kind = ctx.t("音乐" if group["group"] == "music" else "视频", "music" if group["group"] == "music" else "video")
        names = "、".join(group["merchants"]) if ctx.lang == "zh" else ", ".join(group["merchants"])
        lines.append(ctx.t(f"提示：您同时订阅了 {len(group['merchants'])} 个{kind}会员（{names}），可以考虑取消一个。",
                           f"Tip: you pay for {len(group['merchants'])} {kind} services ({names}); you might cancel one."))
    return "\n".join(lines)


register(Action(
    name="subscriptions", args=Args,
    help="List recurring charges / direct debits found in transactions, with overlaps (paying twice) and recently started ones.",
    resolve=lambda ctx, a: {}, run=subscriptions_run,
    describe=lambda ctx, r: ctx.t("查看自动扣费与订阅（涉及扣款授权，按规则需确认）", "Show subscriptions and direct debits (debit authorisations, so this needs confirmation)"),
    reply=subscriptions_reply, rule="Y_SUBSCRIPTION",
    card=lambda ctx, r, res: {"type": "subscriptions", **res},
    examples=["我有哪些自动续费", "what subscriptions am I paying for"],
))


class SubArgs(Args):
    merchant: str | None = Field(default=None, max_length=40)


def pick(ctx: Ctx, text: str | None) -> Subscription:
    found = find_subscription(ctx.session, ctx.user.id, text or "")
    if not text and found.value is None:
        found.options = list(analysis.refresh_subscriptions(ctx.session, ctx.user.id, ctx.today))
        found.options = [s for s in found.options if s.status == "active"]
        if len(found.options) == 1:
            return found.options[0]
    if found.ambiguous:
        raise Ask("merchant", "是哪一项订阅？", "Which subscription?",
                  [{"value": s.merchant, "label_zh": f"{s.merchant} {yuan(s.amount_fen)}", "label_en": f"{s.merchant} {yuan(s.amount_fen)}"}
                   for s in found.options])
    if found.value is None:
        if not text:
            raise Refuse("SUB_NOT_FOUND", "没有正在扣费的订阅。", "There are no active subscriptions.")
        raise Refuse("SUB_NOT_FOUND", f"没有找到正在扣费的“{text}”。", f"No active subscription matches “{text}”.")
    return found.value


def sub_fields(s: Subscription) -> dict:
    return {"subscription_id": s.id, "merchant": s.merchant, "fen": s.amount_fen, "cycle": s.cycle,
            "next_charge_on": s.next_charge_on, "category": s.category, "remind": s.remind_days_before}


def cancel_run(ctx: Ctx, r: dict) -> dict:
    sub = ctx.session.get(Subscription, r["subscription_id"])
    sub.status, sub.cancelled_at = "cancelled", clock.iso(ctx.now)
    ctx.session.add(sub)
    return {"cancelled": True, "next_charge_on": r["next_charge_on"]}


register(Action(
    name="subscription_cancel", args=SubArgs, help="Cancel a recurring charge / direct debit by merchant name or kind (music, video); without one the bank asks which.",
    resolve=lambda ctx, a: sub_fields(pick(ctx, a.merchant)), run=cancel_run,
    describe=lambda ctx, r: ctx.t(f"取消 {r['merchant']} 的自动扣费（{yuan(r['fen'])}，{label(r['category'], 'zh')}），{r['next_charge_on']} 起不再扣款",
                                  f"Cancel the {r['merchant']} recurring charge ({yuan(r['fen'])}); no charge from {r['next_charge_on']}"),
    reply=lambda ctx, r, res: ctx.t(f"已取消 {r['merchant']} 的自动扣费，{r['next_charge_on']} 不会再扣款。",
                                    f"Cancelled {r['merchant']}. There will be no charge on {r['next_charge_on']}."),
    rule="Y_SUBSCRIPTION",
    examples=["取消爱奇艺会员", "cancel my QQ music"],
))


class RemindArgs(Args):
    merchant: str | None = Field(default=None, max_length=40)
    days_before: int = Field(default=3, ge=1, le=30)


def remind_run(ctx: Ctx, r: dict) -> dict:
    sub = ctx.session.get(Subscription, r["subscription_id"])
    sub.remind_days_before = r["days_before"]
    ctx.session.add(sub)
    return {"days_before": r["days_before"]}


def remind_reply(ctx: Ctx, r: dict, res: dict) -> str:
    from datetime import date

    days, due = r["days_before"], r["next_charge_on"]
    if (date.fromisoformat(due) - ctx.today).days < days:  # this charge is too close to be reminded about
        return ctx.t(f"好的，{r['merchant']} 每次续费前 {days} 天会提醒您。这次扣费（{due}）已不足 {days} 天，从下一次续费开始提醒。",
                     f"Done: I'll remind you {days} days before {r['merchant']} renews. The next charge ({due}) is less than "
                     f"{days} days away, so the reminders start with the one after.")
    return ctx.t(f"好的，{r['merchant']} 续费前 {days} 天会提醒您（下次扣费 {due}）。",
                 f"Done: I'll remind you {days} days before {r['merchant']} renews (next charge {due}).")


def remind_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    sub = ctx.session.get(Subscription, r["subscription_id"])
    sub.remind_days_before = r["remind"]
    ctx.session.add(sub)
    return {"restored": True}


register(Action(
    name="subscription_remind", args=RemindArgs, help="Remind before a subscription renews. merchant (or kind, or none to be asked), days_before 1-30.",
    resolve=lambda ctx, a: {**sub_fields(pick(ctx, a.merchant)), "days_before": a.days_before}, run=remind_run,
    describe=lambda ctx, r: ctx.t(f"{r['merchant']} 续费前 {r['days_before']} 天提醒我", f"Remind me {r['days_before']} days before {r['merchant']} renews"),
    reply=remind_reply, rule="Y_SUBSCRIPTION", compensate=remind_compensate,
))
