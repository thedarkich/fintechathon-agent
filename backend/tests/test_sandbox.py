"""The analysis sandbox: unsafe code never runs, runaway code is stopped, results are audited."""

from datetime import date
from types import SimpleNamespace

import pytest
from sqlmodel import Session, select

from app.agent.actions.analysis import analyze_reply
from app.models import AuditEntry
from app.sandbox import runner, templates
from app.sandbox.guard import CodeRejected, check

TXNS = [
    {"date": "2026-10-03", "weekday": 5, "hour": 21, "minute": 0, "amount": -30.0, "merchant": "星巴克(楚河汉街店)",
     "category": "dining", "channel": "pos", "kind": "card"},
    {"date": "2026-10-05", "weekday": 0, "hour": 8, "minute": 10, "amount": -15.9, "merchant": "瑞幸咖啡",
     "category": "dining", "channel": "pos", "kind": "card"},
]


@pytest.mark.parametrize("code", [
    "import os\ndef answer(txns):\n    return {'title': 'x'}",
    "def answer(txns):\n    return open('/etc/passwd').read()",
    "def answer(txns):\n    return txns.__class__",
    "def answer(txns):\n    g = (x for x in txns)\n    return g.gi_frame.f_globals",
    "def answer(txns):\n    return '{0.__class__}'.format(txns)",
    "def answer(txns):\n    return {}['__builtins__']",
    "from subprocess import run\ndef answer(txns):\n    return run",
    "def answer(txns):\n    try:\n        pass\n    except Exception:\n        pass",
    "class X:\n    pass\ndef answer(txns):\n    return X",
    "x = 1",
    "def answer(txns):\n    return getattr(txns, 'copy')",
])
def test_unsafe_code_is_rejected(code):
    with pytest.raises(CodeRejected):
        check(code)
    with pytest.raises(runner.SandboxError) as error:
        runner.run(code, TXNS)
    assert error.value.code.startswith("REJECTED_")


def test_template_runs_in_the_sandbox():
    code = templates.from_question("周末晚上8点后喝咖啡花了多少钱", date(2026, 10, 12))
    check(code)
    outcome = runner.run(code, TXNS)
    assert outcome["result"]["value"] == 30.0  # only the Saturday-evening Starbucks
    assert outcome["limits"]["memory_mb"] == 256


def test_strptime_works_but_its_helper_module_stays_out_of_reach():
    code = ("from datetime import datetime\ndef answer(txns):\n"
            "    days = [datetime.strptime(t['date'], '%Y-%m-%d').day for t in txns]\n"
            "    return {'title': 'days', 'value': sum(days), 'unit': 'count', 'rows': []}")
    assert runner.run(code, TXNS)["result"]["value"] == 8  # strptime imports _strptime internally
    with pytest.raises(CodeRejected):
        check("import _strptime\ndef answer(txns):\n    return {'title': 'x'}")


def test_infinite_loop_is_stopped():
    with pytest.raises(runner.SandboxError) as error:
        runner.run("def answer(txns):\n    while True:\n        pass", TXNS)
    assert error.value.code in ("TIMEOUT", "RUNTIME_KILLED")


def test_memory_bomb_is_stopped():
    with pytest.raises(runner.SandboxError) as error:
        runner.run("def answer(txns):\n    return {'title': 'x', 'rows': [[1, 1]] * 10**9}", TXNS)
    assert error.value.code.startswith("RUNTIME_")


def test_bad_result_shape_is_refused():
    with pytest.raises(runner.SandboxError):
        runner.run("def answer(txns):\n    return [1, 2, 3]", TXNS)


def test_open_question_in_chat_runs_in_sandbox_and_is_audited(bank):
    body = bank.chat("周末晚上8点后喝咖啡花了多少钱")
    plan = body["plan"]
    assert plan["steps"][0]["action"] == "analyze" and plan["status"] == "done"
    assert plan["steps"][0]["tier"] == "green"
    card = body["messages"][-1]["cards"][0]
    assert card["type"] == "analysis" and "def answer" in card["code"]
    assert all(f"· {label} " in body["messages"][-1]["text"] for label, _ in card["rows"][:12])
    with Session(bank.runtime.engine) as session:
        run = session.exec(select(AuditEntry).where(AuditEntry.kind == "sandbox_run")).one()
        assert run.data["code_hash"] == card["code_hash"] and "error" not in run.data


def test_count_question(bank):
    body = bank.chat("how many times did I take a taxi after 10pm this year", lang="en")
    assert body["plan"]["steps"][0]["action"] == "analyze"
    assert body["messages"][-1]["cards"][0]["unit"] == "count"


@pytest.mark.parametrize("count", [7, 14])
def test_reply_lists_the_rows_behind_the_total(count):
    ctx = SimpleNamespace(lang="en", t=lambda zh, en: en)
    rows = [[f"2026-{m:02d}", 10.0] for m in range(1, count + 1)]
    text = analyze_reply(ctx, {}, {"title": "Coffee", "value": 10.0 * count, "unit": "yuan", "rows": rows, "ms": 5})
    assert all(f"· {label} " in text for label, _ in rows[:12])
    assert ("2 more rows not listed" in text) == (count == 14)
