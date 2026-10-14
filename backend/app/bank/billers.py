"""The Payments screen's catalogue: who you can pay bills to, and what each of them says you owe.

Bills are simulated. A provider issues one bill a month (period YYYY-MM), the same account always gets the
same amount for a month, and what has been paid towards it comes from this bank's own records: payments
made on the Payments screen, automatic payments, and, for bills set up from the customer's history, the
direct debits that already paid them. A mobile top-up has no bill: the customer picks the amount.
"""

import hashlib
import re
from datetime import date, datetime, time

from sqlalchemy import func
from sqlmodel import Session, select

from app import clock
from app.bank.directory import mask_name
from app.bank.directory import valid as valid_phone
from app.clock import CST
from app.models import BillPayment, SavedBill, Txn

# category: (zh, en, icon)
CATEGORIES = {
    "mobile": ("手机充值", "Mobile top-up", "phone"),
    "electricity": ("电费", "Electricity", "bolt"),
    "water": ("水费", "Water", "drop"),
    "gas": ("燃气费", "Gas", "flame"),
    "internet": ("宽带电视", "Internet & TV", "wifi"),
    "property": ("物业费", "Property fees", "home"),
    "fines": ("交通罚款", "Traffic fines", "car"),
}

# code: category, name, name_en, what the account is called, the name on the customer's statement,
# spending category, monthly bill range in yuan (None = no bill, the customer chooses the amount)
PROVIDERS = {
    "cmcc": dict(category="mobile", name="中国移动", name_en="China Mobile", counterparty="中国移动 话费充值", spend="utilities", bill=None),
    "cucc": dict(category="mobile", name="中国联通", name_en="China Unicom", counterparty="中国联通 话费充值", spend="utilities", bill=None),
    "ctcc": dict(category="mobile", name="中国电信", name_en="China Telecom", counterparty="中国电信 话费充值", spend="utilities", bill=None),
    "sgcc": dict(category="electricity", name="国家电网", name_en="State Grid", counterparty="国家电网 电费", spend="utilities", bill=(90, 260)),
    "whwater": dict(category="water", name="武汉水务", name_en="Wuhan Water", counterparty="武汉水务 水费", spend="utilities", bill=(30, 70)),
    "whgas": dict(category="gas", name="武汉燃气", name_en="Wuhan Gas", counterparty="武汉燃气 燃气费", spend="utilities", bill=(40, 150)),
    "ctbb": dict(category="internet", name="中国电信宽带", name_en="China Telecom Broadband", counterparty="中国电信 宽带", spend="utilities", bill=(99, 99)),
    "cmbb": dict(category="internet", name="中国移动宽带", name_en="China Mobile Broadband", counterparty="中国移动 宽带", spend="utilities", bill=(129, 129)),
    "donghu": dict(category="property", name="东湖物业", name_en="Donghu Property", counterparty="东湖物业 物业费", spend="housing", bill=(180, 420)),
    "whtraffic": dict(category="fines", name="武汉交管", name_en="Wuhan Traffic Police", counterparty="武汉交管 交通罚款", spend="transport", bill=None),
}
ACCOUNT_LABEL = {"mobile": ("手机号", "Phone number"), "fines": ("车牌号", "Plate number")}
DEFAULT_ACCOUNT_LABEL = ("户号", "Account number")
TOP_UPS = [30, 50, 100, 200]
PLATE = re.compile(r"^[一-鿿][A-Z][A-Z0-9]{5,6}$")
AUTOPAY_LIMIT_FEN = 30_000  # ¥300 unless the customer chooses another limit


def normalize_account(provider: str, account: str) -> str:
    text = re.sub(r"[\s-]", "", account or "").upper()
    return text


def check_account(provider: str, account: str) -> tuple[str, str] | None:
    """None if the account looks right for the provider, else (zh, en) saying what is wrong."""
    category = PROVIDERS[provider]["category"]
    if category == "mobile":
        return None if valid_phone(account) else ("手机号需为 11 位数字。", "The phone number must have 11 digits.")
    if category == "fines":
        return None if PLATE.match(account) else ("车牌号格式不对，例如 鄂A12345。", "That is not a plate number, e.g. 鄂A12345.")
    return None if re.fullmatch(r"\d{8,13}", account) else ("户号应为 8–13 位数字。", "The account number has 8–13 digits.")


def _digest(*parts: str) -> int:
    return int(hashlib.sha256("|".join(parts).encode()).hexdigest(), 16)


def holder(provider: str, account: str) -> str:
    """The masked name the provider has on the account, as a bill shows it."""
    from app.bank.directory import GIVEN, SURNAMES
    digest = _digest("holder", provider, account)
    return mask_name(SURNAMES[digest % len(SURNAMES)] + GIVEN[(digest // 97) % len(GIVEN)])


def month_bounds(period: str) -> tuple[str, str]:
    year, month = int(period[:4]), int(period[5:7])
    start = date(year, month, 1)
    end = clock.add_months(start, 1)
    return (clock.iso(datetime.combine(start, time.min, CST)), clock.iso(datetime.combine(end, time.min, CST)))


def history_paid(session: Session, user_id: str, provider: str, period: str) -> int:
    """Direct debits to the provider in that month, as already on the customer's statement."""
    start, end = month_bounds(period)
    total = session.exec(select(func.coalesce(func.sum(-Txn.amount_fen), 0)).where(
        Txn.user_id == user_id, Txn.kind == "direct_debit", Txn.status == "posted",
        Txn.counterparty == PROVIDERS[provider]["counterparty"], Txn.at >= start, Txn.at < end)).one()
    return int(total)


def bill(session: Session, user_id: str, provider: str, account: str, period: str, *, from_history: bool = False) -> dict:
    """What the provider billed for the month, what has been paid towards it, and what is still due."""
    info = PROVIDERS[provider]
    paid = int(session.exec(select(func.coalesce(func.sum(BillPayment.amount_fen), 0)).where(
        BillPayment.user_id == user_id, BillPayment.provider == provider, BillPayment.account == account,
        BillPayment.period == period)).one())
    if info["category"] == "fines":
        # a plate has one fine on record or none; it stays due until paid
        digest = _digest("fine", account)
        billed = 20_000 if digest % 3 == 0 else 0
        paid = int(session.exec(select(func.coalesce(func.sum(BillPayment.amount_fen), 0)).where(
            BillPayment.user_id == user_id, BillPayment.provider == provider, BillPayment.account == account)).one())
        return {"billed_fen": billed, "paid_fen": paid, "due_fen": max(0, billed - paid),
                "detail": ("闯红灯，光谷大道与关山大道路口", "Ran a red light at Guanggu Avenue and Guanshan Avenue") if billed else None}
    if info["bill"] is None:
        return {"billed_fen": None, "paid_fen": paid, "due_fen": None, "detail": None}
    if from_history and (debited := history_paid(session, user_id, provider, period)):
        paid += debited
        billed = debited  # the bill that the direct debit already paid
    else:
        low, high = info["bill"]
        digest = _digest("bill", provider, account, period)
        billed = low * 100 + digest % ((high - low) * 100 + 1)
    return {"billed_fen": billed, "paid_fen": paid, "due_fen": max(0, billed - paid), "detail": None}


def provider_view(code: str, lang: str) -> dict:
    info = PROVIDERS[code]
    category = info["category"]
    label = ACCOUNT_LABEL.get(category, DEFAULT_ACCOUNT_LABEL)
    return {"code": code, "category": category, "name": info["name"] if lang == "zh" else info["name_en"],
            "account_label": label[0] if lang == "zh" else label[1], "billed": info["bill"] is not None or category == "fines",
            "top_ups": TOP_UPS if category == "mobile" else None}


def catalogue(lang: str) -> list[dict]:
    return [{"code": code, "name": zh if lang == "zh" else en, "icon": icon,
             "providers": [provider_view(p, lang) for p, info in PROVIDERS.items() if info["category"] == code]}
            for code, (zh, en, icon) in CATEGORIES.items()]


def found_in_history(session: Session, user_id: str, today: date) -> list[tuple[str, int]]:
    """Utility bills the customer already pays by direct debit: (provider, day of month it is usually paid)."""
    found = []
    since = clock.iso(datetime.combine(clock.add_months(today, -6), time.min, CST))
    for code, info in PROVIDERS.items():
        if info["category"] not in ("electricity", "water", "gas"):
            continue
        rows = session.exec(select(Txn.at).where(Txn.user_id == user_id, Txn.kind == "direct_debit",
                                                 Txn.counterparty == info["counterparty"], Txn.at >= since)).all()
        if len(rows) >= 2:
            found.append((code, clock.to_date(max(rows)).day))
    return found


def setup_from_history(session: Session, user_id: str, today: date, own_phone: str | None) -> None:
    """The first visit to Payments lists the bills the customer already pays, so the screen isn't empty.
    Their direct debits become automatic payments with the usual ¥300 limit, on the day they usually ran."""
    if session.exec(select(SavedBill.id).where(SavedBill.user_id == user_id)).first():
        return
    now = clock.iso(datetime.combine(today, time(9, 0), CST))
    for code, day in found_in_history(session, user_id, today):
        account = str(_digest("account", user_id, code) % 10**10).rjust(10, "0")
        due_on = date(today.year, today.month, min(day, 28))
        if due_on <= today:
            due_on = clock.add_months(due_on, 1)
        session.add(SavedBill(user_id=user_id, provider=code, account=account, autopay=True,
                              autopay_limit_fen=AUTOPAY_LIMIT_FEN, next_autopay_on=due_on.isoformat(),
                              found_in_history=True, created_at=now))
    if own_phone and valid_phone(own_phone):
        session.add(SavedBill(user_id=user_id, provider="cmcc", account=own_phone, created_at=now))
    session.flush()
