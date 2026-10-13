"""Green actions: read-only questions about the customer's own data."""

from datetime import date, timedelta
from typing import Literal

from pydantic import Field
from sqlmodel import select

from app import clock
from app.agent.core import Action, Args, Ask, Ctx, Refuse, register
from app.agent.resolve import find_payee, payee_label
from app.bank import analysis
from app.bank.categories import LABELS, label
from app.models import BankAccount, Card, Collection, Notification, Payee, ScheduledTransfer, Txn
from app.money import to_fen, yuan


def _accounts(ctx: Ctx) -> list[BankAccount]:
    return list(ctx.session.exec(select(BankAccount).where(
        BankAccount.user_id == ctx.user.id, BankAccount.status == "open").order_by(BankAccount.created_at)))


def _account_view(a: BankAccount, ctx: Ctx) -> dict:
    return {"id": a.id, "kind": a.kind, "name": a.name if ctx.lang == "zh" else a.name_en,
            "number": a.number, "fen": a.balance_fen, "purpose": a.purpose, "release_on": a.release_on}


# --- balance ---


class BalanceArgs(Args):
    account: Literal["checking", "savings", "reserve", "all"] = "all"


def balance_resolve(ctx: Ctx, args: BalanceArgs) -> dict:
    return {"account": args.account}


def balance_run(ctx: Ctx, r: dict) -> dict:
    accounts = [a for a in _accounts(ctx) if r["account"] in ("all", a.kind)]
    return {"accounts": [_account_view(a, ctx) for a in accounts],
            "total_fen": sum(a.balance_fen for a in accounts)}


def balance_reply(ctx: Ctx, r: dict, result: dict) -> str:
    if not result["accounts"]:
        return ctx.t("没有找到对应的账户。", "No matching account was found.")
    lines = [f"{a['name']}（{a['number'][-4:]}）：{yuan(a['fen'])}" if ctx.lang == "zh"
             else f"{a['name']} (…{a['number'][-4:]}): {yuan(a['fen'])}" for a in result["accounts"]]
    if len(result["accounts"]) > 1:
        lines.append(ctx.t(f"合计 {yuan(result['total_fen'])}", f"Total {yuan(result['total_fen'])}"))
    return "\n".join(lines)


register(Action(
    name="balance", args=BalanceArgs, help="Account balances. account: checking | savings | reserve | all.",
    resolve=balance_resolve, run=balance_run,
    describe=lambda ctx, r: ctx.t("查询余额", "Check balances"), reply=balance_reply,
    card=lambda ctx, r, result: {"type": "balances", **result},
    examples=["我卡里还有多少钱", "what's my balance"],
))


# --- transactions ---


class TransactionsArgs(Args):
    days: int | None = Field(default=None, ge=1, le=800)
    start: date | None = None
    end: date | None = None
    category: str | None = Field(default=None, max_length=30)
    merchant: str | None = Field(default=None, max_length=40)
    payee: str | None = Field(default=None, max_length=40)
    direction: Literal["in", "out", "any"] = "any"
    min_yuan: float | None = Field(default=None, ge=0)
    max_yuan: float | None = Field(default=None, ge=0)
    limit: int = Field(default=10, ge=1, le=50)


def transactions_resolve(ctx: Ctx, args: TransactionsArgs) -> dict:
    end = args.end or ctx.today
    start = args.start or (end - timedelta(days=(args.days or 30) - 1))
    if start > end:
        raise Refuse("BAD_RANGE", "开始日期晚于结束日期。", "The start date is after the end date.")
    payee_id = None
    if args.payee:
        found = find_payee(ctx.session, ctx.user.id, args.payee)
        if found.ambiguous:
            raise Ask("payee", f"“{args.payee}”对应多位收款人，您指的是哪一位？",
                      f"“{args.payee}” matches more than one payee. Which one?",
                      [{"value": p.id, "label_zh": payee_label(p, "zh"), "label_en": payee_label(p, "en")}
                       for p in found.options])
        if found.value is None:
            raise Refuse("PAYEE_NOT_FOUND", f"没有找到收款人“{args.payee}”。", f"No payee called “{args.payee}”.")
        payee_id = found.value.id
    category = args.category if args.category in LABELS else None
    if args.category and category is None:
        category = next((c for c, (zh, en) in LABELS.items()
                         if args.category in (zh, en.lower(), en) or args.category.lower() in en.lower()), None)
    return {"start": start.isoformat(), "end": end.isoformat(), "category": category,
            "merchant": args.merchant, "payee_id": payee_id, "direction": args.direction,
            "min_fen": to_fen(args.min_yuan) if args.min_yuan is not None else None,
            "max_fen": to_fen(args.max_yuan) if args.max_yuan is not None else None, "limit": args.limit}


def transactions_run(ctx: Ctx, r: dict) -> dict:
    rows = analysis.txns_between(ctx.session, ctx.user.id, date.fromisoformat(r["start"]),
                                 date.fromisoformat(r["end"]) + timedelta(days=1))
    rows = [t for t in rows if t.kind != "internal" or r["category"] == "internal"]
    if r["category"]:
        rows = [t for t in rows if t.category == r["category"]]
    if r["merchant"]:
        rows = [t for t in rows if r["merchant"].casefold() in t.counterparty.casefold()]
    if r["payee_id"]:
        rows = [t for t in rows if t.payee_id == r["payee_id"]]
    if r["direction"] == "in":
        rows = [t for t in rows if t.amount_fen > 0]
    elif r["direction"] == "out":
        rows = [t for t in rows if t.amount_fen < 0]
    if r["min_fen"] is not None:
        rows = [t for t in rows if abs(t.amount_fen) >= r["min_fen"]]
    if r["max_fen"] is not None:
        rows = [t for t in rows if abs(t.amount_fen) <= r["max_fen"]]
    total_out = -sum(t.amount_fen for t in rows if t.amount_fen < 0 and t.status == "posted")
    total_in = sum(t.amount_fen for t in rows if t.amount_fen > 0 and t.status == "posted")
    shown = sorted(rows, key=lambda t: t.at, reverse=True)[: r["limit"]]
    return {"count": len(rows), "out_fen": total_out, "in_fen": total_in,
            "items": [txn_view(t) for t in shown]}


def txn_view(t: Txn) -> dict:
    return {"id": t.id, "at": t.at, "merchant": t.counterparty, "fen": t.amount_fen, "category": t.category,
            "channel": t.channel, "status": t.status, "kind": t.kind}


def transactions_reply(ctx: Ctx, r: dict, result: dict) -> str:
    span = f"{r['start']} ~ {r['end']}"
    if not result["count"]:
        return ctx.t(f"{span} 没有符合条件的交易。", f"No matching transactions between {span}.")
    head = ctx.t(f"{span} 共 {result['count']} 笔，支出 {yuan(result['out_fen'])}，收入 {yuan(result['in_fen'])}。",
                 f"{result['count']} transactions between {span}: {yuan(result['out_fen'])} out, {yuan(result['in_fen'])} in.")
    lines = [f"· {item['at'][5:16].replace('T', ' ')} {item['merchant']} {yuan(item['fen'])}"
             + (ctx.t("（已拒绝）", " (declined)") if item["status"] == "declined" else "")
             for item in result["items"]]
    more = ctx.t(f"\n（显示最近 {len(result['items'])} 笔）", f"\n(latest {len(result['items'])} shown)") \
        if result["count"] > len(result["items"]) else ""
    return head + "\n" + "\n".join(lines) + more


register(Action(
    name="transactions", args=TransactionsArgs,
    help="Transaction history. days or start/end (YYYY-MM-DD), category, merchant, payee, direction in|out, min_yuan, max_yuan, limit.",
    resolve=transactions_resolve, run=transactions_run,
    describe=lambda ctx, r: ctx.t("查询交易记录", "List transactions"), reply=transactions_reply,
    card=lambda ctx, r, result: {"type": "transactions", **result},
    examples=["最近一周的消费", "show my transactions with Zhang Wei"],
))


# --- spending and reports ---


class SpendingArgs(Args):
    period: Literal["month", "year", "custom"] = "month"
    offset: int = Field(default=0, ge=-24, le=0)
    start: date | None = None
    end: date | None = None
    category: str | None = Field(default=None, max_length=30)


def spending_resolve(ctx: Ctx, args: SpendingArgs) -> dict:
    if args.period == "custom":
        if not args.start:
            raise Ask("start", "请问要统计哪段时间？", "Which period should I add up?")
        start, end = args.start, (args.end or ctx.today) + timedelta(days=1)
    else:
        start, end = analysis.period_bounds(args.period, ctx.today, args.offset)
    category = args.category if args.category in LABELS else next(
        (c for c, (zh, en) in LABELS.items() if args.category and args.category.lower() in (zh, en.lower())), None)
    return {"start": start.isoformat(), "end": end.isoformat(), "category": category, "period": args.period,
            "offset": args.offset}


def spending_run(ctx: Ctx, r: dict) -> dict:
    return analysis.spending(ctx.session, ctx.user.id, date.fromisoformat(r["start"]),
                             date.fromisoformat(r["end"]), r["category"])


def spending_reply(ctx: Ctx, r: dict, res: dict) -> str:
    span = f"{res['start']} ~ {res['end']}"
    if r["category"]:
        return ctx.t(f"{span}，{label(r['category'], 'zh')}共支出 {yuan(res['spend_fen'])}（{res['count']} 笔）。",
                     f"{span}: {yuan(res['spend_fen'])} on {label(r['category'], 'en')} ({res['count']} payments).")
    top = res["categories"][:4]
    parts = "，".join(f"{label(c['category'], 'zh')} {yuan(c['fen'])}" for c in top) if ctx.lang == "zh" else \
        ", ".join(f"{label(c['category'], 'en')} {yuan(c['fen'])}" for c in top)
    return ctx.t(f"{span} 共支出 {yuan(res['spend_fen'])}，收入 {yuan(res['income_fen'])}。最多的是：{parts}。",
                 f"{span}: spent {yuan(res['spend_fen'])}, received {yuan(res['income_fen'])}. Biggest: {parts}.")


register(Action(
    name="spending", args=SpendingArgs,
    help="Spending by category. period month|year|custom, offset 0=current -1=previous, start/end for custom, optional category (dining, shopping, transport, groceries, digital, utilities, housing, travel, entertainment, health, family, gifts).",
    resolve=spending_resolve, run=spending_run,
    describe=lambda ctx, r: ctx.t("分析消费", "Analyse spending"), reply=spending_reply,
    card=lambda ctx, r, res: {"type": "spending", **res},
    examples=["这个月花了多少钱", "how much did I spend on dining last month"],
))


class ReportArgs(Args):
    period: Literal["month", "year"] = "month"
    offset: int = Field(default=-1, ge=-24, le=0)


def report_resolve(ctx: Ctx, args: ReportArgs) -> dict:
    return {"period": args.period, "offset": args.offset}


def report_run(ctx: Ctx, r: dict) -> dict:
    return analysis.report(ctx.session, ctx.user.id, ctx.today, r["period"], r["offset"])


def report_reply(ctx: Ctx, r: dict, res: dict) -> str:
    name = (res["start"][:7] if r["period"] == "month" else res["start"][:4])
    kind = ctx.t("月度" if r["period"] == "month" else "年度", "monthly" if r["period"] == "month" else "annual")
    change = res["spend_fen"] - res["previous_spend_fen"]
    trend = ""
    if res["previous_spend_fen"]:
        pct = change / res["previous_spend_fen"] * 100
        trend = ctx.t(f"，比上期{'多' if change > 0 else '少'} {abs(pct):.0f}%", f", {abs(pct):.0f}% {'more' if change > 0 else 'less'} than the period before")
    top = res["categories"][:3]
    tops = "、".join(f"{label(c['category'], 'zh')} {c['share'] * 100:.0f}%" for c in top) if ctx.lang == "zh" \
        else ", ".join(f"{label(c['category'], 'en')} {c['share'] * 100:.0f}%" for c in top)
    biggest = res["largest"][0] if res["largest"] else None
    lines = [ctx.t(f"{name} {kind}报告{'（截至今天）' if not res['complete'] else ''}：支出 {yuan(res['spend_fen'])}{trend}；收入 {yuan(res['income_fen'])}，结余 {yuan(res['net_fen'])}。",
                   f"{name} {kind} report{' (to date)' if not res['complete'] else ''}: spent {yuan(res['spend_fen'])}{trend}; income {yuan(res['income_fen'])}, net {yuan(res['net_fen'])}.")]
    if tops:
        lines.append(ctx.t(f"占比最高：{tops}。", f"Largest shares: {tops}."))
    if biggest:
        lines.append(ctx.t(f"单笔最大：{biggest['merchant']} {yuan(biggest['fen'])}（{biggest['at'][:10]}）。",
                           f"Largest single payment: {biggest['merchant']} {yuan(biggest['fen'])} ({biggest['at'][:10]})."))
    return "\n".join(lines)


register(Action(
    name="report", args=ReportArgs,
    help="Monthly or annual report with category shares, comparison and chart. period month|year, offset -1 = last full period, 0 = current to date.",
    resolve=report_resolve, run=report_run,
    describe=lambda ctx, r: ctx.t("生成账单报告", "Build a report"), reply=report_reply,
    card=lambda ctx, r, res: {"type": "report", **res},
    examples=["上个月的账单报告", "give me my annual report for last year"],
))


class AnomaliesArgs(Args):
    days: int = Field(default=30, ge=7, le=120)


def anomalies_run(ctx: Ctx, r: dict) -> dict:
    return {"items": analysis.anomalies(ctx.session, ctx.user.id, ctx.today, r["days"]), "days": r["days"]}


def anomalies_reply(ctx: Ctx, r: dict, res: dict) -> str:
    items = res["items"]
    if not items:
        return ctx.t(f"最近 {r['days']} 天没有发现异常交易。", f"No unusual transactions in the last {r['days']} days.")
    lines = [ctx.t(f"最近 {r['days']} 天发现 {len(items)} 项需要留意：", f"{len(items)} things to look at from the last {r['days']} days:")]
    for f in items:
        what = f["merchant"] or label(f.get("category", "other"), ctx.lang)
        lines.append(f"· {f['at'][:10]} {what} {yuan(f['fen'])}: {f['reason_zh'] if ctx.lang == 'zh' else f['reason_en']}")
    lines.append(ctx.t("如有不认识的交易，可以让我冻结相关卡片。", "If you don't recognise one, I can freeze the card it used."))
    return "\n".join(lines)


register(Action(
    name="anomalies", args=AnomaliesArgs,
    help="Unusual transactions (duplicates, large first-time merchants, late-night, declined overseas, category spikes). days 7-120.",
    resolve=lambda ctx, a: {"days": a.days}, run=anomalies_run,
    describe=lambda ctx, r: ctx.t("检查异常交易", "Check for unusual transactions"), reply=anomalies_reply,
    card=lambda ctx, r, res: {"type": "anomalies", **res},
    examples=["有没有异常交易", "anything suspicious on my account?"],
))


# --- payees, cards, scheduled, collections, notifications ---


class PayeesArgs(Args):
    query: str | None = Field(default=None, max_length=40)


def payees_run(ctx: Ctx, r: dict) -> dict:
    rows = list(ctx.session.exec(select(Payee).where(Payee.user_id == ctx.user.id).order_by(Payee.created_at)))
    if r["query"]:
        found = find_payee(ctx.session, ctx.user.id, r["query"])
        rows = [found.value] if found.value else found.options
    return {"items": [{"id": p.id, "name": p.name, "name_en": p.name_en, "note": p.note, "bank": p.bank,
                       "account_tail": p.account_no[-4:], "phone": p.phone[:3] + "****" + p.phone[-4:],
                       "relationship": p.relationship, "created_at": p.created_at} for p in rows]}


def payees_reply(ctx: Ctx, r: dict, res: dict) -> str:
    if not res["items"]:
        return ctx.t("没有找到收款人。", "No payees found.")
    return "\n".join(f"· {p['name'] if ctx.lang == 'zh' else (p['name_en'] or p['name'])}"
                     f"{'（' + p['note'] + '）' if p['note'] else ''} {p['bank']} ****{p['account_tail']}"
                     for p in res["items"])


register(Action(
    name="payees", args=PayeesArgs, help="List saved payees, optionally matching query.",
    resolve=lambda ctx, a: {"query": a.query}, run=payees_run,
    describe=lambda ctx, r: ctx.t("查看收款人", "List payees"), reply=payees_reply,
    card=lambda ctx, r, res: {"type": "payees", **res},
))


def cards_run(ctx: Ctx, r: dict) -> dict:
    rows = ctx.session.exec(select(Card).where(Card.user_id == ctx.user.id).order_by(Card.created_at))
    return {"items": [card_view(c, ctx) for c in rows]}


def card_view(c: Card, ctx: Ctx) -> dict:
    return {"id": c.id, "kind": c.kind, "name": c.name if ctx.lang == "zh" else c.name_en, "last4": c.last4,
            "status": c.status, "daily_limit_fen": c.daily_limit_fen, "online": c.online_enabled,
            "overseas": c.overseas_enabled, "atm": c.atm_enabled, "contactless": c.contactless_enabled,
            "expires": c.expires}


STATUS = {"active": ("正常", "active"), "frozen": ("已冻结", "frozen"), "lost": ("已挂失", "reported lost"),
          "pending": ("审核中", "pending")}


def cards_reply(ctx: Ctx, r: dict, res: dict) -> str:
    lines = []
    for c in res["items"]:
        state = STATUS[c["status"]][0 if ctx.lang == "zh" else 1]
        switches = ", ".join(n for n, on in ((ctx.t("网上支付", "online"), c["online"]), (ctx.t("境外", "overseas"), c["overseas"]),
                                             ("ATM", c["atm"]), (ctx.t("闪付", "contactless"), c["contactless"])) if on)
        lines.append(ctx.t(f"· {c['name']} ****{c['last4']}：{state}，日限额 {yuan(c['daily_limit_fen'])}，已开通 {switches or '无'}",
                           f"· {c['name']} ****{c['last4']}: {state}, daily limit {yuan(c['daily_limit_fen'])}, enabled: {switches or 'none'}"))
    return "\n".join(lines) or ctx.t("没有银行卡。", "No cards.")


register(Action(
    name="cards", args=Args, help="List cards with status, limits and switches.",
    resolve=lambda ctx, a: {}, run=cards_run,
    describe=lambda ctx, r: ctx.t("查看银行卡", "List cards"), reply=cards_reply,
    card=lambda ctx, r, res: {"type": "cards", **res},
))


def scheduled_run(ctx: Ctx, r: dict) -> dict:
    rows = ctx.session.exec(select(ScheduledTransfer).where(
        ScheduledTransfer.user_id == ctx.user.id, ScheduledTransfer.status.in_(["scheduled", "waiting_approval"])
    ).order_by(ScheduledTransfer.run_at))
    items = []
    for s in rows:
        payee = ctx.session.get(Payee, s.payee_id)
        items.append({"id": s.id, "payee": payee.name if payee else "?", "fen": s.amount_fen, "run_at": s.run_at,
                      "repeat": s.repeat, "status": s.status})
    return {"items": items}


def scheduled_reply(ctx: Ctx, r: dict, res: dict) -> str:
    if not res["items"]:
        return ctx.t("目前没有预约转账。", "You have no scheduled transfers.")
    return "\n".join(ctx.t(f"· {s['run_at'][:16].replace('T', ' ')} 向 {s['payee']} 转 {yuan(s['fen'])}{'（每月）' if s['repeat'] == 'monthly' else ''}",
                           f"· {s['run_at'][:16].replace('T', ' ')} {yuan(s['fen'])} to {s['payee']}{' (monthly)' if s['repeat'] == 'monthly' else ''}")
                     for s in res["items"])


register(Action(
    name="scheduled", args=Args, help="List scheduled transfers.",
    resolve=lambda ctx, a: {}, run=scheduled_run,
    describe=lambda ctx, r: ctx.t("查看预约转账", "List scheduled transfers"), reply=scheduled_reply,
    card=lambda ctx, r, res: {"type": "scheduled", **res},
))


def collections_run(ctx: Ctx, r: dict) -> dict:
    rows = ctx.session.exec(select(Collection).where(Collection.user_id == ctx.user.id).order_by(Collection.created_at.desc()))
    return {"items": [{"id": c.id, "title": c.title, "total_fen": c.total_fen, "status": c.status,
                       "participants": c.participants, "created_at": c.created_at} for c in rows]}


def collections_reply(ctx: Ctx, r: dict, res: dict) -> str:
    if not res["items"]:
        return ctx.t("还没有发起过 AA 收款。", "You have no split-bill requests yet.")
    lines = []
    for c in res["items"][:5]:
        paid = sum(1 for p in c["participants"] if p["status"] == "paid")
        lines.append(ctx.t(f"· {c['title']} 共 {yuan(c['total_fen'])}，{paid}/{len(c['participants'])} 人已付",
                           f"· {c['title']}: {yuan(c['total_fen'])}, {paid}/{len(c['participants'])} paid"))
    return "\n".join(lines)


register(Action(
    name="collections", args=Args, help="List split-bill (AA) collection requests.",
    resolve=lambda ctx, a: {}, run=collections_run,
    describe=lambda ctx, r: ctx.t("查看 AA 收款", "List split bills"), reply=collections_reply,
    card=lambda ctx, r, res: {"type": "collections", **res},
))


def notifications_run(ctx: Ctx, r: dict) -> dict:
    rows = ctx.session.exec(select(Notification).where(Notification.user_id == ctx.user.id).order_by(Notification.at.desc()).limit(10))
    return {"items": [{"id": n.id, "at": n.at, "kind": n.kind, "title": n.title if ctx.lang == "zh" else n.title_en,
                       "body": n.body if ctx.lang == "zh" else n.body_en} for n in rows]}


register(Action(
    name="notifications", args=Args, help="Recent reminders and alerts.",
    resolve=lambda ctx, a: {}, run=notifications_run,
    describe=lambda ctx, r: ctx.t("查看提醒", "Show reminders"),
    reply=lambda ctx, r, res: "\n".join(f"· {n['title']}: {n['body']}" for n in res["items"]) or ctx.t("暂无提醒。", "No reminders."),
    card=lambda ctx, r, res: {"type": "notifications", **res},
))


class ContactArgs(Args):
    who: str = Field(min_length=1, max_length=40)


def contact_resolve(ctx: Ctx, args: ContactArgs) -> dict:
    found = find_payee(ctx.session, ctx.user.id, args.who)
    if found.ambiguous:
        raise Ask("who", f"“{args.who}”对应多位联系人，是哪一位？", f"“{args.who}” matches several contacts. Which one?",
                  [{"value": p.id, "label_zh": payee_label(p, "zh"), "label_en": payee_label(p, "en")} for p in found.options])
    if found.value is None:
        raise Refuse("CONTACT_NOT_FOUND", f"通讯录里没有“{args.who}”。", f"“{args.who}” is not in your contacts.")
    return {"payee_id": found.value.id, "name": found.value.name, "name_en": found.value.name_en or found.value.name}


def contact_run(ctx: Ctx, r: dict) -> dict:
    p = ctx.session.get(Payee, r["payee_id"])
    birthday = clock.next_birthday(p.birthday, ctx.today).isoformat() if p.birthday else None
    return {"payee_id": p.id, "name": p.name, "name_en": p.name_en, "relationship": p.relationship,
            "birthday": birthday, "phone": p.phone[:3] + "****" + p.phone[-4:]}


def contact_reply(ctx: Ctx, r: dict, res: dict) -> str:
    if res["birthday"]:
        return ctx.t(f"{res['name']}的下一个生日是 {res['birthday']}。", f"{res['name_en'] or res['name']}'s next birthday is {res['birthday']}.")
    return ctx.t(f"没有记录{res['name']}的生日。", f"No birthday is saved for {res['name_en'] or res['name']}.")


register(Action(
    name="contact_lookup", args=ContactArgs,
    help="Look up a contact (name, alias or relationship such as wife/妈妈); returns payee_id, name and next birthday (YYYY-MM-DD).",
    resolve=contact_resolve, run=contact_run,
    describe=lambda ctx, r: ctx.t(f"查找联系人 {r['name']}", f"Look up {r.get('name_en') or r['name']}"), reply=contact_reply,
))


class HandoffArgs(Args):
    reason: str | None = Field(default=None, max_length=200)


register(Action(
    name="handoff", args=HandoffArgs, help="Hand the conversation to a human bank operator.",
    resolve=lambda ctx, a: {"reason": a.reason},
    run=lambda ctx, r: {"escalated": True},
    describe=lambda ctx, r: ctx.t("转人工客服", "Hand over to a person"),
    reply=lambda ctx, r, res: ctx.t("已为您转接人工客服，工作人员会在这里回复您。期间助手不会再执行任何操作。",
                                    "I've handed this conversation to a bank operator, who will reply here. The assistant won't act in the meantime."),
))
