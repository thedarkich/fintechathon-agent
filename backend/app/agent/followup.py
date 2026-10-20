"""Follow-ups: a message that leans on the conversation before it.

The assistant keeps the thread the way a person would:
- an answer to its own question joins the request it asked about ('转钱' → '转给谁？' → '妈妈');
- a change to the open request replaces it ('300吧', '不是妈妈，是爸爸', '改成2小时后到账', '备注生活费', '只要蛋糕');
- 'again' repeats it ('再来一笔'); '算了' stops it; '好的' points to the button (a yes is never given in words);
- a question carries on from the last one ('那吃饭花了多少' keeps last month, '去年同期呢', '最多的是哪一项');
- a list just shown can be pointed into ('买第一个一万', '第一个风险高吗', '取消第一个', '音乐的那个取消');
- '我刚才转了多少' is answered from the conversation itself.

Fixed code completes the message from the conversation's latest request: the arguments it was planned with and,
for lists, what it showed. The completed request then goes through the same checks, rules and confirmation as any
other; nothing here can approve or run anything, and the AI is not involved. A message that is a request of its
own ('给爸爸转200', '本月账单总结', 'Undo the last transfer') is left to the planner.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from sqlmodel import Session, select

from app.agent import offline
from app.agent.offline import (
    CATEGORY_WORDS,
    NEXT_DAY_ARRIVAL,
    RELATION_WORDS,
    STANDARD_ARRIVAL,
    amounts,
    card_hint,
    has,
    one,
    payee_from,
    product_words,
    unclear_amount,
)
from app.agent.planner import PlanOut
from app.bank import analysis
from app.models import Message, Payee, Plan, Subscription

TRANSFER = {"transfer", "phone_transfer", "schedule_transfer"}
SPENDING = {"spending", "report", "transactions"}
CARD = {"card_freeze", "card_unfreeze", "card_limit", "card_restrict", "card_report_lost"}
PICKS = {"wealth_recommend", "wealth_products", "wealth_compare"}
SUBS = {"subscriptions", "subscription_cancel", "subscription_remind"}
ORDERS = {"contact_lookup", "reserve_create", "merchant_order"}

TAIL = r"[\s。.!！,，吧了啊呀]*"
STOP_WORDS = (r"还是算了|算了吧?|不转了|不用了|不要了|先不(?:转|办|用)?了?|别转了|不办了|不买了|"
              r"(?:刚才|上面)?(?:那|这)?(?:笔|个)?(?:转账)?(?:也)?(?:取消|不要了?|撤回)|取消这笔|取消掉?|"
              r"cancel(?: it| that)?|never ?mind|forget (?:it|that)|no,? don't|don't do it|stop")
STOP = re.compile(rf"(?:(?:{STOP_WORDS}){TAIL})+", re.I)
CONFIRM = re.compile(rf"(?:确认|确定|好的?|好吧|可以|行|对的?|是的?|没问题|同意|就这样|继续|ok|okay|yes|yep|sure|go ahead|confirm|do it){TAIL}", re.I)
AMEND = re.compile(r"改成|改为|换成|变成|改到|不对|应该是|不是|\bmake it\b|\bchange (?:it|that) to\b|\bactually\b|\binstead\b", re.I)
AGAIN = re.compile(r"再来一笔|再来一次|再转一次|再转一笔|同样再|一样的再|照样再|\bagain\b|\banother one\b|\bone more\b|再|又|另外|\banother\b|\bmore\b", re.I)
SAME = re.compile(r"也|一样|同样|照样|\bsame\b|\btoo\b|\bas well\b|\balso\b", re.I)
PRONOUN = re.compile(r"她|他|\bTA\b|\bher\b|\bhim\b|\bthem\b", re.I)
RECALL = re.compile(r"刚才.{0,6}(多少|给谁|谁|什么)|上一笔|what did i (just )?(send|say|ask)|how much did i (just )?send|who did i (just )?send", re.I)
MOST = re.compile(r"最多|最大|最高|花得最多|biggest|largest|most", re.I)
DETAILS = re.compile(r"明细|列一下|列出|清单|每一笔|details|list (them|it|those)|each payment", re.I)
TRANSFER_WORDS = ("转", "打", "汇", "send", "transfer", "pay")
BUY = ("买", "申购", "要", "选", "buy", "go with", "get")
CN_NUMBER = r"[零〇一二两三四五六七八九十百千万]+\s*(?:元|块钱|块)?"

ORDINALS = {"一": 1, "1": 1, "二": 2, "两": 2, "2": 2, "三": 3, "3": 3, "四": 4, "4": 4, "五": 5, "5": 5}
EN_ORDINALS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5}
FILLER = re.compile(r"[\s,，。.!！?？、:：]|那么|那个|那|呢|吧|吗|啊|呀|的|就|个|还有|看看|一下|"
                    r"\b(?:and|what|about|how|then|the|it|one|please|ok|okay|so|for)\b", re.I)
ORDINAL_WORDS = r"第\s*[一二两三四五1-5]|\b(?:first|second|third|fourth|fifth)\b|最后一个|\blast\b"
AMOUNT_WORDS = r"\d+(?:\.\d+)?\s*(?:万|千|k)?\s*(?:元|块钱|块|yuan|rmb)?"
PERIOD_WORDS = ("上上个月", "上上月", "two months ago", "month before last", "上个月", "上月", "last month", "这个月", "本月",
                "this month", "去年同期", "same time last year", "same month last year", "去年", "last year", "今年", "this year",
                "全部", "所有", "总共", "overall", "in total", "everything")


def ordinal(text: str) -> int | None:
    """'第二个' → 2, 'the first one' → 1, '最后一个' → -1."""
    if m := re.search(r"第\s*([一二两三四五1-5])", text):
        return ORDINALS[m.group(1)]
    if m := re.search(r"\b(first|second|third|fourth|fifth)\b", text, re.I):
        return EN_ORDINALS[m.group(1).lower()]
    if re.search(r"最后一个|\bthe last( one)?\b", text, re.I):
        return -1
    return None


def bare(t: str, *patterns: str) -> bool:
    """True when the message is only these words and filler: '那这个月呢', '就买第二个'. A message with anything
    more of its own ('本月账单总结', 'Undo the last transfer') is a request in its own right."""
    rest = t
    for pattern in patterns:
        rest = re.sub(pattern, " ", rest, flags=re.I)
    return not FILLER.sub("", rest).strip()


def pick(items: list, n: int):
    return items[n - 1 if n > 0 else -1] if items and abs(n) <= len(items) else None


def last_person(t: str, names: tuple[str, ...] = ()) -> str | None:
    """The person a message ends up naming: '不是妈妈，是爸爸' → 爸爸; '换成爸爸' → 爸爸; 'send it to Dad' → Dad;
    '换成周凯' → 周凯 (a saved payee). A word that only looks like a name ('金额') is not a person."""
    for part in reversed([p for p in re.split(r"[，,；;。]|不是|是|换成|改成|改为|instead of|\bnot\b", t) if p.strip()]):
        if name := payee_from(PRONOUN.sub(" ", part)):
            return name
        if word := next((w for w in RELATION_WORDS if w in part.lower()), None):
            return word
        if name := next((n for n in names if n and n in part), None):
            return name
    return None


@dataclass
class Followup:
    plan: PlanOut | None = None          # the completed request
    stop: Plan | None = None             # an open request this message replaces or stops
    note: tuple[str, str] | None = None  # a reply instead of a plan (zh, en)


def latest(session: Session, conversation_id: str) -> Plan | None:
    return session.exec(select(Plan).where(Plan.conversation_id == conversation_id)
                        .order_by(Plan.created_at.desc()).limit(1)).first()


def previous_words(session: Session, conversation_id: str) -> str:
    """What the customer said before this message (this one is already stored)."""
    said = session.exec(select(Message).where(Message.conversation_id == conversation_id, Message.role == "user")
                        .order_by(Message.at.desc()).limit(2)).all()
    return said[1].text if len(said) > 1 else ""


def last_reply(session: Session, conversation_id: str) -> Message | None:
    return session.exec(select(Message).where(Message.conversation_id == conversation_id, Message.role == "assistant")
                        .order_by(Message.at.desc()).limit(1)).first()


def alone(t: str, today: date) -> PlanOut:
    """How the planner reads the message on its own."""
    return offline.plan(t, today)


def resolve(session: Session, user_id: str, conversation_id: str, text: str, today: date | None = None) -> Followup | None:
    t = text.strip()
    today = today or date.today()
    on_its_own = alone(t, today)
    # an answer to the assistant's own question ('转钱' → '转给谁？' → '妈妈') joins the request it asked about
    reply = last_reply(session, conversation_id)
    if reply is not None and reply.plan_id is None and (reply.summary or "").startswith("[asked]") and not on_its_own.steps:
        before = previous_words(session, conversation_id)
        if before:
            joined = alone(f"{before}，{t}", today)
            if joined.steps:
                return Followup(plan=joined)
    prior = latest(session, conversation_id)
    if prior is None or not prior.steps:
        return None
    first = prior.steps[0]
    action, args = first["action"], dict(first.get("args") or {})
    is_open = prior.status in ("awaiting_approval", "clarifying")
    if prior.status == "awaiting_approval" and CONFIRM.fullmatch(t):
        if prior.tier == "red":
            return Followup(note=("为了安全，我不能替你确认。请在上面的卡片上核对后点“验证并确认”，再输入交易密码和验证码。",
                                  "For your safety I can't confirm for you. Check the card above, press “Verify and confirm”, then enter your PIN and the code."))
        return Followup(note=("为了安全，我不能替你确认。请在上面的卡片上核对后点“确认”。",
                              "For your safety I can't confirm for you. Check the card above and press “Confirm”."))
    if STOP.fullmatch(t):
        if is_open:
            return Followup(stop=prior, note=("好的，这一笔已取消，什么都没有办。", "Done: that's cancelled, and nothing was carried out."))
        return None
    if RECALL.search(t):
        return recall(prior, action, args, t)
    if action in TRANSFER:
        names = tuple(n for p in session.exec(select(Payee).where(Payee.user_id == user_id)) for n in (p.name, p.name_en) if n)
        return transfer(prior, action, args, t, is_open, on_its_own, names)
    if action in SPENDING:
        return spending(action, args, t, on_its_own, today)
    if action in CARD:
        return card(action, args, t, on_its_own)
    if action in PICKS:
        return product(first, t, previous_words(session, conversation_id))
    if action in SUBS:
        return subscription(session, user_id, t, today)
    if action in ORDERS and any(s["action"] == "merchant_order" for s in prior.steps):
        return orders(prior, t, is_open, today)
    return None


def recall(prior: Plan, action: str, args: dict, t: str) -> Followup | None:
    """'我刚才转了多少': from the conversation itself, in the customer's own words."""
    if action not in TRANSFER or not (args.get("payee") or args.get("phone")):
        return None
    who = args.get("payee") or args.get("phone")
    amount = args.get("amount_yuan")
    state = {"awaiting_approval": ("还没确认", "not confirmed yet"), "done": ("已办好", "done"),
             "cancelled": ("已取消", "cancelled"), "clarifying": ("还差一个信息", "still missing a detail")}.get(prior.status, ("", ""))
    money = f"¥{amount:,.2f}" if amount else ""
    return Followup(note=(f"你刚才是给“{who}”转 {money}（{state[0]}）。" if money else f"你刚才是要给“{who}”转账（{state[0]}）。",
                          f"You just asked to send {money} to “{who}” ({state[1]})." if money else f"You just asked to send money to “{who}” ({state[1]})."))


def transfer(prior: Plan, action: str, args: dict, t: str, is_open: bool, on_its_own: PlanOut,
             names: tuple[str, ...] = ()) -> Followup | None:
    if unclear_amount(t):
        return None  # '-100': the planner asks for the amount
    payee = args.get("payee") or args.get("phone")
    if not payee:
        return None
    if on_its_own.steps and on_its_own.steps[0].action not in TRANSFER:
        return None  # '把借记卡日限额改成5000' is a request of its own, not a change to the transfer
    base = {k: v for k, v in args.items() if k != "phone"} | {"payee": payee}
    lowered = t.lower()
    money = amounts(t)
    named = last_person(t, names)
    other = named is not None and named != payee
    arrival = "standard" if STANDARD_ARRIVAL.search(lowered) else "next_day" if NEXT_DAY_ARRIVAL.search(lowered) else None
    memo = re.search(r"(?:备注|附言|用途|\bnote\b)[:：\s]*([一-龥A-Za-z0-9]{1,20})", t, re.I)
    transfer_verb = has(t, *TRANSFER_WORDS)
    # '给爸爸转200' after '给妈妈转200' is a request of its own, not a change to the first one
    if on_its_own.steps and transfer_verb and named and money and not AMEND.search(t) and not SAME.search(t) and not AGAIN.search(t):
        return None
    # '再来一笔', '同样再转一次', '再转100', '再给她转50', 'send her another 50': the same person again
    if (AGAIN.search(t) or (PRONOUN.search(t) and transfer_verb)) and not other and len(money) <= 1:
        if money or re.search(r"再来|再转一|同样|一样|照样|again|another one|one more", t, re.I):
            return Followup(plan=one("transfer", {**base, "amount_yuan": money[0] if money else args.get("amount_yuan")}))
    # '爸爸也一样', '也给爸爸转300', 'same for Dad': someone else, the same amount unless a new one is said
    if SAME.search(t) and other and not AMEND.search(t):
        return Followup(plan=one("transfer", {"payee": named, "amount_yuan": money[-1] if money else args.get("amount_yuan")}))
    # a change to the open request: '300吧', '金额改成250', '不是妈妈，是爸爸', '换成爸爸', '改成2小时后到账', '备注生活费'
    cue = AMEND.search(t) or arrival or memo
    if not cue and not bare(t, AMOUNT_WORDS, CN_NUMBER):
        return None  # without a change word only a bare amount ('300吧') changes the card
    changes: dict = {}
    if money:
        changes["amount_yuan"] = money[-1]
    if other:
        changes["payee"] = named
    if arrival and action != "schedule_transfer":
        changes["arrival"] = arrival
    if memo:
        changes["memo"] = memo.group(1)
    if not changes:
        return None
    return Followup(plan=one("transfer" if action == "phone_transfer" else action, base | changes), stop=prior if is_open else None)


OWN_TIME = ("最近", "近", "本周", "这周", "上周", "今天", "昨天", "recent", "lately", "week", "today", "yesterday")  # a time of its own


def spending(action: str, args: dict, t: str, on_its_own: PlanOut, today: date) -> Followup | None:
    period, offset = args.get("period", "month"), args.get("offset", -1 if action == "report" else 0)
    if period not in ("month", "year"):
        period, offset = "month", 0
    category = args.get("category")
    # '最多的是哪一项': the same question again; its answer leads with the biggest
    if MOST.search(t) and bare(t, MOST.pattern, r"是|哪一?项|哪个|类|which|is|category|spent|花", *[re.escape(w) for w in PERIOD_WORDS]):
        return Followup(plan=one("spending", {"period": period, "offset": offset, "category": category}))
    # '列一下明细': that period's payments
    if DETAILS.search(t) and bare(t, DETAILS.pattern, r"给我|我|me|show|please|交易|payments"):
        start = offline.add_months(date(today.year, today.month, 1), offset) if period == "month" else date(today.year + offset, 1, 1)
        end = offline.add_months(start, 1) if period == "month" else date(start.year + 1, 1, 1)
        from datetime import timedelta
        return Followup(plan=one("transactions", {"start": start.isoformat(), "end": (min(end, today + timedelta(days=1)) - timedelta(days=1)).isoformat(),
                                                  **({"category": category} if category else {})}))
    # a question of its own in the same area ('那吃饭花了多少'): it keeps the period unless it names one
    own = on_its_own.steps[0] if len(on_its_own.steps) == 1 else None
    if own is not None and own.action == "spending" and not has(t, *PERIOD_WORDS, *OWN_TIME) and offset != own.args.get("offset", 0):
        return Followup(plan=one("spending", {**own.args, "period": period, "offset": offset}))
    words = [*PERIOD_WORDS, *(w for _, ws in CATEGORY_WORDS for w in ws)]
    if not bare(t, "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True))):
        return None  # '本月账单总结', 'What were my expenses on shopping last month?' are questions of their own
    changed = False
    for words_, value in ((("去年同期", "same time last year", "same month last year"), ("month", offset - 12)),
                          (("上上个月", "上上月", "two months ago", "month before last"), ("month", -2)),
                          (("上个月", "上月", "last month"), ("month", -1)),
                          (("这个月", "本月", "this month"), ("month", 0)),
                          (("去年", "last year"), ("year", -1)),
                          (("今年", "this year"), ("year", 0))):
        if has(t, *words_):
            (period, offset), changed = value, True
            break
    if found := next((c for c, ws in CATEGORY_WORDS if has(t, *ws)), None):
        category, changed = found, True
    elif has(t, "全部", "所有", "总共", "overall", "in total", "everything"):
        category, changed = None, True
    if not changed or offset < -24:
        return None
    return Followup(plan=one("spending", {"period": period, "offset": offset, "category": category}))


CARD_ACTIONS = (("解冻", "card_unfreeze"), ("unfreeze", "card_unfreeze"), ("unlock", "card_unfreeze"), ("挂失", "card_report_lost"),
                ("report it lost", "card_report_lost"), ("冻结", "card_freeze"), ("freeze", "card_freeze"), ("lock", "card_freeze"))


def card(action: str, args: dict, t: str, on_its_own: PlanOut) -> Followup | None:
    hint = card_hint(t)
    # '解冻吧', '那挂失吧', 'unfreeze it': a card action on the card just discussed
    verb = next((a for word, a in CARD_ACTIONS if word in t.lower()), None)
    if verb and hint is None and not on_its_own.steps and args.get("card"):
        return Followup(plan=one(verb, {"card": args["card"]}))
    # '那借记卡呢': the same action on another card
    if hint is None or hint == args.get("card") or verb or has(t, "限额", "开通", "关闭", "开启", "limit", "turn on", "turn off"):
        return None
    if not bare(t, r"借记卡|虚拟卡|网购卡|信用卡|工资卡|储蓄卡|卡|\bdebit( card)?\b|\bvirtual( card)?\b|\bcard\b|也|\btoo\b|\balso\b|尾号\s*\d{4}|\d{4}"):
        return None
    return Followup(plan=one(action, {**args, "card": hint}))


RISK_WORDS = r"风险|安全|稳不稳|收益|回撤|怎么样|好不好|好吗|高吗|大吗|risky|risk|safe|return|yield|drawdown|how is|any good"


def product(first: dict, t: str, before: str = "") -> Followup | None:
    items = (first.get("result") or {}).get("items") or []
    if product_words(t) or any(p.get("name") and p["name"] in t for p in items):
        return None  # '申购安盈短债5000元' names its own product: a full request, not a follow-up
    n = ordinal(t)
    # '第一个风险高吗': answered from the list just shown, by code
    if n is not None and re.search(RISK_WORDS, t, re.I) and (chosen := pick(items, n)):
        level = {1: ("低", "low"), 2: ("中低", "low to medium"), 3: ("中", "medium"), 4: ("中高", "medium to high"), 5: ("高", "high")}[chosen["risk_level"]]
        rate_zh = f"七日年化 {chosen['yield_bp'] / 100:.2f}%" if chosen.get("yield_bp") else f"近一年 {chosen['return_1y_bp'] / 100:.2f}%"
        rate_en = f"7-day annualised {chosen['yield_bp'] / 100:.2f}%" if chosen.get("yield_bp") else f"{chosen['return_1y_bp'] / 100:.2f}% over the last year"
        drop = chosen.get("max_drawdown_bp") or 0
        return Followup(note=(f"{chosen['name']}：风险等级 R{chosen['risk_level']}（{level[0]}），{rate_zh}，最大回撤 {drop / 100:.2f}%。"
                              f"{'在你的风险等级以内。' if chosen.get('suitable') else '超出你的风险等级，不能购买。'}模拟产品，不构成投资建议。",
                              f"{chosen['name']}: risk R{chosen['risk_level']} ({level[1]}), {rate_en}, largest drop {drop / 100:.2f}%. "
                              f"{'Within your risk level.' if chosen.get('suitable') else 'Above your risk level, so it cannot be bought.'} Simulated product, not investment advice."))
    buy_words = "|".join(re.escape(w) for w in BUY)
    if not bare(t, ORDINAL_WORDS, AMOUNT_WORDS, CN_NUMBER, buy_words, r"\bthis\b|这个|那个"):
        return None  # 'how many times did I take a taxi', 'Undo the last transfer' are requests of their own
    money = amounts(re.sub(ORDINAL_WORDS, " ", t, flags=re.I))  # '第二个，五千': the 二 is a position, not an amount
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


def active_subscriptions(session: Session, user_id: str) -> list[Subscription]:
    return list(session.exec(select(Subscription).where(Subscription.user_id == user_id, Subscription.status == "active")
                             .order_by(Subscription.next_charge_on)).all())  # the order the list was shown in


def subscription(session: Session, user_id: str, t: str, today: date) -> Followup | None:
    cancel = has(t, "取消", "退订", "不要", "cancel", "stop", "unsubscribe")
    # '把重复的取消': which ones are doubled, from the bank's own records
    if cancel and has(t, "重复", "duplicate", "twice", "two of") and bare(t, r"把|重复|取消|掉|duplicates?|cancel|the|one|twice|two of|我|me"):
        groups = analysis.overlaps(active_subscriptions(session, user_id))
        if not groups:
            return Followup(note=("没有发现重复的会员。", "Nothing is paid for twice."))
        zh = "；".join(f"{'音乐' if g['group'] == 'music' else '视频'}会员：{'、'.join(g['merchants'])}" for g in groups)
        en = "; ".join(f"{g['group']}: {', '.join(g['merchants'])}" for g in groups)
        return Followup(note=(f"重复的有：{zh}。要取消哪一个？可以直接说“取消{groups[0]['merchants'][-1]}”。",
                              f"Paid for twice: {en}. Which one should go? Say for example “cancel {groups[0]['merchants'][-1]}”."))
    # '音乐的那个取消', 'cancel the music one': a kind of service from the list
    kind = "音乐" if has(t, "音乐", "music") else "视频" if has(t, "视频", "video") else None
    if cancel and kind and bare(t, r"音乐|视频|music|video|取消|退订|不要|cancel|stop|unsubscribe|会员|订阅|掉|把"):
        return Followup(plan=one("subscription_cancel", {"merchant": kind}))
    n = ordinal(t)
    if n is None or not bare(t, ORDINAL_WORDS, r"取消|退订|不要|cancel|stop|unsubscribe|提醒|remind|我|me|前|before|\d+\s*(?:天|days?)"):
        return None
    chosen = pick(active_subscriptions(session, user_id), n)
    if chosen is None:
        return None
    if cancel:
        return Followup(plan=one("subscription_cancel", {"merchant": chosen.merchant}))
    if has(t, "提醒", "remind"):
        days = next((int(m) for m in re.findall(r"(\d+)\s*(?:天|days?)", t)), 3)
        return Followup(plan=one("subscription_remind", {"merchant": chosen.merchant, "days_before": min(max(days, 1), 30)}))
    return None


def orders(prior: Plan, t: str, is_open: bool, today: date) -> Followup | None:
    """The birthday plan, changed in words: '预算改成2000', '只要蛋糕', '不要花了'. The request is re-planned from its
    own sentence with the change made, so the same rules apply."""
    if not is_open:
        if re.search(r"预算|改成|只要|不要", t):
            return Followup(note=("这个计划已经确认并安排了。要改的话，先说“停止生日计划”，再重新说一遍。",
                                  "That plan is already confirmed and scheduled. To change it, say “stop the birthday plan” and ask again."))
        return None
    text = prior.request
    money = amounts(t)
    changed = False
    if money and re.search(r"预算|改成|改为|预留|budget|make it|set aside", t, re.I) and bare(t, r"预算|改成|改为|预留|budget|make it|set aside|to", AMOUNT_WORDS, CN_NUMBER):
        if amounts(text):
            text = re.sub(r"\d+(?:\.\d+)?\s*(?:万|千)?", f"{money[-1]:g}", text, count=1)
        else:
            text = f"{text}，预留{money[-1]:g}"
        changed = True
    if re.search(r"只要蛋糕|不要花|只订蛋糕|only the cake|no flowers", t, re.I):
        text, changed = re.sub(r"(?:鲜)?花(?:和|、|跟)?", "", text).replace("flowers and ", ""), True
    elif re.search(r"只要花|不要蛋糕|只订花|only the flowers|no cake", t, re.I):
        text, changed = re.sub(r"(?:和|、|跟)?蛋糕", "", text).replace(" and a cake", ""), True
    if not changed:
        return None
    plan = offline.plan(text, today)
    return Followup(plan=plan, stop=prior) if plan.steps else None
