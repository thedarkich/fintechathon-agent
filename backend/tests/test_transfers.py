"""How the simulated bank processes a transfer: route, arrival options, cancel, returns and the payee's phone."""

from sqlmodel import Session, select

from app.bank import ledger
from app.models import BankAccount, PayeeMessage, SmsMessage, Txn


def plan_of(body):
    return body["plan"]


def balance(bank) -> int:
    with Session(bank.runtime.engine) as session:
        user_id = session.exec(select(BankAccount.user_id)).first()
        return ledger.checking(session, user_id).balance_fen


def checking_txns(bank) -> dict[str, Txn]:
    with Session(bank.runtime.engine) as session:
        user_id = session.exec(select(BankAccount.user_id)).first()
        account = ledger.checking(session, user_id)
        return {t.id: t for t in session.exec(select(Txn).where(Txn.account_id == account.id))}


def latest(bank, lang="zh"):
    return bank.get("/api/bank/transfers", lang=lang).json()["items"][0]


def test_same_bank_transfer_arrives_at_once(bank):
    plan = plan_of(bank.chat("给老婆转200"))
    assert "行内转账" in plan["steps"][0]["text"]
    assert bank.approve(plan).status_code == 200
    transfer = latest(bank)
    assert transfer["route"] == "internal" and transfer["status"] == "arrived"
    assert [e["status"] for e in transfer["events"]] == ["accepted", "clearing", "arrived"]
    phone = bank.get("/api/payee-phone").json()["items"]
    assert phone and "收到" in phone[0]["text"] and "200.00" in phone[0]["text"]


def test_other_bank_goes_through_the_interbank_system(bank):
    plan = plan_of(bank.chat("给妈妈转200"))
    result = bank.approve(plan).json()
    assert "已到账" in result["messages"][-1]["text"]
    transfer = latest(bank)
    assert transfer["route"] == "ibps" and transfer["status"] == "arrived"


def test_risky_transfer_waits_two_hours_and_can_be_cancelled(bank):
    plan = plan_of(bank.chat("给周凯转800"))  # a payee added today, over ¥500
    assert plan["tier"] == "red" and "2 小时后到账" in plan["steps"][0]["text"]
    before = balance(bank)
    assert bank.verify(bank.purpose(plan)).status_code == 200
    transfer = latest(bank)
    assert transfer["status"] == "accepted" and transfer["cancellable"]
    assert transfer["arrival"] == "standard" and transfer["arrival_reason"] == "S_NEW_PAYEE_LARGE"
    assert balance(bank) == before - 80_000  # the money has left
    cancel = plan_of(bank.chat("撤销给周凯的转账"))
    assert cancel["steps"][0]["action"] == "transfer_cancel" and cancel["tier"] == "yellow"
    assert bank.approve(cancel).status_code == 200
    assert latest(bank)["status"] == "cancelled"
    assert balance(bank) == before
    with Session(bank.runtime.engine) as session:
        assert "已撤销" in session.exec(select(SmsMessage).order_by(SmsMessage.at.desc())).first().text


def test_payee_bank_returns_a_name_mismatch(bank):
    plan = bank.purpose(plan_of(bank.chat("给周凯转800")))  # the customer goes ahead despite the name warning
    assert bank.verify(plan).status_code == 200
    before_return, before_txns = balance(bank), set(checking_txns(bank))
    bank.post("/api/demo/advance", {"hours": 3})  # the arrival time passes; the other bank checks the name
    transfer = latest(bank)
    assert transfer["status"] == "returned" and "户名" in transfer["reason"]
    new = [t for i, t in checking_txns(bank).items() if i not in before_txns]
    assert [t.amount_fen for t in new if t.kind == "refund"] == [80_000]
    # a renewal that falls due in those three hours (depends on today's date) posts as well
    assert balance(bank) == before_return + sum(t.amount_fen for t in new)
    with Session(bank.runtime.engine) as session:
        assert session.exec(select(PayeeMessage)).first() is None  # nothing reached the payee
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


def test_demo_tools_can_make_the_payee_bank_return_it(bank):
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


def rows_of(plan) -> dict:
    return {d["label"]: d["value"] for d in plan["steps"][0]["details"]}


def test_name_is_checked_before_any_money_moves(bank):
    mom = plan_of(bank.chat("给妈妈转100"))
    assert mom["tier"] == "yellow" and rows_of(mom)["户名核验"] == "一致" and not mom["steps"][0]["purpose_needed"]
    seller = plan_of(bank.chat("给周凯转100"))  # saved as 周凯, but the account is held by 周楷
    rows = rows_of(seller)
    assert seller["tier"] == "red" and seller["steps"][0]["signal_codes"] == ["S_NAME_MISMATCH"]
    assert rows["户名核验"].startswith("不一致") and "*楷" in rows["户名核验"] and "周楷" not in rows["户名核验"]
    assert rows["到账"].startswith("2 小时后")  # the rules delay it, so it can still be cancelled
    english = plan_of(bank.chat("send 100 to Zhou Kai", lang="en"))
    assert "Doesn't match" in rows_of(english)["Name check"]


def test_a_risky_payment_says_what_it_is_for_before_approval(bank):
    plan = plan_of(bank.chat("给周凯转800"))
    step = plan["steps"][0]
    assert step["purpose_needed"] and len(step["purpose_options"]) == 6
    code = bank.post(f"/api/plans/{plan['id']}/sms").json()
    refused = bank.verify(plan)
    assert refused.status_code == 409 and refused.json()["code"] == "PURPOSE_NEEDED"
    chosen = bank.purpose(plan, "goods")
    assert chosen["approval_hash"] != plan["approval_hash"]  # the slip changed, so it needs a fresh yes
    assert "担保交易" in rows_of(chosen)["风险提示"] and not chosen["steps"][0]["purpose_needed"]
    assert bank.verify(plan).json()["code"] == "PLAN_CHANGED"
    assert code and bank.verify(chosen).status_code == 200


def test_a_scam_purpose_is_warned_and_held_until_tomorrow(bank):
    plan = bank.purpose(plan_of(bank.chat("给周凯转800")), "safe_account")
    rows = rows_of(plan)
    assert "S_SCAM_PURPOSE" in plan["steps"][0]["signal_codes"] and plan["tier"] == "red"
    assert "安全账户" in rows["风险提示"] and rows["到账"].startswith("次日凌晨")
    assert bank.verify(plan).status_code == 200
    transfer = latest(bank)
    assert transfer["arrival"] == "next_day" and transfer["arrival_reason"] == "S_SCAM_PURPOSE" and transfer["cancellable"]


def test_the_ai_cannot_fill_in_the_purpose(bank):
    from app.agent.planner import PlanOut, StepOut, validate

    errors = validate(PlanOut(steps=[StepOut(id="s1", action="transfer", args={"payee": "周凯", "amount_yuan": 800, "purpose": "family"})]), "")
    assert errors  # purpose is not an argument the planner can set
    plain = plan_of(bank.chat("给妈妈转100"))
    assert bank.post(f"/api/plans/{plain['id']}/purpose", {"step_id": "s1", "purpose": "family"}).status_code == 404


def test_the_customer_chooses_when_the_money_arrives(bank):
    response = bank.post("/api/screens/plan", {"action": "transfer", "args": {"payee": "王秀英", "amount_yuan": 100, "arrival": "next_day"}, "lang": "zh"})
    plan = response.json()["plan"]
    assert plan["tier"] == "yellow" and rows_of(plan)["到账"].startswith("次日凌晨")
    assert bank.approve(plan).status_code == 200
    transfer = latest(bank)
    assert transfer["status"] == "accepted" and transfer["arrival"] == "next_day" and transfer["arrival_reason"] is None
    assert transfer["cancellable"]
