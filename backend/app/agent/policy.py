"""Permission tiers (docs/SPEC.md §3). Fixed code; the model has no input into these decisions."""

from datetime import date

from app.agent import locks
from app.agent.core import Action, Ctx, higher, tier_of
from app.bank import ledger

DAILY_LIMIT_FEN = 100_000  # ¥1,000: at or under is yellow, over is red
NEW_PAYEE_FEN = 50_000  # over ¥500 in total to a payee added in the last 24 hours raises to red

RULE_TEXT = {
    "G_QUERY": ("只读查询，自动执行", "Read-only query, runs automatically"),
    "Y_SMALL_PAYMENT": ("当日累计付款不超过 ¥1,000，需确认", "Today's payments stay at or under ¥1,000: confirmation needed"),
    "R_LARGE_PAYMENT": ("当日累计付款超过 ¥1,000，需强验证", "Today's payments go over ¥1,000: strong verification needed"),
    "Y_SUBSCRIPTION": ("订阅查询与管理，需确认", "Subscription query or change: confirmation needed"),
    "Y_COLLECTION": ("发起 AA 收款，需确认", "Split-bill request: confirmation needed"),
    "Y_CARD_APPLY": ("申请新卡，需确认", "Card application: confirmation needed"),
    "Y_RISK_REDUCING": ("降低风险的卡片设置，需确认", "Makes a card safer: confirmation needed"),
    "R_RISK_INCREASING": ("提高风险的卡片设置，需强验证", "Makes a card more usable: strong verification needed"),
    "R_CARD_LOSS": ("挂失，需强验证", "Card loss report: strong verification needed"),
    "Y_INTERNAL_MOVE": ("本人账户间划转，需确认", "Move between your own accounts: confirmation needed"),
    "Y_WEALTH_REDEEM": ("理财赎回，需确认", "Investment redemption: confirmation needed"),
    "Y_PROFILE_CHANGE": ("更新风险测评，需确认", "Risk profile update: confirmation needed"),
    "Y_PAYEE_ADD": ("新增收款人，需确认", "New payee: confirmation needed"),
    "R_INVESTMENT": ("理财申购，需强验证", "Investment purchase: strong verification needed"),
    "R_CREDENTIAL": ("修改密码，需强验证", "Credential change: strong verification needed"),
    "Y_TRANSFER_CANCEL": ("撤销尚未到账的转账，需确认", "Cancel a transfer before it arrives: confirmation needed"),
}
SIGNAL_TEXT = {
    "S_NEW_PAYEE_LARGE": ("向 24 小时内新加的收款人累计付款超过 ¥500", "Over ¥500 in total to a payee added in the last 24 hours"),
    "S_FLAGGED_REQUEST": ("请求中有试图绕过安全规则的内容", "The request tried to get around the safety rules"),
    "S_FLAGGED_CONTENT": ("上传的小票里有隐藏文字或给机器的指令", "The uploaded receipt contains hidden text or instructions aimed at a machine"),
}


def decide(ctx: Ctx, action: Action, resolved: dict, *, pay_day: date, earlier_same_day_fen: int = 0,
           earlier_to_payee_fen: int = 0, flagged: bool = False, already_counted_fen: int = 0) -> dict:
    rule = action.rule_for(ctx, resolved)
    payment = action.payment(resolved) if action.payment else 0
    signals: list[str] = []
    day_total = None
    if rule == "PAYMENT":
        day_total = (ledger.payments_on(ctx.session, ctx.user.id, pay_day) - already_counted_fen
                     + earlier_same_day_fen + payment)
        rule = "Y_SMALL_PAYMENT" if day_total <= DAILY_LIMIT_FEN else "R_LARGE_PAYMENT"
    tier = tier_of(rule)
    if payment and resolved.get("payee_new") and resolved.get("payee_id"):
        # in total, so two ¥400 payments to a payee added today count as ¥800
        to_payee = ledger.paid_to(ctx.session, ctx.user.id, resolved["payee_id"]) + earlier_to_payee_fen + payment
        if to_payee > NEW_PAYEE_FEN:
            signals.append("S_NEW_PAYEE_LARGE")
            tier = higher(tier, "red")
    if flagged and tier == "yellow":
        signals.append("S_FLAGGED_REQUEST")
        tier = "red"
    if resolved.get("content_flags") and tier != "green":
        signals.append("S_FLAGGED_CONTENT")
        tier = "red"
    lock = locks.blocks(locks.active(ctx.session, ctx.user.id), tier=tier, payment=bool(payment)) \
        if tier != "green" else None
    return {"tier": tier, "rule": rule, "signals": signals, "day_total_fen": day_total,
            "payment_fen": payment, "blocked_by": lock.reason if lock else None}


SAFER_ARRIVAL_SIGNALS = ("S_NEW_PAYEE_LARGE", "S_FLAGGED_REQUEST", "S_FLAGGED_CONTENT")


def safer_arrival(action: Action, resolved: dict, decision: dict) -> str | None:
    """A transfer with a risk signal arrives in 2 hours instead of now, so the customer can still cancel it.
    Fixed code: the model can neither ask for nor skip this."""
    if action.name == "transfer" and resolved.get("arrival", "instant") == "instant" \
            and any(s in decision["signals"] for s in SAFER_ARRIVAL_SIGNALS):
        return "standard"
    return None


def explain(rule: str, lang: str) -> str:
    zh, en = RULE_TEXT.get(rule, (rule, rule))
    return zh if lang == "zh" else en


def explain_signal(signal: str, lang: str) -> str:
    zh, en = SIGNAL_TEXT.get(signal, (signal, signal))
    return zh if lang == "zh" else en
