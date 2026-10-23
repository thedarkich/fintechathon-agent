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
    # how far back the rows handed to the code go: the bank enforces the window, so a wrong filter in generated code
    # can't quietly add up older years (Qwen titled a two-year total "last 12 months")
    days: int = Field(default=365, ge=7, le=730)


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
    return {"question": args.question, "code": args.code, "code_hash": runner.code_hash(args.code), "days": args.days}


def sandbox_rows(ctx: Ctx, days: int = 730) -> list[dict]:
    rows = txns_between(ctx.session, ctx.user.id, ctx.today - timedelta(days=days - 1), ctx.today + timedelta(days=1))
    out = []
    this_week = ctx.today - timedelta(days=ctx.today.weekday())
    for t in rows:
        if t.status != "posted" or t.kind == "internal":
            continue
        when = clock.parse(t.at)
        day = when.date()
        # the calendar arithmetic is done here, not by generated code (models got the year or the window wrong):
        # 0 = this month / week (from Monday) / year, -1 = the one before
        out.append({"date": day.isoformat(), "weekday": when.weekday(), "hour": when.hour, "minute": when.minute,
                    "days_ago": (ctx.today - day).days,
                    "month_offset": (day.year - ctx.today.year) * 12 + day.month - ctx.today.month,
                    "week_offset": (day - timedelta(days=day.weekday()) - this_week).days // 7,
                    "year_offset": day.year - ctx.today.year,
                    "amount": t.amount_fen / 100, "merchant": t.counterparty, "category": t.category,
                    "channel": t.channel, "kind": t.kind})
    return out


def analyze_run(ctx: Ctx, r: dict) -> dict:
    plan_id = ctx.plan.id if ctx.plan else None
    try:
        outcome = runner.run(r["code"], sandbox_rows(ctx, r.get("days", 365)))
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
    rows = res["rows"]
    head = res["title"]
    if res["value"] is not None:
        head += ("：" if ctx.lang == "zh" else ": ") + fmt(res["value"], res["unit"], ctx.lang)
    if rows and all(len(str(label)) == 7 and str(label)[4] == "-" for label, _ in rows):
        head += ctx.t(f"（{len(rows)} 个月有记录，按月列出）", f" ({len(rows)} months with any, by month)")
    lines = [head]
    for label, value in rows[:12]:
        lines.append(f"· {label} {fmt(value, res['unit'], ctx.lang)}")
    if len(rows) > 12:
        lines.append(ctx.t(f"（另有 {len(rows) - 12} 行未列出）", f"({len(rows) - 12} more rows not listed)"))
    scope = ctx.t(f"，数据范围为近 {r['days']} 天的交易", f" from the last {r['days']} days of transactions") if r.get("days") else ""
    lines.append(ctx.t(f"（由生成的代码在隔离沙箱中计算{scope}，用时 {res['ms']} 毫秒；代码和结果已记入审计。）",
                       f"(Computed by generated code in an isolated sandbox{scope} in {res['ms']} ms; the code and result are in the audit log.)"))
    return "\n".join(lines)


register(Action(
    name="analyze", args=AnalyzeArgs,
    help="Open-ended question about the customer's own transactions that spending/report/transactions cannot answer "
         "(time of day, weekdays, counts, averages, combinations). code: Python defining answer(txns) that returns "
         "{'title': str, 'value': number or None, 'unit': 'yuan'|'count'|'percent', 'rows': [[label, number], ...]}. "
         "Each txn is a dict: date 'YYYY-MM-DD', weekday 0-6 (Mon=0), hour, minute, days_ago, month_offset, week_offset, "
         "year_offset (0 = this month / week from Monday / year, -1 = the one before), amount (yuan, negative = money "
         "out), merchant, category, channel, kind. Only math, statistics, datetime, collections, itertools may be "
         "imported; no I/O, no printing, no names or attributes starting with an underscore. days: how far back the "
         "rows go, 365 by default (the last 12 months; say '近12个月' / 'last 12 months' in the title when no period "
         "is asked), up to 730 for 去年 / last year. Filter shorter periods with the offset fields, never by computing "
         "dates (上个月: month_offset == -1). Compute value and rows from the same filtered list. You never see merchant "
         "names, so match several keywords in lower case, brands included (coffee: 咖啡, 星巴克, 瑞幸, starbucks, luckin; "
         "taxi: 滴滴, 出租, 打车, didi; food delivery: 外卖, 饿了么).",
    resolve=analyze_resolve, run=analyze_run,
    describe=lambda ctx, r: ctx.t(f"在沙箱中分析：{r['question']}", f"Analyse in the sandbox: {r['question']}"),
    reply=analyze_reply,
    card=lambda ctx, r, res: {"type": "analysis", **res, "code": r["code"]},
    examples=["周末晚上8点后喝咖啡花了多少钱", "how many times did I take a taxi after 10pm this year"],
))
