"""The app's own screens: transfer by phone number, Payments and QR pay go through the same rules as chat."""

from sqlmodel import Session, select

from app.agent.planner import PlanOut, StepOut, catalogue, validate
from app.bank import directory, qr
from app.models import BillPayment, Notification, Payee, Txn

MOM = "13971230418"  # a saved payee in the demo data


def numbers(found: bool):
    """Phone numbers the made-up directory does (or does not) know, none of them a saved payee."""
    for n in range(13600000000, 13600009999):
        phone = str(n)
        if (directory.lookup(phone) is not None) == found:
            yield phone


def screen(bank, action, **args):
    response = bank.post("/api/screens/plan", {"action": action, "args": args, "lang": "zh"})
    assert response.status_code == 200, response.text
    return response.json()["plan"]


def test_phone_lookup_tells_saved_known_and_unknown_numbers_apart(bank):
    assert bank.get("/api/directory", phone=MOM).json()["kind"] == "payee"
    known = bank.get("/api/directory", phone=next(numbers(True))).json()
    assert known["kind"] == "directory" and known["name"].startswith("*")
    assert bank.get("/api/directory", phone=next(numbers(False))).json()["kind"] == "none"


def test_first_transfer_to_a_number_is_a_new_payee(bank):
    phone = next(numbers(True))
    plan = screen(bank, "phone_transfer", phone=phone, amount_yuan=200)
    assert plan["source"] == "screen" and plan["tier"] == "yellow"
    labels = [d["label"] for d in plan["steps"][0]["details"]]
    assert "手机号" in labels and "提醒" in labels
    done = bank.approve(plan).json()["plan"]
    assert done["status"] == "done"
    with Session(bank.runtime.engine) as session:
        payee = session.exec(select(Payee).where(Payee.phone == phone)).one()
        assert payee.name.startswith("*")  # saved under the masked name the customer saw
    # ¥200 + ¥400 to a payee added today is over ¥500: red, and the money waits 2 hours
    second = screen(bank, "phone_transfer", phone=phone, amount_yuan=400)
    assert second["tier"] == "red" and "S_NEW_PAYEE_LARGE" in second["steps"][0]["signal_codes"]
    assert any(d["value"].startswith("2 小时后") for d in second["steps"][0]["details"])


def test_a_number_without_a_bank_account_is_refused(bank):
    assert screen(bank, "phone_transfer", phone=next(numbers(False)), amount_yuan=50)["status"] == "failed"


def test_scam_words_in_a_note_raise_the_tier(bank):
    plan = screen(bank, "phone_transfer", phone=MOM, amount_yuan=100, memo="转到安全账户")
    assert plan["tier"] == "red" and "SCAM_SCRIPT" in plan["flags"]


def test_screen_actions_stay_out_of_chat(bank):
    assert "phone_transfer" not in catalogue() and "qr_pay" not in catalogue()
    assert validate(PlanOut(steps=[StepOut(id="s1", action="qr_pay", args={"code": "M1001", "amount_yuan": 5})]), "") \
        == ["SCREEN_ONLY:qr_pay"]
    assert bank.post("/api/screens/plan", {"action": "password_change", "args": {}}).status_code == 422
    screen(bank, "qr_pay", code="M1001", amount_yuan=18)
    assert bank.get("/api/conversations").json()["items"] == []  # screen requests are not chats


def test_pay_a_bill_then_nothing_is_due(bank):
    lookup = bank.get("/api/bills/lookup", provider="sgcc", account="4201123456").json()
    assert lookup["due_fen"] > 0 and lookup["holder"].startswith("*")
    plan = screen(bank, "bill_pay", provider="sgcc", account="4201123456", save=True)
    assert plan["tier"] == "yellow" and plan["steps"][0]["fen"] == lookup["due_fen"]
    assert bank.approve(plan).json()["plan"]["status"] == "done"
    assert bank.get("/api/bills/lookup", provider="sgcc", account="4201123456").json()["due_fen"] == 0
    assert screen(bank, "bill_pay", provider="sgcc", account="4201123456")["status"] == "failed"  # NOTHING_DUE
    assert any(b["account"] == "4201123456" for b in bank.get("/api/bills").json()["items"])
    assert bank.get("/api/bills/lookup", provider="sgcc", account="12").status_code == 422


def test_bills_paid_by_direct_debit_become_automatic_payments(bank):
    items = bank.get("/api/bills").json()["items"]
    electricity = next(b for b in items if b["provider"]["code"] == "sgcc")
    assert electricity["autopay"] and electricity["autopay_limit_fen"] == 30_000
    bank.post("/api/demo/advance", {"days": 40})
    with Session(bank.runtime.engine) as session:
        assert session.exec(select(BillPayment).where(BillPayment.provider == "sgcc", BillPayment.auto == True)).first()  # noqa: E712


def test_autopay_never_pays_over_its_limit(bank):
    plan = screen(bank, "bill_autopay", provider="donghu", account="88001234", on=True, limit_yuan=50)
    assert plan["tier"] == "yellow"
    bank.approve(plan)
    bank.post("/api/demo/advance", {"days": 40})
    with Session(bank.runtime.engine) as session:
        assert not session.exec(select(BillPayment).where(BillPayment.provider == "donghu")).first()
        assert session.exec(select(Notification).where(Notification.key.startswith("autopay:"))).first()


def test_qr_codes_and_payments_count_towards_the_day(bank):
    shop = bank.get("/api/qr/merchants").json()["items"][0]
    assert bank.get("/api/qr/read", p=shop["payload"]).json()["valid"]
    link = "https://bank.example/#/qr?p=" + qr.payload("M1002", 1850, "A-77")
    read = bank.get("/api/qr/read", p=link).json()
    assert read["fen"] == 1850 and read["order"] == "A-77"
    assert not bank.get("/api/qr/read", p="https://phish.example/login").json()["valid"]
    first = screen(bank, "qr_pay", code="M1002", amount_yuan=18.5, order="A-77")
    assert first["tier"] == "yellow"
    bank.approve(first)
    with Session(bank.runtime.engine) as session:
        txn = session.exec(select(Txn).where(Txn.kind == "qr")).one()
        assert txn.amount_fen == -1850 and txn.channel == "pos"
    assert screen(bank, "qr_pay", code="M1001", amount_yuan=990)["tier"] == "red"  # ¥18.50 + ¥990 > ¥1,000


def test_chat_transfer_to_an_unsaved_number_uses_the_phone_directory(bank):
    phone = next(numbers(True))
    masked = directory.lookup(phone)["masked"]
    plan = bank.chat(f"给{phone}转100")["plan"]
    step = plan["steps"][0]
    assert plan["status"] == "awaiting_approval" and plan["tier"] == "yellow" and step["action"] == "transfer"
    rows = {d["label"]: d["value"] for d in step["details"]}
    assert rows["收款人"] == masked and rows["手机号"] == directory.mask_phone(phone) and "提醒" in rows
    assert masked in step["text"] and "第一次转给 TA" in step["text"]
    assert bank.approve(plan).json()["plan"]["status"] == "done"
    with Session(bank.runtime.engine) as session:
        assert session.exec(select(Payee).where(Payee.phone == phone)).one().name == masked
    kinds = [e["kind"] for e in bank.get("/api/audit", plan_id=plan["id"]).json()["items"]]
    assert {"resolution", "policy", "approved", "transfer", "step_done"} <= set(kinds)
    assert bank.get("/api/audit/verify").json()["ok"]
    # ¥100 + ¥500 to a payee added today is over ¥500: red, and the money waits 2 hours as on the screen
    second = bank.chat(f"给{phone}转500")["plan"]
    assert second["tier"] == "red" and "S_NEW_PAYEE_LARGE" in second["steps"][0]["signal_codes"]
    assert bank.verify(second).json()["plan"]["status"] == "done"
    transfer = next(t for t in bank.get("/api/bank/transfers").json()["items"] if t["plan_id"] == second["id"])
    assert transfer["status"] == "accepted" and transfer["arrival_reason"] == "S_NEW_PAYEE_LARGE" and transfer["cancellable"]


def test_chat_transfer_over_500_to_a_new_number_is_red_and_delayed(bank):
    plan = bank.chat(f"给{next(numbers(True))}转600")["plan"]
    step = plan["steps"][0]
    assert plan["tier"] == "red" and "S_NEW_PAYEE_LARGE" in step["signal_codes"]
    assert any(d["value"].startswith("2 小时后") for d in step["details"])


def test_chat_transfer_prefers_a_saved_payee_and_refuses_unlinked_numbers(bank):
    saved = bank.chat(f"给{MOM}转100")["plan"]["steps"][0]
    assert "王秀英" in saved["text"] and "phone_masked" not in saved.get("resolved", {})
    assert all(d["label"] != "提醒" for d in saved["details"])
    body = bank.chat(f"给{next(numbers(False))}转50")
    assert body["plan"]["status"] == "failed" and "没有绑定银行账户" in body["messages"][-1]["text"]
