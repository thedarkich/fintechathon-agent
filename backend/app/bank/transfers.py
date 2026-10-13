"""How the simulated bank processes a transfer after the customer approves it.

    accepted ──(arrival time)──▶ clearing ──▶ arrived
        │                           └──────▶ returned   (the payee's bank refuses it: name mismatch, …)
        └──(customer, before arrival)──▶ cancelled

Money leaves the customer's account when the transfer is accepted and comes back if it is returned or
cancelled. Modelled on how transfers work in mainland China:

- Route: a payee at our own bank is a same-bank transfer; any other bank goes through the interbank
  online payment system (超级网银), which runs around the clock in real time. Our single-transfer cap
  (¥50,000) keeps every transfer within that system.
- Arrival: banks must offer instant, standard (later the same day) and next-day arrival (PBOC notice
  银发〔2016〕261号, against telecom fraud). A delayed transfer can be cancelled until it arrives. The
  rules choose standard arrival when a transfer carries a risk signal (policy.safer_arrival).
- Name check: the payee's bank compares the name on the transfer with the account holder and returns
  the money if they differ.

Exact timings vary by bank; the ones here are the demo bank's own.
"""

import re
from datetime import datetime, time, timedelta

from sqlmodel import Session, select

from app import clock
from app.agent import audit
from app.bank import ledger
from app.bank.ledger import BankError
from app.clock import CST
from app.models import BankAccount, Payee, PayeeMessage, SmsMessage, Transfer, Txn, UserAccount

OWN_BANK = "演示银行"
BANK_EN = {"演示银行": "Demo Bank", "中国工商银行": "ICBC", "中国农业银行": "Agricultural Bank of China",
           "中国银行": "Bank of China", "中国建设银行": "China Construction Bank", "交通银行": "Bank of Communications",
           "招商银行": "China Merchants Bank", "浦发银行": "SPD Bank", "某村镇银行": "a rural bank"}
ROUTES = {"internal": ("行内转账", "same-bank transfer"), "ibps": ("超级网银跨行实时转账", "interbank online system, real time")}
ARRIVALS = {"instant": ("实时到账", "arrives now"), "standard": ("2 小时后到账", "arrives in 2 hours"),
            "next_day": ("次日凌晨到账", "arrives early tomorrow")}
STATUSES = {"accepted": ("已受理", "Accepted"), "clearing": ("清算中", "Clearing"), "arrived": ("已到账", "Arrived"),
            "returned": ("已退回", "Returned"), "cancelled": ("已撤销", "Cancelled")}
RETURN_REASONS = {"NAME_MISMATCH": ("收款户名与账号不符", "the payee name does not match the account"),
                  "ACCOUNT_FROZEN": ("收款账户已冻结", "the payee's account is frozen"),
                  "BANK_REJECTED": ("收款行拒绝入账", "the payee's bank refused it")}
# Account holders on record at other banks, where they differ from the name the customer saved.
# The seller added today gave an account in someone else's name: the classic mule account.
REGISTERED_HOLDERS = {"6230580000673307": "周楷"}


def bank_en(bank: str) -> str:
    return BANK_EN.get(bank, bank)


# The demo customer's own payee notes, in English. Any other note the customer wrote in Chinese is
# left out of English screens rather than shown untranslated.
NOTE_EN = {"家人": "family", "大学同学": "university friend", "同事，财务部": "colleague, finance",
           "室友，水电网费AA": "roommate, splits bills", "房租": "rent", "羽毛球球友": "badminton friend",
           "高中同学": "school friend", "二手相机卖家（今天新加）": "used-camera seller, added today",
           "二手相机卖家，今天新加": "used-camera seller, added today"}


def note_en(note: str | None) -> str | None:
    if not note:
        return None
    if note in NOTE_EN:
        return NOTE_EN[note]
    return None if re.search(r"[一-鿿]", note) else note


def route_for(bank: str) -> str:
    return "internal" if bank == OWN_BANK else "ibps"


def arrive_time(arrival: str, now: datetime) -> datetime:
    if arrival == "standard":
        return now + timedelta(hours=2)
    if arrival == "next_day":
        return datetime.combine(now.astimezone(CST).date() + timedelta(days=1), time(2, 0), CST)
    return now


def _event(row: Transfer, status: str, when: datetime, note_zh: str = "", note_en: str = "") -> None:
    zh, en = STATUSES[status]
    row.status = status
    row.events = [*row.events, {"at": clock.iso(when), "status": status, "zh": f"{zh}{('：' + note_zh) if note_zh else ''}",
                                "en": f"{en}{(': ' + note_en) if note_en else ''}"}]


def _money(fen: int) -> str:
    return f"{fen / 100:,.2f}"


def _when_zh(when: datetime) -> str:
    local = when.astimezone(CST)
    return f"{local.month}月{local.day}日{local:%H:%M}"


def send(session: Session, user: UserAccount, payee: Payee, source: BankAccount, fen: int, *, now: datetime,
         memo: str | None = None, arrival: str = "instant", arrival_reason: str | None = None,
         plan_id: str | None = None, scheduled_id: str | None = None) -> Transfer:
    """Accept a transfer: the money leaves now; an instant transfer also clears and arrives now."""
    debit = ledger.debit(session, source, fen, when=now, kind="transfer_out", counterparty=payee.name, payee=payee,
                         memo=memo, plan_id=plan_id)
    route = route_for(payee.bank)
    row = Transfer(user_id=user.id, payee_id=payee.id, payee_name=payee.name, payee_name_en=payee.name_en or payee.name,
                   bank=payee.bank, account_tail=payee.account_no[-4:], source_id=source.id, amount_fen=fen, memo=memo,
                   route=route, arrival=arrival, arrival_reason=arrival_reason, created_at=clock.iso(now),
                   arrive_at=clock.iso(arrive_time(arrival, now)), debit_txn_id=debit.id, plan_id=plan_id,
                   scheduled_id=scheduled_id)
    _event(row, "accepted", now, ARRIVALS[arrival][0], ARRIVALS[arrival][1])
    session.add(row)
    session.flush()
    _audit(session, row)
    if arrival == "instant":
        advance(session, row, now)
    return row


def advance(session: Session, row: Transfer, now: datetime, *, force: bool = False,
            reason: str | None = None) -> bool:
    """Clear a transfer whose arrival time has come. force (demo tools) clears it now; reason forces a return."""
    if row.status != "accepted" or (not force and clock.parse(row.arrive_at) > now):
        return False
    when = now if force else clock.parse(row.arrive_at)  # as of its arrival time, even if the demo clock jumped
    if force:
        row.arrive_at = clock.iso(now)
    _event(row, "clearing", when, *ROUTES[row.route])
    payee = session.get(Payee, row.payee_id)
    holder = REGISTERED_HOLDERS.get(payee.account_no, payee.name) if payee else row.payee_name
    reason = reason or ("NAME_MISMATCH" if holder != row.payee_name else None)
    if reason:
        _return(session, row, when, reason)
    else:
        _event(row, "arrived", when)
        row.finished_at = clock.iso(when)
        payer = session.get(UserAccount, row.user_id)
        session.add(PayeeMessage(
            user_id=row.user_id, payee_id=row.payee_id, at=clock.iso(when),
            text=f"【{row.bank}】您尾号{row.account_tail}的账户{_when_zh(when)}收到{payer.name}转账人民币{_money(row.amount_fen)}元。",
            text_en=f"[{bank_en(row.bank)}] Your account ending {row.account_tail} received RMB {_money(row.amount_fen)} "
                    f"from {payer.name} at {when.astimezone(CST):%m-%d %H:%M}."))
    session.add(row)
    _audit(session, row)
    return True


def _refund(session: Session, row: Transfer, when: datetime, memo: str) -> None:
    source = session.get(BankAccount, row.source_id)
    if source is None or source.status != "open":
        source = ledger.checking(session, row.user_id)
    debit = session.get(Txn, row.debit_txn_id) if row.debit_txn_id else None
    ledger.credit(session, source, row.amount_fen, when=when, kind="refund", counterparty=row.payee_name, memo=memo,
                  category=debit.category if debit else None, plan_id=row.plan_id)


def _return(session: Session, row: Transfer, when: datetime, reason: str) -> None:
    zh, en = RETURN_REASONS[reason]
    _event(row, "returned", when, zh, en)
    row.reason, row.finished_at = reason, clock.iso(when)
    _refund(session, row, when, f"退汇：{zh}")
    session.add(SmsMessage(
        user_id=row.user_id,  # sent now, like the verification codes on the same phone
        text=f"【{OWN_BANK}】您{_when_zh(when)}向{row.payee_name}（尾号{row.account_tail}）的转账人民币{_money(row.amount_fen)}元已退回，原因：{zh}。资金已回到原账户。",
        text_en=f"[{BANK_EN[OWN_BANK]}] Your transfer of RMB {_money(row.amount_fen)} to {row.payee_name_en} (ending {row.account_tail}) "
                f"was returned because {en}. The money is back in your account."))


def cancellable(row: Transfer, now: datetime) -> bool:
    return row.status == "accepted" and clock.parse(row.arrive_at) > now


def cancel(session: Session, row: Transfer, now: datetime) -> None:
    """The customer changes their mind while a delayed transfer waits."""
    if not cancellable(row, now):
        raise BankError("NOT_CANCELLABLE", "This transfer has already left and can't be cancelled.",
                        "这笔转账已经发出，无法撤销。")
    _event(row, "cancelled", now)
    row.finished_at = clock.iso(now)
    _refund(session, row, now, "撤销转账")
    session.add(SmsMessage(
        user_id=row.user_id,
        text=f"【{OWN_BANK}】您向{row.payee_name}（尾号{row.account_tail}）的转账人民币{_money(row.amount_fen)}元已撤销，资金已回到原账户。",
        text_en=f"[{BANK_EN[OWN_BANK]}] Your transfer of RMB {_money(row.amount_fen)} to {row.payee_name_en} "
                f"(ending {row.account_tail}) was cancelled. The money is back in your account."))
    session.add(row)
    _audit(session, row)


def settle_due(session: Session, user_id: str, now: datetime) -> list[Transfer]:
    """Run every delayed transfer whose arrival time has come; returns the ones that changed."""
    rows = session.exec(select(Transfer).where(Transfer.user_id == user_id, Transfer.status == "accepted",
                                               Transfer.arrive_at <= clock.iso(now))).all()
    return [row for row in rows if advance(session, row, now)]


def _audit(session: Session, row: Transfer) -> None:
    audit.append(session, row.user_id, "transfer", {"transfer": row.id, "status": row.status, "route": row.route,
                                                    "arrival": row.arrival, "fen": row.amount_fen, "reason": row.reason},
                 row.plan_id)


def view(row: Transfer, lang: str, now: datetime) -> dict:
    zh = lang == "zh"
    return {"id": row.id, "payee": row.payee_name if zh else row.payee_name_en, "bank": row.bank if zh else bank_en(row.bank),
            "account_tail": row.account_tail, "fen": row.amount_fen, "memo": row.memo, "route": row.route,
            "route_label": ROUTES[row.route][0 if zh else 1], "arrival": row.arrival,
            "arrival_label": ARRIVALS[row.arrival][0 if zh else 1], "arrival_reason": row.arrival_reason,
            "status": row.status, "status_label": STATUSES[row.status][0 if zh else 1],
            "reason": RETURN_REASONS[row.reason][0 if zh else 1] if row.reason else None,
            "created_at": row.created_at, "arrive_at": row.arrive_at, "finished_at": row.finished_at,
            "cancellable": cancellable(row, now), "plan_id": row.plan_id,
            "events": [{"at": e["at"], "status": e["status"], "text": e["zh"] if zh else e["en"]} for e in row.events]}
