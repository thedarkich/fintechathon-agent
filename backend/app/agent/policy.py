"""Permission tiers (docs/SPEC.md §3). Fixed code; the model has no input into these decisions."""

from datetime import date

from app.agent import locks
from app.agent.core import Action, Ctx, higher, tier_of
from app.bank import ledger

DAILY_LIMIT_FEN = 100_000  # ¥1,000: at or under is yellow, over is red
NEW_PAYEE_FEN = 50_000  # over ¥500 in total to a payee added in the last 24 hours raises to red

# The reason each rule gives, in plain words; the card itself says what is needed (nothing, a tap, PIN and code).
RULE_TEXT = {
    "G_QUERY": ("只是查询，直接办好", "Just a question, answered right away"),
    "Y_SMALL_PAYMENT": ("今天累计付款不超过 ¥1,000", "Today's payments stay at or under ¥1,000"),
    "R_LARGE_PAYMENT": ("今天累计付款将超过 ¥1,000", "Today's payments would go over ¥1,000"),
    "Y_SUBSCRIPTION": ("涉及你的自动扣费授权", "It involves your automatic payments"),
    "Y_COLLECTION": ("会向朋友发起收款", "It asks your friends for money"),
    "Y_CARD_APPLY": ("会为你申请一张新卡", "It applies for a new card"),
    "Y_RISK_REDUCING": ("会让卡片更安全", "It makes a card safer"),
    "R_RISK_INCREASING": ("会让卡片重新可用，或能花更多钱", "It makes a card usable again or able to spend more"),
    "R_CARD_LOSS": ("挂失后这张卡会永久停用", "Reporting a card lost stops it for good"),
    "Y_INTERNAL_MOVE": ("在你自己的账户之间转钱", "It moves money between your own accounts"),
    "Y_WEALTH_REDEEM": ("会赎回你的理财", "It sells an investment"),
    "Y_PROFILE_CHANGE": ("会更新你的风险测评", "It updates your risk profile"),
    "Y_PAYEE_ADD": ("会添加一位新收款人", "It adds a new payee"),
    "R_INVESTMENT": ("买理财必须确认是你本人", "Buying an investment must be you"),
    "R_CREDENTIAL": ("改密码必须确认是你本人", "Changing a password must be you"),
    "Y_TRANSFER_CANCEL": ("会撤销一笔还没到账的转账", "It cancels a transfer that hasn't arrived"),
    "Y_SCHEDULE_CANCEL": ("会停止一笔预约转账", "It stops a scheduled transfer"),
    "Y_STOP_PLAN": ("会停止一个还在等待执行的计划", "It stops a plan that is still waiting to run"),
    "Y_BOOKING": ("订座会记在你名下", "A booking is made in your name"),
}
SIGNAL_TEXT = {
    "S_NEW_PAYEE_LARGE": ("向 24 小时内新加的收款人累计付款超过 ¥500", "Over ¥500 in total to a payee added in the last 24 hours"),
    "S_FLAGGED_REQUEST": ("请求中有试图绕过安全规则的内容", "The request tried to get around the safety rules"),
    "S_FLAGGED_CONTENT": ("上传的小票里有隐藏文字或给机器的指令", "The uploaded receipt contains hidden text or instructions aimed at a machine"),
    "S_NAME_MISMATCH": ("收款账户的户名和你填写的姓名不一致", "The account is in a different name from the payee you chose"),
    "S_SCAM_PURPOSE": ("你选的用途是常见的诈骗情形", "The purpose you chose is a common scam"),
}

# What a risky payment is for, asked of the customer on the slip (never filled in by the AI). Each answer
# brings the warning that fits it; the scam purposes also raise the tier and hold the money until tomorrow.
PURPOSES = {
    "family": ("家人或朋友", "Family or friends",
               "如果对方是用新号码或短信找你要钱，请先打 TA 平时的电话确认。",
               "If they asked by text or from a new number, call them on the number you already know first."),
    "goods": ("买东西或付服务费", "Buying something",
              "二手买卖请用平台的担保交易付款。卖家要求直接银行转账，是常见的骗局。",
              "For second-hand buys, pay through the platform's own checkout. A seller asking for a direct bank transfer is a common scam."),
    "investment": ("别人推荐的投资", "An investment someone recommended",
                   "网上认识的人推荐的“投资机会”是最常见的诈骗。正规理财请在本行“理财”页购买。",
                   "“Investment opportunities” from people met online are the most common scam. Buy real investments on your bank's Invest page."),
    "safe_account": ("转到“安全账户”", "Moving money to a “safe account”",
                     "警察和银行绝不会让你把钱转到“安全账户”。这是诈骗，请不要转。",
                     "Police and banks never ask you to move money to a “safe account”. This is a scam: don't send it."),
    "fee": ("贷款、退款或中奖的手续费", "A fee to get a loan, refund or prize",
            "要你先交钱才能放贷、退款或领奖的，都是诈骗。",
            "Being asked to pay first to get a loan, a refund or a prize is always a scam."),
    "other": ("其他", "Something else",
              "转出前请确认你认识收款人，钱一旦到账很难追回。",
              "Make sure you know who you're paying: money is hard to get back once it arrives."),
}
SCAM_PURPOSES = ("investment", "safe_account", "fee")
# a payment carrying one of these must say what it is for before it can be approved
PURPOSE_SIGNALS = ("S_NEW_PAYEE_LARGE", "S_NAME_MISMATCH")


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
    if payment and resolved.get("payee_new"):
        # in total, so two ¥400 payments to a payee added today count as ¥800; a phone number never paid has nothing yet
        paid = ledger.paid_to(ctx.session, ctx.user.id, resolved["payee_id"]) if resolved.get("payee_id") else 0
        to_payee = paid + earlier_to_payee_fen + payment
        if to_payee > NEW_PAYEE_FEN:
            signals.append("S_NEW_PAYEE_LARGE")
            tier = higher(tier, "red")
    if payment and resolved.get("name_check") == "mismatch":
        signals.append("S_NAME_MISMATCH")
        tier = higher(tier, "red")
    if payment and resolved.get("purpose") in SCAM_PURPOSES:
        signals.append("S_SCAM_PURPOSE")
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


SAFER_ARRIVAL_SIGNALS = ("S_SCAM_PURPOSE", "S_NEW_PAYEE_LARGE", "S_NAME_MISMATCH", "S_FLAGGED_REQUEST", "S_FLAGGED_CONTENT")


def safer_arrival(action: Action, resolved: dict, decision: dict) -> tuple[str, str] | None:
    """A transfer with a risk signal arrives in 2 hours instead of now, so the customer can still cancel it;
    one for a scam purpose waits until tomorrow. Returns (arrival, the signal behind it), never a faster arrival
    than the customer chose. Fixed code: the model can neither ask for nor skip this."""
    if action.name not in ("transfer", "phone_transfer"):
        return None
    chosen = resolved.get("arrival", "instant")
    reason = next((s for s in SAFER_ARRIVAL_SIGNALS if s in decision["signals"]), None)
    if reason == "S_SCAM_PURPOSE" and chosen != "next_day":
        return "next_day", reason
    if reason and chosen == "instant":
        return "standard", reason
    return None


def purpose_needed(action: Action, resolved: dict, decision: dict) -> bool:
    return bool(action.payment) and action.name in ("transfer", "phone_transfer") \
        and any(s in decision["signals"] for s in PURPOSE_SIGNALS)


def purpose_options(lang: str) -> list[dict]:
    return [{"value": key, "label": zh if lang == "zh" else en} for key, (zh, en, _, _) in PURPOSES.items()]


def explain(rule: str, lang: str) -> str:
    zh, en = RULE_TEXT.get(rule, (rule, rule))
    return zh if lang == "zh" else en


def explain_signal(signal: str, lang: str) -> str:
    zh, en = SIGNAL_TEXT.get(signal, (signal, signal))
    return zh if lang == "zh" else en
