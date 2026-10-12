"""Match the customer's words to their own records. Ambiguity becomes a question, never a guess."""

import re
import unicodedata
from dataclasses import dataclass, field

from rapidfuzz import fuzz
from sqlmodel import Session, select

from app.models import BankAccount, Card, Holding, Payee, Subscription, WealthProduct

RELATIONSHIP_WORDS = {
    "mother": ["妈妈", "妈", "老妈", "母亲", "mom", "mum", "mother", "mama"],
    "father": ["爸爸", "爸", "老爸", "父亲", "dad", "father", "papa"],
    "spouse": ["老婆", "媳妇", "妻子", "爱人", "太太", "wife", "spouse", "husband", "老公", "丈夫"],
    "landlord": ["房东", "landlord"],
    "roommate": ["室友", "roommate", "flatmate"],
}


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "").casefold().strip()
    text = re.sub(r"^(my|the|给|向|转给|我的|我)\s*", "", text)
    return re.sub(r"[\s·・.,，。'\"]", "", text)


@dataclass
class Found:
    """Exactly one match (`value`), several (`options`) or none."""

    value: object | None = None
    options: list = field(default_factory=list)

    @property
    def ambiguous(self) -> bool:
        return self.value is None and len(self.options) > 1


def mask_phone(phone: str) -> str:
    return phone[:3] + "****" + phone[-4:] if len(phone) >= 7 else phone


def payee_label(p: Payee, lang: str) -> str:
    name = p.name if lang == "zh" or not p.name_en else f"{p.name_en} ({p.name})"
    parts = [name]
    if p.note:
        parts.append(p.note)
    parts.append(f"{p.bank} ****{p.account_no[-4:]}")
    return " · ".join(parts)


def find_payee(session: Session, user_id: str, text: str) -> Found:
    direct = session.get(Payee, text) if len(text or "") == 36 else None
    if direct is not None and direct.user_id == user_id:
        return Found(value=direct)  # a choice the customer picked from offered options
    payees = list(session.exec(select(Payee).where(Payee.user_id == user_id)))
    query = norm(text)
    if not query:
        return Found()
    digits = re.sub(r"\D", "", text)
    scored: list[tuple[int, Payee]] = []
    for p in payees:
        score = 0
        names = [norm(p.name), norm(p.name_en)] + [norm(a) for a in p.aliases]
        if query in names:
            score = 100
        elif len(digits) >= 4 and (p.phone.endswith(digits) or p.account_no.endswith(digits)):
            score = 98 if len(digits) >= 11 or p.phone == digits else 90
        elif p.relationship and query in RELATIONSHIP_WORDS.get(p.relationship, []):
            score = 95
        elif p.note and len(query) >= 2 and (query in norm(p.note) or norm(p.note) in query):
            score = 80
        else:
            best = max((fuzz.ratio(query, n) for n in names if n), default=0)
            if best >= 85 and len(query) >= 2:
                score = int(best) - 10
        if score:
            scored.append((score, p))
    if not scored:
        return Found()
    scored.sort(key=lambda sp: -sp[0])
    top = scored[0][0]
    best = [p for s, p in scored if s >= top - 5]
    return Found(value=best[0]) if len(best) == 1 else Found(options=best)


def find_card(session: Session, user_id: str, text: str | None, *, statuses=None) -> Found:
    cards = [c for c in session.exec(select(Card).where(Card.user_id == user_id))
             if statuses is None or c.status in statuses]
    if not text:
        return Found(value=cards[0]) if len(cards) == 1 else Found(options=cards)
    query = norm(text)
    digits = re.sub(r"\D", "", text)
    if len(digits) >= 4:
        match = [c for c in cards if c.last4 == digits[-4:]]
        return Found(value=match[0]) if len(match) == 1 else Found(options=match)
    if any(w in query for w in ("虚拟", "virtual", "网购", "online")):
        match = [c for c in cards if c.kind == "virtual"]
    elif any(w in query for w in ("借记", "debit", "实体", "physical", "银行卡", "工资卡", "储蓄卡")):
        match = [c for c in cards if c.kind == "debit"]
    else:
        match = cards
    return Found(value=match[0]) if len(match) == 1 else Found(options=match)


def card_label(c: Card, lang: str) -> str:
    return f"{c.name if lang == 'zh' else c.name_en} ****{c.last4}"


def find_subscription(session: Session, user_id: str, text: str) -> Found:
    subs = [s for s in session.exec(select(Subscription).where(Subscription.user_id == user_id))
            if s.status == "active"]
    query = norm(text)
    aliases = {"iqiyi": "爱奇艺", "tencentvideo": "腾讯视频", "tencent": "腾讯视频", "neteasemusic": "网易云音乐",
               "netease": "网易云音乐", "qqmusic": "qq音乐", "baidu": "百度网盘", "baidunetdisk": "百度网盘",
               "gym": "健身", "jd": "京东plus", "jdplus": "京东plus", "wps": "wps", "mobile": "中国移动",
               "chinamobile": "中国移动", "broadband": "宽带", "chinatelecom": "中国电信"}
    query = aliases.get(query, query)
    scored = []
    for s in subs:
        name = norm(s.merchant)
        if query and (query in name or name in query):
            scored.append((100, s))
        else:
            score = fuzz.partial_ratio(query, name)
            if score >= 75:
                scored.append((score, s))
    if not scored:
        return Found()
    scored.sort(key=lambda x: -x[0])
    best = [s for score, s in scored if score >= scored[0][0] - 3]
    return Found(value=best[0]) if len(best) == 1 else Found(options=best)


PRODUCT_WORDS = {
    "money_market": ["货币", "活钱", "money market", "moneymarket", "cash"],
    "bond": ["债", "bond"],
    "mixed": ["混合", "均衡", "balanced", "mixed"],
    "equity": ["股票", "成长", "科技", "equity", "stock", "growth", "tech"],
    "qdii": ["qdii", "全球", "海外", "global", "overseas"],
}


def find_product(session: Session, text: str) -> Found:
    products = list(session.exec(select(WealthProduct)))
    query = norm(text)
    exact = [p for p in products if query in {norm(p.code), norm(p.name), norm(p.name_en)}]
    if exact:
        return Found(value=exact[0])
    fuzzy = [p for p in products if query and (query in norm(p.name) or query in norm(p.name_en))]
    if len(fuzzy) == 1:
        return Found(value=fuzzy[0])
    kinds = [k for k, words in PRODUCT_WORDS.items() if any(norm(w) in query for w in words)]
    match = [p for p in products if p.kind in kinds]
    if len(match) == 1:
        return Found(value=match[0])
    return Found(options=match or fuzzy)


def find_holding(session: Session, user_id: str, text: str | None) -> Found:
    holdings = list(session.exec(select(Holding).where(Holding.user_id == user_id)))
    if not text:
        return Found(value=holdings[0]) if len(holdings) == 1 else Found(options=holdings)
    product = find_product(session, text)
    if product.value is not None:
        match = [h for h in holdings if h.product_code == product.value.code]
        return Found(value=match[0]) if match else Found()
    codes = {p.code for p in product.options}
    match = [h for h in holdings if h.product_code in codes]
    return Found(value=match[0]) if len(match) == 1 else Found(options=match)


def find_reserve(session: Session, user_id: str, text: str | None) -> Found:
    reserves = list(session.exec(select(BankAccount).where(
        BankAccount.user_id == user_id, BankAccount.kind == "reserve", BankAccount.status == "open")))
    if not text:
        return Found(value=reserves[0]) if len(reserves) == 1 else Found(options=reserves)
    query = norm(text)
    match = [r for r in reserves if query in norm(r.name) or query in norm(r.name_en) or norm(r.name) in query]
    if len(match) == 1:
        return Found(value=match[0])
    return Found(options=match or reserves)
