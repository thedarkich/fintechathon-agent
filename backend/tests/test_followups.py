"""The assistant remembers the request before: short follow-ups are completed from it by fixed code."""

import pytest
from sqlmodel import Session

from app.models import Plan


def args_of(bank, body):
    """The arguments the request was planned with, as stored (the API shows the customer's view instead)."""
    with Session(bank.runtime.engine) as session:
        return session.get(Plan, body["plan"]["id"]).steps[0]["args"]


def steps(body):
    plan = body["plan"] or {}
    return [(s["action"], s.get("fen")) for s in plan.get("steps", [])]


def payee_of(body):
    return body["plan"]["steps"][0]["details"][0]["value"]


def test_again_and_pronouns_mean_the_same_person(bank):
    bank.chat("给妈妈转200")
    again = bank.chat("再转100")
    assert steps(again) == [("transfer", 10_000)] and "王秀英" in payee_of(again)
    her = bank.chat("再给她转50")
    assert steps(her) == [("transfer", 5_000)] and "王秀英" in payee_of(her)


def test_changing_the_amount_replaces_the_open_card(bank):
    first = bank.chat("给妈妈转200")["plan"]
    changed = bank.chat("改成300")
    assert steps(changed) == [("transfer", 30_000)]
    old = next(p for p in bank.get("/api/plans").json()["items"] if p["id"] == first["id"])
    assert old["status"] == "cancelled"  # the card with ¥200 can no longer be confirmed


def test_the_same_for_someone_else(bank):
    bank.chat("给妈妈转200")
    body = bank.chat("爸爸也一样")
    assert steps(body) == [("transfer", 20_000)] and "妈妈" not in payee_of(body)


def test_never_mind_cancels_the_open_request(bank):
    plan = bank.chat("给妈妈转200")["plan"]
    body = bank.chat("算了，不转了")
    assert body["plan"]["id"] == plan["id"] and body["plan"]["status"] == "cancelled"
    assert "已取消" in body["messages"][-1]["text"]


def test_spending_follow_ups_keep_the_question(bank):
    bank.chat("上个月钱都花哪了")
    assert steps(bank.chat("那这个月呢")) == [("spending", None)]
    body = bank.chat("餐饮呢")
    assert steps(body) == [("spending", None)] and args_of(bank, body) == {"period": "month", "offset": 0, "category": "dining"}


def test_another_card_gets_the_same_action(bank):
    bank.chat("冻结我的虚拟卡")
    body = bank.chat("那借记卡呢")
    assert steps(body) == [("card_freeze", None)] and args_of(bank, body)["card"] == "debit"


def test_picking_from_a_list_by_position(bank):
    recommended = bank.chat("有10万一年不用，推荐个理财")["messages"][-1]["cards"][0]["items"]
    body = bank.chat("就买第二个")
    assert body["plan"]["steps"][0]["action"] == "wealth_subscribe" and args_of(bank, body)["product"] == recommended[1]["name"]


def test_cancel_the_nth_subscription(bank):
    bank.chat("我有哪些自动续费")
    body = bank.chat("取消第一个")
    assert body["plan"]["steps"][0]["action"] == "subscription_cancel" and args_of(bank, body)["merchant"]


@pytest.mark.parametrize("text", ["给房东转3200房租", "我卡里还有多少钱", "冻结我的虚拟卡"])
def test_a_full_new_request_is_not_taken_as_a_follow_up(bank, text):
    bank.chat("给妈妈转200")
    body = bank.chat(text)
    assert body["plan"]["source"] != "followup"


def test_english_follow_ups(bank):
    bank.chat("Send Mom 200", lang="en")
    body = bank.chat("Send her another 50", lang="en")
    assert steps(body) == [("transfer", 5_000)]
    bank.chat("Where did my money go last month?", lang="en")
    dining = bank.chat("And dining?", lang="en")
    assert args_of(bank, dining) == {"period": "month", "offset": -1, "category": "dining"}


def test_which_one_keeps_the_amount_already_said(bank):
    bank.chat("有10万一年不用，推荐个理财")
    assert "要买哪一个" in bank.chat("买5000")["messages"][-1]["text"]
    body = bank.chat("第二个")
    assert body["plan"]["steps"][0]["action"] == "wealth_subscribe" and args_of(bank, body)["amount_yuan"] == 5000
