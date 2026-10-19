"""The offline planner must understand the many ways a customer asks about their contacts."""

from datetime import date

import pytest

from app.agent.offline import plan

TODAY = date(2026, 10, 19)


@pytest.mark.parametrize("text", [
    "Who are my contacts?", "contact list", "show my contact list", "address book", "phone book", "通讯录", "我的联系人",
])
def test_contact_list_questions_list_contacts(text):
    assert [s.action for s in plan(text, TODAY).steps] == ["contacts"]


def test_contactless_is_a_card_switch_not_a_contact_question():
    assert [s.action for s in plan("turn off contactless", TODAY).steps] == ["card_restrict"]


@pytest.mark.parametrize("text", ["Send 100 to Zhou Kai", "Send 100 to my contact Zhou Kai", "transfer 100 to the contact Zhou Kai"])
def test_transfer_finds_the_name_after_contact(text):
    step = plan(text, TODAY).steps[0]
    assert (step.action, step.args["contact"]) == ("transfer", "Zhou Kai")


SAVED = ["周凯", "Zhou Kai", "王芳", "Wang Fang", "芳芳", "67"]


@pytest.mark.parametrize(("text", "contact", "amount"), [
    ("send 100 to zhou kai", "Zhou Kai", 100),  # any case
    ("send money to zhou kai", "Zhou Kai", None),  # the amount is asked for next
    ("can you send 300 yuan to 67", "67", 300),  # a name made of digits is not the amount
    ("can you send money to 67", "67", None),
    ("send 67 to wang fang", "Wang Fang", 67),
    ("给芳芳转50", "芳芳", 50),  # an alias
])
def test_transfer_finds_a_saved_name_however_it_is_written(text, contact, amount):
    step = plan(text, TODAY, contacts=SAVED).steps[0]
    assert (step.action, step.args["contact"], step.args["amount_yuan"]) == ("transfer", contact, amount)


def test_add_as_contact_starts_the_add_flow():
    assert [s.action for s in plan("add Li Ming as contact, phone 13800001111", TODAY).steps] == ["contact_add"]
