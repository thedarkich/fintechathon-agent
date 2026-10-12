"""Open-ended questions answered by generated code running in the sandbox (green: read-only,
the customer's own data only). The code, its hash, the limits and the outcome are audited."""

from datetime import timedelta

from pydantic import Field

from app import clock
from app.agent import audit, locks
from app.agent.core import Action, Args, Ctx, Refuse, register
from app.bank.analysis import txns_between
from app.money import yuan
from app.sandbox import runner
from app.sandbox.guard import CodeRejected, check


class AnalyzeArgs(Args):
    question: str = Field(min_length=1, max_length=300)
    code: str | None = Field(default=None, max_length=4000)


def analyze_resolve(ctx: Ctx, args: AnalyzeArgs) -> dict:
    if not args.code:
        raise Refuse("NEEDS_CODE", "这个问题需要由 AI 编写分析代码，当前未启用 AI 模型。可以换成按类别或按月份的问题。",
                     "This question needs analysis code written by the AI model, which isn't enabled. Try asking by category or by month.")
    try:
        check(args.code)
    except CodeRejected as exc:
        audit.append(ctx.session, ctx.user.id, "plan_rejected", {"errors": [f"CODE_{exc}"]}, ctx.plan.id if ctx.plan else None)
        locks.evaluate(ctx.session, ctx.user.id)
        raise Refuse("CODE_REJECTED", "生成的分析代码没有通过安全检查，未执行。", "The generated analysis code failed the safety check and was not run.") from None
    return {"question": args.question, "code": args.code, "code_hash": runner.code_hash(args.code)}


def sandbox_rows(ctx: Ctx) -> list[dict]:
    rows = txns_between(ctx.session, ctx.user.id, ctx.today - timedelta(days=730), ctx.today + timedelta(days=1))
    out = []
    for t in rows:
        if t.status != "posted" or t.kind == "internal":
            continue
        when = clock.parse(t.at)
        out.append({"date": when.date().isoformat(), "weekday": when.weekday(), "hour": when.hour, "minute": when.minute,
                    "amount": t.amount_fen / 100, "merchant": t.counterparty, "category": t.category,
                    "channel": t.channel, "kind": t.kind})
    return out


def analyze_run(ctx: Ctx, r: dict) -> dict:
    plan_id = ctx.plan.id if ctx.plan else None
    try:
        outcome = runner.run(r["code"], sandbox_rows(ctx))
    except runner.SandboxError as exc:
        audit.append(ctx.session, ctx.user.id, "sandbox_run", {"code_hash": r["code_hash"], "code": r["code"],
                                                              "limits": runner.LIMITS, "error": exc.code}, plan_id)
        raise Refuse("SANDBOX_FAILED", f"分析代码在沙箱中运行失败（{exc.code}），没有产生结果。",
                     f"The analysis code failed in the sandbox ({exc.code}) and produced no result.") from None
    audit.append(ctx.session, ctx.user.id, "sandbox_run", {"code_hash": r["code_hash"], "code": r["code"],
                                                          "limits": outcome["limits"], "ms": outcome["ms"],
                                                          "rows": len(outcome["result"]["rows"])}, plan_id)
    return {**outcome["result"], "ms": outcome["ms"], "code_hash": outcome["code_hash"], "limits": outcome["limits"]}


def fmt(value, unit: str, lang: str) -> str:
    if value is None:
        return ""
    if unit == "count":
        return f"{int(value)} 次" if lang == "zh" else f"{int(value)} times"
    if unit == "percent":
        return f"{value:.1f}%"
    return yuan(round(value * 100))


def analyze_reply(ctx: Ctx, r: dict, res: dict) -> str:
    lines = [f"{res['title']}: {fmt(res['value'], res['unit'], ctx.lang)}" if res["value"] is not None else res["title"]]
    for label, value in res["rows"][-6:]:
        lines.append(f"· {label} {fmt(value, res['unit'], ctx.lang)}")
    lines.append(ctx.t(f"（由生成的代码在隔离沙箱中计算，用时 {res['ms']} 毫秒；代码和结果已记入审计。）",
                       f"(Computed by generated code in an isolated sandbox in {res['ms']} ms; the code and result are in the audit log.)"))
    return "\n".join(lines)


register(Action(
    name="analyze", args=AnalyzeArgs,
    help="Open-ended question about the customer's own transactions that spending/report/transactions cannot answer "
         "(time of day, weekdays, counts, averages, combinations). code: Python defining answer(txns) that returns "
         "{'title': str, 'value': number or None, 'unit': 'yuan'|'count'|'percent', 'rows': [[label, number], ...]}. "
         "Each txn is a dict: date 'YYYY-MM-DD', weekday 0-6 (Mon=0), hour, minute, amount (yuan, negative = money out), "
         "merchant, category, channel, kind. Only math, statistics, datetime, collections, itertools may be imported; "
         "no I/O, no printing, no names or attributes starting with an underscore.",
    resolve=analyze_resolve, run=analyze_run,
    describe=lambda ctx, r: ctx.t(f"在沙箱中分析：{r['question']}", f"Analyse in the sandbox: {r['question']}"),
    reply=analyze_reply,
    card=lambda ctx, r, res: {"type": "analysis", **res, "code": r["code"]},
    examples=["周末晚上8点后喝咖啡花了多少钱", "how many times did I take a taxi after 10pm this year"],
))
