"""How the simulated bank processes a transfer: route, arrival options, cancel, returns and the contact's phone."""

from sqlmodel import Session, select

from app.bank import ledger
from app.models import BankAccount, ContactMessage, SmsMessage


def plan_of(body):
    return body["plan"]


def balance(bank) -> int:
    with Session(bank.runtime.engine) as session:
        user_id = session.exec(select(BankAccount.user_id)).first()
        return ledger.checking(session, user_id).balance_fen


def latest(bank, lang="zh"):
    return bank.get("/api/bank/transfers", lang=lang).json()["items"][0]


def test_same_bank_transfer_arrives_at_once(bank):
    plan = plan_of(bank.chat("给老婆转200"))
    assert "行内转账" in plan["steps"][0]["text"]
    assert bank.approve(plan).status_code == 200
    transfer = latest(bank)
    assert transfer["route"] == "internal" and transfer["status"] == "arrived"
    assert [e["status"] for e in transfer["events"]] == ["accepted", "clearing", "arrived"]
    phone = bank.get("/api/contact-phone").json()["items"]
    assert phone and "收到" in phone[0]["text"] and "200.00" in phone[0]["text"]


def test_other_bank_goes_through_the_interbank_system(bank):
    plan = plan_of(bank.chat("给妈妈转200"))
    result = bank.approve(plan).json()
    assert "已到账" in result["messages"][-1]["text"]
    transfer = latest(bank)
    assert transfer["route"] == "ibps" and transfer["status"] == "arrived"


def test_risky_transfer_waits_two_hours_and_can_be_cancelled(bank):
    plan = plan_of(bank.chat("给周凯转800"))  # a contact added today, over ¥500
    assert plan["tier"] == "red" and "2 小时后到账" in plan["steps"][0]["text"]
    before = balance(bank)
    assert bank.verify(plan).status_code == 200
    transfer = latest(bank)
    assert transfer["status"] == "accepted" and transfer["cancellable"]
    assert transfer["arrival"] == "standard" and transfer["arrival_reason"] == "S_NEW_CONTACT_LARGE"
    assert balance(bank) == before - 80_000  # the money has left
    cancel = plan_of(bank.chat("撤销给周凯的转账"))
    assert cancel["steps"][0]["action"] == "transfer_cancel" and cancel["tier"] == "yellow"
    assert bank.approve(cancel).status_code == 200
    assert latest(bank)["status"] == "cancelled"
    assert balance(bank) == before
    with Session(bank.runtime.engine) as session:
        assert "已撤销" in session.exec(select(SmsMessage).order_by(SmsMessage.at.desc())).first().text


def test_contact_bank_returns_a_name_mismatch(bank):
    plan = plan_of(bank.chat("给周凯转800"))
    bank.verify(plan)
    before_return = balance(bank)
    bank.post("/api/demo/advance", {"hours": 3})  # the arrival time passes; the other bank checks the name
    transfer = latest(bank)
    assert transfer["status"] == "returned" and "户名" in transfer["reason"]
    assert balance(bank) == before_return + 80_000
    with Session(bank.runtime.engine) as session:
        assert session.exec(select(ContactMessage)).first() is None  # nothing reached the contact
    notes = bank.get("/api/notifications").json()["items"]
    assert any("退回" in n["title"] for n in notes)
    # History says what happened to the money, not only that the step ran
    row = next(p for p in bank.get("/api/plans").json()["items"] if p["id"] == plan["id"])
    assert row["status"] == "done" and row["outcome"] == "returned" and "户名" in row["reason"]


def test_customer_can_choose_next_day_arrival(bank):
    plan = plan_of(bank.chat("给妈妈转200，次日到账"))
    step = plan["steps"][0]
    assert step["action"] == "transfer" and "次日凌晨到账" in step["text"]  # not a transfer scheduled for tomorrow
    bank.approve(plan)
    transfer = latest(bank)
    assert transfer["status"] == "accepted"
    moved = bank.post(f"/api/demo/transfers/{transfer['id']}", {"outcome": "next"}).json()
    assert moved["status"] == "arrived"


def test_demo_tools_can_make_the_contact_bank_return_it(bank):
    plan = plan_of(bank.chat("给爸爸转300，2小时后到账"))
    assert plan["steps"][0]["text"].count("2 小时后到账") == 1
    bank.approve(plan)
    transfer = latest(bank)
    returned = bank.post(f"/api/demo/transfers/{transfer['id']}", {"outcome": "return", "reason": "ACCOUNT_FROZEN"}).json()
    assert returned["status"] == "returned" and returned["reason"] == "收款账户已冻结"
    again = bank.post(f"/api/demo/transfers/{transfer['id']}", {"outcome": "next"})
    assert again.status_code == 409


def test_nothing_to_cancel_is_refused(bank):
    plan = plan_of(bank.chat("撤销转账"))
    assert plan["status"] == "failed" and plan["steps"][0]["error_code"] == "NOTHING_TO_CANCEL"


def test_a_column_added_later_is_added_to_an_existing_database(tmp_path):
    import sqlite3

    from app.db import make_engine

    database = tmp_path / 'old.db'
    make_engine(database).dispose()
    con = sqlite3.connect(database)
    con.execute('ALTER TABLE transfer DROP COLUMN debit_txn_id')  # a database from before the column existed
    con.commit()
    con.close()
    make_engine(database).dispose()
    con = sqlite3.connect(database)
    assert 'debit_txn_id' in [row[1] for row in con.execute('PRAGMA table_info(transfer)')]
    con.close()
