"""Follow-ups: a short message that leans on the request before it.

'再转100', '改成300', '爸爸也一样', '算了', '那这个月呢', '餐饮呢', '那借记卡呢', '取消第一个', '就买第二个'.
Fixed code completes the message from the conversation's latest request (the arguments it was planned with
and, for lists, what it showed). The completed request then goes through the same checks, rules and
confirmation as any other; nothing here can approve or run anything, and the AI is not involved.
It only acts on clear cues; anything else goes to the planner as before.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlmodel import Session, select

from app.agent.offline import (
    CATEGORY_WORDS,
    amounts,
    card_hint,
    has,
    one,
    payee_from,
    unclear_amount,
)
from app.agent.planner import PlanOut
from app.models import Message, Plan, Subscription

TRANSFER = {"transfer", "phone_transfer", "schedule_transfer"}
SPENDING = {"spending", "report", "transactions"}
CARD = {"card_freeze", "card_unfreeze", "card_limit", "card_restrict", "card_report_lost"}
PICKS = {"wealth_recommend", "wealth_products", "wealth_compare"}
SUBS = {"subscriptions", "subscription_cancel", "subscription_remind"}

STOP_WORDS = (r"算了|不转了|不用了|不要了|先不(?:转|办|用)?了?|别转了|不办了|取消这笔|取消|cancel(?: it| that)?|never ?mind|"
              r"forget (?:it|that)|no,? don't|don't do it")
STOP = re.compile(rf"(?:(?:{STOP_WORDS})[\s。.!！,，吧了]*)+", re.I)  # '算了，不转了': only stop words, nothing else
AMEND = re.compile(r"改成|改为|换成|变成|不对|应该是|make it|change (it|that) to|actually", re.I)
AGAIN = re.compile(r"再|又|另外|\banother\b|\bmore\b|\bagain\b", re.I)
SAME = re.compile(r"也|一样|同样|照样|\bsame\b|\btoo\b|\bas well\b|\balso\b", re.I)
PRONOUN = re.compile(r"她|他|\bTA\b|\bher\b|\bhim\b|\bthem\b", re.I)
FOLLOW = re.compile(r"呢[?？。！!]*$|^那|^(and|what about|how about)\b|[?？]$", re.I)
TRANSFER_WORDS = ("转", "打", "汇", "send", "transfer", "pay")
CARD_VERBS = ("冻结", "解冻", "挂失", "限额", "开通", "关闭", "开启", "freeze", "unfreeze", "lock", "unlock", "limit", "lost", "turn on", "turn off")
BUY = ("买", "申购", "要", "选", "就", "buy", "take", "go with", "get")

ORDINALS = {"一": 1, "1": 1, "二": 2, "两": 2, "2": 2, "三": 3, "3": 3, "四": 4, "4": 4, "五": 5, "5": 5}
EN_ORDINALS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5}


def ordinal(text: str) -> int | None:
    """'第二个' → 2, 'the first one' → 1, '最后一个' → -1."""
    if m := re.search(r"第\s*([一二两三四五1-5])", text):
        return ORDINALS[m.group(1)]
    if m := re.search(r"\b(first|second|third|fourth|fifth)\b", text, re.I):
        return EN_ORDINALS[m.group(1).lower()]
    if re.search(r"最后一个|\bthe last( one)?\b", text, re.I):
        return -1
    return None


def pick(items: list, n: int):
    return items[n - 1 if n > 0 else -1] if items and abs(n) <= len(items) else None


@dataclass
class Followup:
    plan: PlanOut | None = None          # the completed request
    stop: Plan | None = None             # an open request this message replaces or stops
    note: tuple[str, str] | None = None  # a reply instead of a plan (zh, en)


def latest(session: Session, conversation_id: str) -> Plan | None:
    return session.exec(select(Plan).where(Plan.conversation_id == conversation_id)
                        .order_by(Plan.created_at.desc()).limit(1)).first()


def resolve(session: Session, user_id: str, conversation_id: str, text: str) -> Followup | None:
    prior = latest(session, conversation_id)
    if prior is None or not prior.steps:
        return None
    t = text.strip()
    first = prior.steps[0]
    action, args = first["action"], dict(first.get("args") or {})
    is_open = prior.status in ("awaiting_approval", "clarifying")
    if STOP.fullmatch(t):
        if is_open:
            return Followup(stop=prior, note=("好的，这一笔已取消，什么都没有办。", "Done: that's cancelled, and nothing was carried out."))
        return None
    if action in TRANSFER:
        return transfer(prior, action, args, t, is_open)
    if action in SPENDING:
        return spending(action, args, t)
    if action in CARD:
        return card(action, args, t)
    if action in PICKS:
        return product(first, t, previous_words(session, conversation_id))
    if action in SUBS:
        return subscription(session, user_id, t)
    return None


def transfer(prior: Plan, action: str, args: dict, t: str, is_open: bool) -> Followup | None:
    if unclear_amount(t):
        return None  # '-100': the planner asks for the amount
    payee = args.get("payee") or args.get("phone")
    if not payee:
        return None
    money = amounts(t)
    named = payee_from(PRONOUN.sub(" ", t))  # '再给她转50' names nobody new
    same_person = named is None or named == payee
    # '改成300', '不对，转500': the open card is replaced by one with the new amount
    if AMEND.search(t) and len(money) == 1 and same_person:
        return Followup(plan=one(action if action != "phone_transfer" else "transfer", {**without(args, "phone"), "payee": payee, "amount_yuan": money[0]}),
                        stop=prior if is_open else None)
    # '再转100', '再给她转50', 'send her another 50': the same person again
    if (AGAIN.search(t) or (PRONOUN.search(t) and has(t, *TRANSFER_WORDS))) and len(money) == 1 and same_person:
        return Followup(plan=one("transfer", {"payee": payee, "amount_yuan": money[0]}))
    # '爸爸也一样', '也给爸爸转一笔', 'same for Dad': someone else, the same amount unless a new one is said
    if SAME.search(t) and named and named != payee:
        return Followup(plan=one("transfer", {"payee": named, "amount_yuan": money[0] if len(money) == 1 else args.get("amount_yuan")}))
    return None


def without(args: dict, *keys: str) -> dict:
    return {k: v for k, v in args.items() if k not in keys}


def spending(action: str, args: dict, t: str) -> Followup | None:
    if not (FOLLOW.search(t) or len(t) <= 6):
        return None  # a full sentence is a new question, not a follow-up
    period, offset = args.get("period", "month"), args.get("offset", -1 if action == "report" else 0)
    category = args.get("category")
    changed = False
    for words, value in ((("上上个月", "上上月", "two months ago", "month before last"), ("month", -2)),
                         (("上个月", "上月", "last month"), ("month", -1)),
                         (("这个月", "本月", "this month"), ("month", 0)),
                         (("去年", "last year"), ("year", -1)),
                         (("今年", "this year"), ("year", 0))):
        if has(t, *words):
            (period, offset), changed = value, True
            break
    if found := next((c for c, words in CATEGORY_WORDS if has(t, *words)), None):
        category, changed = found, True
    elif has(t, "全部", "所有", "总共", "overall", "in total", "everything"):
        category, changed = None, True
    if not changed:
        return None
    return Followup(plan=one("spending", {"period": period, "offset": offset, "category": category}))


def card(action: str, args: dict, t: str) -> Followup | None:
    hint = card_hint(t)
    if hint is None or hint == args.get("card") or has(t, *CARD_VERBS):
        return None  # '解冻借记卡' says its own action: the planner takes it
    if not (FOLLOW.search(t) or SAME.search(t) or len(t) <= 6):
        return None
    return Followup(plan=one(action, {**args, "card": hint}))


def previous_words(session: Session, conversation_id: str) -> str:
    """What the customer said before this message (this one is already stored)."""
    said = session.exec(select(Message).where(Message.conversation_id == conversation_id, Message.role == "user")
                        .order_by(Message.at.desc()).limit(2)).all()
    return said[1].text if len(said) > 1 else ""


def product(first: dict, t: str, before: str = "") -> Followup | None:
    items = (first.get("result") or {}).get("items") or []
    n = ordinal(t)
    money = amounts(t)
    if n is not None and not money and has(before, *BUY) and ordinal(before) is None:
        money = amounts(before)  # '买5000' → 'which one?' → '第二个': the amount was already said
    if n is not None:
        chosen = pick(items, n)
        if chosen is None:
            return None
        return Followup(plan=one("wealth_subscribe", {"product": chosen["name"], "amount_yuan": money[0] if len(money) == 1 else None}))
    if has(t, *BUY) and len(money) == 1 and items:
        if len(items) == 1:
            return Followup(plan=one("wealth_subscribe", {"product": items[0]["name"], "amount_yuan": money[0]}))
        names_zh = "、".join(f"第{i + 1}个（{p['name']}）" for i, p in enumerate(items[:5]))
        names_en = ", ".join(f"the {list(EN_ORDINALS)[i]} ({p['name']})" for i, p in enumerate(items[:5]))
        return Followup(note=(f"要买哪一个？{names_zh}。可以说“买第一个”或“买第二个”。",
                              f"Which one? {names_en}. Say “buy the first one” or “buy the second one”."))
    return None


def subscription(session: Session, user_id: str, t: str) -> Followup | None:
    n = ordinal(t)
    if n is None:
        return None
    active = session.exec(select(Subscription).where(Subscription.user_id == user_id, Subscription.status == "active")
                          .order_by(Subscription.next_charge_on)).all()  # the order the list was shown in
    chosen = pick(list(active), n)
    if chosen is None:
        return None
    if has(t, "取消", "退订", "不要", "cancel", "stop", "unsubscribe"):
        return Followup(plan=one("subscription_cancel", {"merchant": chosen.merchant}))
    if has(t, "提醒", "remind"):
        days = next((int(m) for m in re.findall(r"(\d+)\s*(?:天|days?)", t)), 3)
        return Followup(plan=one("subscription_remind", {"merchant": chosen.merchant, "days_before": min(max(days, 1), 30)}))
    return None
