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


def test_a_purchase_that_names_its_product_is_not_a_follow_up(bank):
    bank.chat("有10万一年不用，推荐个理财")
    body = bank.chat("申购安盈短债5000元")
    step = body["plan"]["steps"][0]
    assert body["plan"]["source"] != "followup" and step["action"] == "wealth_subscribe" and "安盈短债" in step["text"]


@pytest.mark.parametrize("prior, text, action", [
    ("上个月钱都花哪了", "本月账单总结", "report"),
    ("上个月钱都花哪了", "What were my expenses on shopping last month?", "spending"),
    ("有10万一年不用，推荐个理财", "Undo the last transfer", "transfer_cancel"),
    ("有10万一年不用，推荐个理财", "how many times did I take a taxi after 10pm this year", "analyze"),
    ("有10万一年不用，推荐个理财", "爸爸生日快到了，帮我预留500买礼物", "contact_lookup"),
])
def test_a_request_of_its_own_is_not_bent_into_a_follow_up(bank, prior, text, action):
    bank.chat(prior)
    body = bank.chat(text, lang="en" if text.isascii() else "zh")
    assert body["plan"]["source"] != "followup" and body["plan"]["steps"][0]["action"] == action



# ---- the conversation keeps its thread ----

def last_text(body):
    return body["messages"][-1]["text"]


def test_an_answer_to_the_assistants_question_joins_the_request(bank):
    assert "转给谁" in last_text(bank.chat("转钱"))
    body = bank.chat("妈妈")  # not a new request: the payee for the transfer just asked about
    assert body["plan"]["steps"][0]["action"] == "transfer" and "金额" in last_text(body)
    done = bank.chat("200")
    assert steps(done) == [("transfer", 20_000)] and "王秀英" in payee_of(done)


def test_an_amount_said_before_the_question_is_kept(bank):
    assert "转给谁" in last_text(bank.chat("转200"))
    body = bank.chat("给妈妈")
    assert steps(body) == [("transfer", 20_000)] and "王秀英" in payee_of(body)


def test_yes_in_words_points_to_the_button_and_approves_nothing(bank):
    plan = bank.chat("给妈妈转200")["plan"]
    body = bank.chat("好的")
    assert "确认" in last_text(body) and "不能替你确认" in last_text(body)
    still = next(p for p in bank.get("/api/plans").json()["items"] if p["id"] == plan["id"])
    assert still["status"] == "awaiting_approval"


@pytest.mark.parametrize("text, fen, who", [
    ("300吧", 30_000, "王秀英"), ("金额改成250", 25_000, "王秀英"), ("再来一笔", 20_000, "王秀英"), ("同样再转一次", 20_000, "王秀英"),
    ("不是妈妈，是爸爸", 20_000, None), ("换成爸爸", 20_000, None), ("换成周凯", 20_000, "周凯"),
])
def test_changes_and_repeats_of_a_transfer(bank, text, fen, who):
    bank.chat("给妈妈转200")
    body = bank.chat(text)
    assert steps(body) == [("transfer", fen)]
    assert (who in payee_of(body)) if who else ("王秀英" not in payee_of(body))


def test_arrival_and_note_change_the_open_card(bank):
    first = bank.chat("给妈妈转200")["plan"]
    later = bank.chat("改成2小时后到账")
    assert args_of(bank, later)["arrival"] == "standard"
    noted = bank.chat("备注生活费")
    assert args_of(bank, noted)["memo"] == "生活费" and args_of(bank, noted)["arrival"] == "standard"
    statuses = {p["id"]: p["status"] for p in bank.get("/api/plans").json()["items"]}
    assert statuses[first["id"]] == "cancelled" and statuses[later["plan"]["id"]] == "cancelled"


def test_another_kind_of_request_is_not_a_transfer_change(bank):
    bank.chat("给妈妈转200")
    body = bank.chat("把借记卡日限额改成5000")
    assert body["plan"]["steps"][0]["action"] == "card_limit"


def test_recall_what_was_just_asked(bank):
    bank.chat("给妈妈转200")
    assert "¥200.00" in last_text(bank.chat("我刚才转了多少"))


def test_a_question_keeps_the_period(bank):
    bank.chat("上个月钱都花哪了")
    body = bank.chat("那吃饭花了多少")
    assert args_of(bank, body)["offset"] == -1 and args_of(bank, body)["category"] == "dining"
    assert args_of(bank, bank.chat("去年同期呢"))["offset"] == -13


def test_card_action_on_the_card_just_discussed(bank):
    bank.chat("冻结我的虚拟卡")
    body = bank.chat("解冻吧")
    assert body["plan"]["steps"][0]["action"] == "card_unfreeze" and args_of(bank, body)["card"] == "virtual"


def test_positions_with_chinese_amounts_and_questions_about_them(bank):
    items = bank.chat("有10万一年不用，推荐个理财")["messages"][-1]["cards"][0]["items"]
    assert items[0]["name"] in last_text(bank.chat("第一个风险高吗"))
    body = bank.chat("第二个吧，五千")
    assert args_of(bank, body) == {"product": items[1]["name"], "amount_yuan": 5000}


def test_subscription_kind_and_duplicates(bank):
    bank.chat("我有哪些自动续费")
    assert "重复的有" in last_text(bank.chat("把重复的取消"))
    body = bank.chat("音乐的那个取消")
    assert body["plan"]["steps"][0]["action"] == "subscription_cancel"


def test_the_birthday_plan_changed_in_words(bank):
    first = bank.chat("下个月老婆生日，帮我预留1000，提前两天订花和蛋糕")["plan"]
    body = bank.chat("只要蛋糕")
    assert [s["action"] for s in body["plan"]["steps"]].count("merchant_order") == 1
    statuses = {p["id"]: p["status"] for p in bank.get("/api/plans").json()["items"]}
    assert statuses[first["id"]] == "cancelled"


def test_a_question_with_its_own_time_keeps_it(bank):
    bank.chat("上个月钱都花哪了")
    body = bank.chat("最近是不是花太多了")
    assert body["plan"]["source"] != "followup"
