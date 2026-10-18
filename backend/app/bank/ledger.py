"""Balance changes. Every money movement goes through here and leaves a transaction row."""

from datetime import date, datetime, timedelta

from sqlalchemy import func
from sqlmodel import Session, select

from app import clock
from app.bank.categories import categorize
from app.clock import CST
from app.models import BankAccount, Order, Payee, ScheduledTransfer, Txn

PAYMENT_KINDS = ("transfer_out", "order")  # money paid to others: counted towards the day's total


class BankError(Exception):
    def __init__(self, code: str, en: str, zh: str):
        super().__init__(en)
        self.code, self.en, self.zh = code, en, zh


def checking(session: Session, user_id: str) -> BankAccount:
    account = session.exec(
        select(BankAccount).where(BankAccount.user_id == user_id, BankAccount.kind == "checking",
                                  BankAccount.status == "open")
    ).first()
    if account is None:
        raise BankError("NO_ACCOUNT", "No current account was found.", "未找到活期账户。")
    return account


def account(session: Session, user_id: str, account_id: str) -> BankAccount:
    row = session.get(BankAccount, account_id)
    if row is None or row.user_id != user_id or row.status != "open":
        raise BankError("NO_ACCOUNT", "That account was not found.", "未找到该账户。")
    return row


def debit(session: Session, source: BankAccount, fen: int, *, when: datetime, kind: str,
          counterparty: str, plan_id: str | None = None, payee: Payee | None = None,
          memo: str | None = None, category: str | None = None) -> Txn:
    if fen <= 0:
        raise BankError("BAD_AMOUNT", "The amount must be positive.", "金额必须大于零。")
    if source.balance_fen < fen:
        raise BankError("INSUFFICIENT_FUNDS", "Not enough money in the account.", "账户余额不足。")
    source.balance_fen -= fen
    txn = Txn(
        user_id=source.user_id, account_id=source.id, at=clock.iso(when), amount_fen=-fen, kind=kind,
        counterparty=payee.name if payee else counterparty,
        counterparty_account=payee.account_no[-4:] if payee else None,
        category=category or categorize(counterparty, kind, relationship=payee.relationship if payee else None),
        channel="mobile", memo=memo, plan_id=plan_id, payee_id=payee.id if payee else None,
    )
    session.add(source)
    session.add(txn)
    if payee:
        payee.last_paid_at = txn.at
        session.add(payee)
    session.flush()
    return txn


def credit(session: Session, target: BankAccount, fen: int, *, when: datetime, kind: str,
           counterparty: str, plan_id: str | None = None, memo: str | None = None,
           category: str | None = None) -> Txn:
    target.balance_fen += fen
    txn = Txn(user_id=target.user_id, account_id=target.id, at=clock.iso(when), amount_fen=fen,
              kind=kind, counterparty=counterparty, category=category or categorize(counterparty, kind),
              channel="mobile", memo=memo, plan_id=plan_id)
    session.add(target)
    session.add(txn)
    session.flush()
    return txn


def move(session: Session, source: BankAccount, target: BankAccount, fen: int, *, when: datetime,
         plan_id: str | None = None, memo: str | None = None) -> None:
    debit(session, source, fen, when=when, kind="internal", counterparty=target.name, plan_id=plan_id,
          memo=memo, category="internal")
    credit(session, target, fen, when=when, kind="internal", counterparty=source.name, plan_id=plan_id,
           memo=memo, category="internal")


def payments_on(session: Session, user_id: str, day: date, *, include_scheduled: bool = True) -> int:
    """Today's payments in the sense of the tier rule: transfers and orders that left, plus those
    scheduled for that day and not yet run."""
    start = datetime.combine(day, datetime.min.time(), CST)
    end = start + timedelta(days=1)
    posted = session.exec(
        select(func.coalesce(func.sum(-Txn.amount_fen), 0)).where(
            Txn.user_id == user_id, Txn.kind.in_(PAYMENT_KINDS), Txn.status == "posted",
            Txn.at >= clock.iso(start), Txn.at < clock.iso(end),
        )
    ).one()
    if not include_scheduled:
        return int(posted)
    scheduled = session.exec(
        select(func.coalesce(func.sum(ScheduledTransfer.amount_fen), 0)).where(
            ScheduledTransfer.user_id == user_id, ScheduledTransfer.status.in_(["scheduled", "waiting_approval"]),
            ScheduledTransfer.run_at >= clock.iso(start), ScheduledTransfer.run_at < clock.iso(end),
        )
    ).one()
    orders = session.exec(
        select(func.coalesce(func.sum(Order.amount_fen), 0)).where(
            Order.user_id == user_id, Order.status.in_(["scheduled", "waiting_approval"]),
            Order.pay_at >= clock.iso(start), Order.pay_at < clock.iso(end),
        )
    ).one()
    return int(posted) + int(scheduled) + int(orders)


def paid_to(session: Session, user_id: str, payee_id: str) -> int:
    """Everything sent to one payee so far, plus transfers to them that are scheduled and not yet run."""
    posted = session.exec(
        select(func.coalesce(func.sum(-Txn.amount_fen), 0)).where(
            Txn.user_id == user_id, Txn.payee_id == payee_id, Txn.kind.in_(PAYMENT_KINDS), Txn.status == "posted",
        )
    ).one()
    scheduled = session.exec(
        select(func.coalesce(func.sum(ScheduledTransfer.amount_fen), 0)).where(
            ScheduledTransfer.user_id == user_id, ScheduledTransfer.payee_id == payee_id,
            ScheduledTransfer.status.in_(["scheduled", "waiting_approval"]),
        )
    ).one()
    return int(posted) + int(scheduled)
