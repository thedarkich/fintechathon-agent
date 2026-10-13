"""Money that leaves or is set aside: transfers, scheduled transfers, split bills, orders, reserves."""

import re
from datetime import date, datetime, time, timedelta
from typing import Literal

from pydantic import Field
from sqlmodel import select

from app import clock
from app.agent.core import Action, Args, Ask, Ctx, Refuse, register
from app.agent.resolve import find_payee, find_reserve, payee_label
from app.bank import ledger, transfers
from app.bank.analysis import txns_between
from app.clock import CST
from app.models import (
    BankAccount,
    Collection,
    Order,
    Payee,
    ScheduledTransfer,
    Transfer,
    Txn,
    Upload,
)
from app.money import to_fen, yuan

SINGLE_TRANSFER_CAP = 5_000_000  # ¥50,000 per transfer in the demo bank


def resolve_payee(ctx: Ctx, text: str, field_name: str = "payee") -> Payee:
    found = find_payee(ctx.session, ctx.user.id, text)
    if found.ambiguous:
        raise Ask(field_name, f"“{text}”对应多位收款人，请选择：", f"“{text}” matches more than one payee. Please choose:",
                  [{"value": p.id, "label_zh": payee_label(p, "zh"), "label_en": payee_label(p, "en")}
                   for p in found.options])
    if found.value is None:
        raise Refuse("PAYEE_NOT_FOUND", f"收款人列表里没有“{text}”。可以先添加收款人（需要姓名和手机号或卡号）。",
                     f"There is no payee called “{text}”. You can add one first (name plus phone or account number).")
    return found.value


def payee_fields(ctx: Ctx, p: Payee) -> dict:
    created = clock.parse(p.created_at)
    return {"payee_id": p.id, "payee": p.name, "payee_en": p.name_en or p.name, "payee_note": p.note,
            "payee_note_en": transfers.note_en(p.note),
            "bank": p.bank, "account_tail": p.account_no[-4:],
            "payee_new": (ctx.now - created) < timedelta(hours=24)}


def amount_fen(value: float | None, ctx: Ctx, *, field_name="amount_yuan") -> int:
    if value is None:
        raise Ask(field_name, "请问金额是多少？", "How much?")
    fen = to_fen(value)
    if fen <= 0:
        raise Refuse("BAD_AMOUNT", "金额必须大于零。", "The amount must be more than zero.")
    return fen


def parse_when(ctx: Ctx, value: str) -> datetime:
    value = value.strip()
    if len(value) > 10:
        value = value.replace(" ", "T", 1)
    try:
        if "T" in value:
            return clock.parse(value).astimezone(CST)
        return datetime.combine(date.fromisoformat(value), time(9, 0), CST)
    except ValueError:
        raise Refuse("BAD_DATE", f"无法识别日期“{value}”。", f"“{value}” is not a date I can use.") from None


def describe_payee(ctx: Ctx, r: dict) -> str:
    note = f"（{r['payee_note']}）" if r.get("payee_note") else ""
    return ctx.t(f"{r['payee']}{note} {r['bank']} ****{r['account_tail']}",
                 f"{r['payee_en']}{' (' + r['payee_note_en'] + ')' if r.get('payee_note_en') else ''}, {transfers.bank_en(r['bank'])} ****{r['account_tail']}")


# --- transfer ---


class TransferArgs(Args):
    payee: str = Field(min_length=1, max_length=40)
    amount_yuan: float | None = Field(default=None, gt=0)
    memo: str | None = Field(default=None, max_length=40)
    from_account: Literal["checking", "savings"] = "checking"
    arrival: Literal["instant", "standard", "next_day"] = "instant"


def source_account(ctx: Ctx, kind: str) -> BankAccount:
    row = ctx.session.exec(select(BankAccount).where(BankAccount.user_id == ctx.user.id, BankAccount.kind == kind,
                                                     BankAccount.status == "open")).first()
    if row is None:
        raise Refuse("NO_ACCOUNT", "没有找到付款账户。", "No account to pay from.")
    return row


def transfer_resolve(ctx: Ctx, args: TransferArgs) -> dict:
    payee = resolve_payee(ctx, args.payee)
    fen = amount_fen(args.amount_yuan, ctx)
    if fen > SINGLE_TRANSFER_CAP:
        raise Refuse("OVER_SINGLE_CAP", f"单笔转账上限为 {yuan(SINGLE_TRANSFER_CAP)}。",
                     f"A single transfer can be at most {yuan(SINGLE_TRANSFER_CAP)}.")
    source = source_account(ctx, args.from_account)
    if source.balance_fen < fen:
        raise Refuse("INSUFFICIENT_FUNDS", f"{source.name}余额 {yuan(source.balance_fen)}，不足以转账 {yuan(fen)}。",
                     f"{source.name_en} has {yuan(source.balance_fen)}, not enough for {yuan(fen)}.")
    return {**payee_fields(ctx, payee), "fen": fen, "memo": args.memo, "source_id": source.id,
            "source": source.name, "source_en": source.name_en, "route": transfers.route_for(payee.bank),
            "arrival": args.arrival}


def transfer_run(ctx: Ctx, r: dict) -> dict:
    payee = ctx.session.get(Payee, r["payee_id"])
    source = ledger.account(ctx.session, ctx.user.id, r["source_id"])
    row = transfers.send(ctx.session, ctx.user, payee, source, r["fen"], now=ctx.now, memo=r["memo"],
                         arrival=r.get("arrival", "instant"), arrival_reason=r.get("arrival_reason"),
                         plan_id=ctx.plan.id if ctx.plan else None)
    return {"transfer_id": row.id, "status": row.status, "reason": row.reason, "fen": r["fen"], "payee": payee.name,
            "balance_fen": source.balance_fen, "at": row.created_at, "arrive_at": row.arrive_at, "route": row.route}


def arrival_text(ctx: Ctx, r: dict) -> str:
    """How and when the money arrives, as the slip shows it."""
    route = transfers.ROUTES[r.get("route") or transfers.route_for(r["bank"])]
    arrival = transfers.ARRIVALS[r.get("arrival", "instant")]
    why = ctx.t("，新收款人等风险提示由规则设为延时到账，到账前可撤销", "; the rules delay it because of a risk signal, and you can cancel before it arrives") \
        if r.get("arrival_reason") else (ctx.t("，到账前可撤销", "; you can cancel before it arrives") if r.get("arrival", "instant") != "instant" else "")
    return ctx.t(f"（{route[0]}，{arrival[0]}{why}）", f" ({route[1]}, {arrival[1]}{why})")


def transfer_describe(ctx: Ctx, r: dict) -> str:
    memo = ctx.t(f"，备注“{r['memo']}”", f", note “{r['memo']}”") if r.get("memo") else ""
    new = ctx.t("（今天新添加的收款人）", " (payee added today)") if r.get("payee_new") else ""
    return ctx.t(f"从{r['source']}向 {describe_payee(ctx, r)}{new} 转账 {yuan(r['fen'])}{memo}{arrival_text(ctx, r)}",
                 f"Transfer {yuan(r['fen'])} from {r['source_en']} to {describe_payee(ctx, r)}{new}{memo}{arrival_text(ctx, r)}")


def transfer_reply(ctx: Ctx, r: dict, res: dict) -> str:
    balance = ctx.t(f"{r['source']}余额 {yuan(res['balance_fen'])}。", f"{r['source_en']} balance: {yuan(res['balance_fen'])}.")
    status = res.get("status", "arrived")
    if status == "returned":
        zh, en = transfers.RETURN_REASONS[res["reason"]]
        return ctx.t(f"向 {res['payee']} 的 {yuan(res['fen'])} 被对方银行退回：{zh}。钱已回到您的账户，请核对收款人信息。{balance}",
                     f"The {yuan(res['fen'])} to {r['payee_en']} was returned by their bank because {en}. "
                     f"The money is back in your account; please check the payee's details. {balance}")
    if status == "accepted":
        when = res["arrive_at"][5:16].replace("T", " ")
        return ctx.t(f"已受理：向 {res['payee']} 转账 {yuan(res['fen'])}，预计 {when} 到账。到账前可以说“撤销转账”。{balance}",
                     f"Accepted: {yuan(res['fen'])} to {r['payee_en']}, arriving around {when}. Say “cancel the transfer” "
                     f"before then to stop it. {balance}")
    return ctx.t(f"已向 {res['payee']} 转账 {yuan(res['fen'])}，已到账。{balance}",
                 f"Sent {yuan(res['fen'])} to {r['payee_en']}; it has arrived. {balance}")


register(Action(
    name="transfer", args=TransferArgs,
    help="Send money now. payee = name, alias, relationship (妈妈/landlord), phone number or note; amount_yuan; optional memo; "
         "from_account checking|savings; arrival instant|standard (2 hours later, can be cancelled until then)|next_day.",
    resolve=transfer_resolve, run=transfer_run, describe=transfer_describe, reply=transfer_reply,
    rule="PAYMENT", payment=lambda r: r["fen"], schedulable=True,
    card=lambda ctx, r, res: {"type": "receipt", "action": "transfer", **res},
    examples=["给妈妈转200", "send 3000 to my landlord", "转500给13912345678"],
))


# --- cancel a delayed transfer before it arrives ---


class CancelTransferArgs(Args):
    transfer: str | None = Field(default=None, max_length=40)  # a transfer id (or its start) or the payee


def transfer_label(t: Transfer, lang: str) -> str:
    when = t.arrive_at[5:16].replace("T", " ")
    return f"{t.payee_name} {yuan(t.amount_fen)}，预计 {when} 到账" if lang == "zh" \
        else f"{t.payee_name_en} {yuan(t.amount_fen)}, arriving {when}"


def cancel_resolve(ctx: Ctx, args: CancelTransferArgs) -> dict:
    rows = [t for t in ctx.session.exec(select(Transfer).where(Transfer.user_id == ctx.user.id, Transfer.status == "accepted")
                                        .order_by(Transfer.created_at.desc())) if transfers.cancellable(t, ctx.now)]
    if args.transfer:
        key = args.transfer.strip().lstrip("#")
        by_id = [t for t in rows if len(key) >= 6 and t.id.startswith(key)]
        if by_id:
            rows = by_id
        else:
            found = find_payee(ctx.session, ctx.user.id, args.transfer)
            matches = {found.value.id} if found.value else {p.id for p in found.options}
            rows = [t for t in rows if t.payee_id in matches]
    if not rows:
        raise Refuse("NOTHING_TO_CANCEL", "没有可以撤销的转账：只有延时到账、而且还没到账的转账才能撤销。",
                     "There is no transfer to cancel: only a delayed transfer that hasn't arrived yet can be cancelled.")
    if len(rows) > 1:
        raise Ask("transfer", "要撤销哪一笔？", "Which transfer should I cancel?",
                  [{"value": t.id, "label_zh": transfer_label(t, "zh"), "label_en": transfer_label(t, "en")} for t in rows[:6]])
    t = rows[0]
    return {"transfer_id": t.id, "payee": t.payee_name, "payee_en": t.payee_name_en, "fen": t.amount_fen,
            "arrive_at": t.arrive_at}


def cancel_run(ctx: Ctx, r: dict) -> dict:
    row = ctx.session.get(Transfer, r["transfer_id"])
    transfers.cancel(ctx.session, row, ctx.now)
    source = ctx.session.get(BankAccount, row.source_id)
    return {"fen": row.amount_fen, "balance_fen": source.balance_fen if source else None}


register(Action(
    name="transfer_cancel", args=CancelTransferArgs,
    help="Cancel a delayed transfer that has not arrived yet; the money comes back. transfer = its id or the payee.",
    resolve=cancel_resolve, run=cancel_run,
    describe=lambda ctx, r: ctx.t(f"撤销向 {r['payee']} 的 {yuan(r['fen'])} 转账（尚未到账，钱退回原账户）",
                                  f"Cancel the {yuan(r['fen'])} transfer to {r['payee_en']} (not arrived yet; the money comes back)"),
    reply=lambda ctx, r, res: ctx.t(f"已撤销，{yuan(res['fen'])} 已回到您的账户。", f"Cancelled. {yuan(res['fen'])} is back in your account."),
    rule="Y_TRANSFER_CANCEL",
    examples=["撤销刚才给周凯的转账", "cancel the transfer to Zhou Kai"],
))


# --- scheduled transfer ---


class ScheduleArgs(Args):
    payee: str = Field(min_length=1, max_length=40)
    amount_yuan: float | None = Field(default=None, gt=0)
    when: str | None = Field(default=None, max_length=25)
    repeat: Literal["none", "monthly"] = "none"
    memo: str | None = Field(default=None, max_length=40)


def schedule_resolve(ctx: Ctx, args: ScheduleArgs) -> dict:
    payee = resolve_payee(ctx, args.payee)
    fen = amount_fen(args.amount_yuan, ctx)
    if fen > SINGLE_TRANSFER_CAP:
        raise Refuse("OVER_SINGLE_CAP", f"单笔转账上限为 {yuan(SINGLE_TRANSFER_CAP)}。",
                     f"A single transfer can be at most {yuan(SINGLE_TRANSFER_CAP)}.")
    if not args.when:
        raise Ask("when", "请问什么时候转？", "When should it be sent?")
    moment = parse_when(ctx, args.when)
    if moment <= ctx.now + timedelta(minutes=1):
        raise Refuse("PAST_DATE", "预约时间需要晚于现在。", "The time must be in the future.")
    if moment > ctx.now + timedelta(days=366):
        raise Refuse("TOO_FAR", "最多只能预约一年以内。", "Transfers can be scheduled up to a year ahead.")
    return {**payee_fields(ctx, payee), "fen": fen, "memo": args.memo, "run_at": clock.iso(moment),
            "repeat": args.repeat, "pay_day": moment.date().isoformat()}


def schedule_run(ctx: Ctx, r: dict) -> dict:
    row = ScheduledTransfer(user_id=ctx.user.id, payee_id=r["payee_id"], amount_fen=r["fen"], memo=r["memo"],
                            run_at=r["run_at"], repeat=r["repeat"], plan_id=ctx.plan.id if ctx.plan else None,
                            created_at=clock.iso(ctx.now))
    ctx.session.add(row)
    ctx.session.flush()
    return {"scheduled_id": row.id, "run_at": row.run_at, "fen": r["fen"]}


def schedule_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    row = ctx.session.get(ScheduledTransfer, res["scheduled_id"])
    if row and row.status in ("scheduled", "waiting_approval"):
        row.status = "cancelled"
        ctx.session.add(row)
        return {"cancelled": True}
    return {"cancelled": False}


def schedule_describe(ctx: Ctx, r: dict) -> str:
    when = r["run_at"][:16].replace("T", " ")
    repeat = ctx.t("，之后每月同日重复", ", then every month on that day") if r["repeat"] == "monthly" else ""
    return ctx.t(f"预约在 {when} 向 {describe_payee(ctx, r)} 转账 {yuan(r['fen'])}{repeat}",
                 f"Schedule {yuan(r['fen'])} to {describe_payee(ctx, r)} for {when}{repeat}")


register(Action(
    name="schedule_transfer", args=ScheduleArgs,
    help="Transfer at a future time. payee, amount_yuan, when = YYYY-MM-DD or YYYY-MM-DDTHH:MM (bank time), repeat none|monthly, memo.",
    resolve=schedule_resolve, run=schedule_run, describe=schedule_describe,
    reply=lambda ctx, r, res: ctx.t(f"已预约：{res['run_at'][:16].replace('T', ' ')} 向 {r['payee']} 转 {yuan(res['fen'])}。到时会再按当天额度检查一次。",
                                    f"Scheduled: {yuan(res['fen'])} to {r['payee_en']} on {res['run_at'][:16].replace('T', ' ')}. It is checked against that day's limit again before it runs."),
    rule="PAYMENT", payment=lambda r: r["fen"], compensate=schedule_compensate,
    examples=["每月1号给房东转3200房租", "send mom 500 next Friday"],
))


# --- split bill (AA) ---


class CollectArgs(Args):
    payees: list[str] = Field(min_length=1, max_length=10)
    total_yuan: float | None = Field(default=None, gt=0)
    from_merchant: str | None = Field(default=None, max_length=40)
    include_me: bool = True
    title: str | None = Field(default=None, max_length=30)
    receipt: str | None = Field(default=None, max_length=36)


def load_receipt(ctx: Ctx, receipt_id: str, *, need_total: bool = True) -> Upload:
    row = ctx.session.get(Upload, receipt_id)
    if row is None or row.user_id != ctx.user.id:
        raise Refuse("RECEIPT_NOT_FOUND", "没有找到这张小票。", "That receipt was not found.")
    if need_total and (not row.reading.get("is_receipt") or not row.reading.get("total_fen")):
        raise Refuse("NOT_A_RECEIPT", "没能从这张图片里读出金额，请直接告诉我总额。",
                     "I couldn't read a total from that file. Tell me the total instead.")
    return row


def split_names(ctx: Ctx, text: str) -> list[str]:
    """'张伟王芳' written without a separator: split it only into names the customer has saved, in order."""
    if len(text) < 4 or not re.fullmatch(r"[一-龥]+", text):
        return [text]
    names = sorted({p.name for p in ctx.session.exec(select(Payee).where(Payee.user_id == ctx.user.id))}, key=len, reverse=True)
    parts, rest = [], text
    while rest:
        name = next((n for n in names if rest.startswith(n)), None)
        if name is None:
            return [text]
        parts.append(name)
        rest = rest[len(name):]
    return parts


def collect_resolve(ctx: Ctx, args: CollectArgs) -> dict:
    people = []
    named = [(index, part) for index, text in enumerate(args.payees) for part in split_names(ctx, text)]
    for index, text in named:
        payee = resolve_payee(ctx, text, f"payees.{index}")  # a question about a name answers its original entry
        if payee.id not in {p["payee_id"] for p in people}:
            people.append({"payee_id": payee.id, "name": payee.name, "name_en": payee.name_en or payee.name})
    source_txn = None
    receipt = load_receipt(ctx, args.receipt) if args.receipt else None
    if receipt is not None and args.total_yuan is None:
        total = receipt.reading["total_fen"]
    elif args.total_yuan is not None:
        total = to_fen(args.total_yuan)
    elif args.from_merchant:
        recent = [t for t in txns_between(ctx.session, ctx.user.id, ctx.today - timedelta(days=14),
                                          ctx.today + timedelta(days=1))
                  if t.amount_fen < 0 and t.status == "posted" and args.from_merchant.casefold() in t.counterparty.casefold()]
        if not recent:
            raise Refuse("TXN_NOT_FOUND", f"最近两周没有找到“{args.from_merchant}”的消费。",
                         f"No payment to “{args.from_merchant}” in the last two weeks.")
        source_txn = recent[-1]
        total = -source_txn.amount_fen
    else:
        raise Ask("total_yuan", "这次一共多少钱？", "What was the total?")
    heads = len(people) + (1 if args.include_me else 0)
    share = total // heads
    title = args.title or (receipt.reading.get("merchant") if receipt else None) or (
        source_txn.counterparty if source_txn else ctx.t("AA 收款", "Split bill"))
    return {"people": people, "total_fen": total, "share_fen": share, "heads": heads, "title": title[:30],
            "source_txn": source_txn.id if source_txn else None,
            "source_at": source_txn.at if source_txn else None,
            "receipt": receipt.id if receipt else None, "content_flags": receipt.flags if receipt else []}


def collect_run(ctx: Ctx, r: dict) -> dict:
    row = Collection(user_id=ctx.user.id, title=r["title"], total_fen=r["total_fen"], created_at=clock.iso(ctx.now),
                     participants=[{**p, "share_fen": r["share_fen"], "status": "pending"} for p in r["people"]],
                     plan_id=ctx.plan.id if ctx.plan else None)
    ctx.session.add(row)
    ctx.session.flush()
    return {"collection_id": row.id, "share_fen": r["share_fen"], "count": len(r["people"])}


def collect_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    row = ctx.session.get(Collection, res["collection_id"])
    if row and row.status == "open":
        row.status = "cancelled"
        ctx.session.add(row)
    return {"cancelled": True}


def collect_describe(ctx: Ctx, r: dict) -> str:
    names = "、".join(p["name"] for p in r["people"]) if ctx.lang == "zh" else ", ".join(p["name_en"] for p in r["people"])
    me = ctx.t("（含我）", " (including me)") if r["heads"] > len(r["people"]) else ""
    each_zh, each_en = ("各", " each") if len(r["people"]) > 1 else ("", "")
    return ctx.t(f"“{r['title']}”共 {yuan(r['total_fen'])}，{r['heads']} 人平摊{me}，向 {names} {each_zh}发起收款 {yuan(r['share_fen'])}",
                 f"Split “{r['title']}” ({yuan(r['total_fen'])}) {r['heads']} ways{me}: ask {names} for {yuan(r['share_fen'])}{each_en}")


register(Action(
    name="collect", args=CollectArgs,
    help="Split a bill (AA): request equal shares from payees. total_yuan, or receipt (an attached receipt id), or from_merchant to use a recent payment there; include_me; title.",
    resolve=collect_resolve, run=collect_run, describe=collect_describe,
    reply=lambda ctx, r, res: ctx.t(
        f"已向 {res['count']} 人发起收款，每人 {yuan(res['share_fen'])}。对方付款后会自动到账。" if res["count"] > 1
        else f"已向 {r['people'][0]['name']} 发起收款 {yuan(res['share_fen'])}。对方付款后会自动到账。",
        f"Sent {res['count']} payment requests for {yuan(res['share_fen'])} each. Payments arrive automatically." if res["count"] > 1
        else f"Asked {r['people'][0]['name_en']} for {yuan(res['share_fen'])}. The payment arrives automatically."),
    rule="Y_COLLECTION", compensate=collect_compensate,
    examples=["昨晚海底捞和张伟、王芳AA", "split 300 with Liu Yang"],
))


# --- add payee ---


class PayeeAddArgs(Args):
    name: str = Field(min_length=1, max_length=30)
    phone: str | None = Field(default=None, max_length=20)
    account_no: str | None = Field(default=None, max_length=24)
    bank: str | None = Field(default=None, max_length=20)
    alias: str | None = Field(default=None, max_length=20)
    note: str | None = Field(default=None, max_length=40)


def payee_add_resolve(ctx: Ctx, args: PayeeAddArgs) -> dict:
    phone = "".join(ch for ch in (args.phone or "") if ch.isdigit())
    account = "".join(ch for ch in (args.account_no or "") if ch.isdigit())
    if phone and not (len(phone) == 11 and phone.startswith("1")):
        raise Refuse("BAD_PHONE", "手机号需为 11 位数字。", "The phone number must have 11 digits.")
    if account and not 12 <= len(account) <= 19:
        raise Refuse("BAD_ACCOUNT", "卡号应为 12–19 位数字。", "The account number must have 12–19 digits.")
    if not phone and not account:
        raise Ask("phone", "请提供对方的手机号或银行卡号。", "Please give their phone number or account number.")
    for p in ctx.session.exec(select(Payee).where(Payee.user_id == ctx.user.id)):
        if (phone and p.phone == phone) or (account and p.account_no == account):
            raise Refuse("PAYEE_EXISTS", f"该收款人已存在：{p.name}。", f"This payee already exists: {p.name}.")
    return {"name": args.name, "phone": phone, "account_no": account or ("6230" + phone.rjust(12, "0"))[-16:],
            "bank": args.bank or ctx.t("手机号转账", "Phone transfer"), "alias": args.alias, "note": args.note}


def payee_add_run(ctx: Ctx, r: dict) -> dict:
    payee = Payee(user_id=ctx.user.id, name=r["name"], name_en=r["name"], aliases=[r["alias"]] if r["alias"] else [],
                  phone=r["phone"] or "", bank=r["bank"], account_no=r["account_no"], note=r["note"],
                  created_at=clock.iso(ctx.now))
    ctx.session.add(payee)
    ctx.session.flush()
    return {"payee_id": payee.id, "name": payee.name}


def payee_add_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    used = ctx.session.exec(select(Txn.id).where(Txn.payee_id == res["payee_id"])).first()
    payee = ctx.session.get(Payee, res["payee_id"])
    if payee and not used:
        ctx.session.delete(payee)
        return {"removed": True}
    return {"removed": False}


register(Action(
    name="payee_add", args=PayeeAddArgs, help="Save a new payee: name plus phone (11 digits) or account_no; optional bank, alias, note.",
    resolve=payee_add_resolve, run=payee_add_run,
    describe=lambda ctx, r: ctx.t(f"新增收款人 {r['name']}（{r['bank']} ****{r['account_no'][-4:]}）",
                                  f"Add payee {r['name']} ({transfers.bank_en(r['bank'])} ****{r['account_no'][-4:]})"),
    reply=lambda ctx, r, res: ctx.t(f"已添加收款人 {res['name']}。新收款人 24 小时内的大额付款需要强验证。",
                                    f"Added {res['name']}. Large payments to a new payee need strong verification for 24 hours."),
    rule="Y_PAYEE_ADD", compensate=payee_add_compensate,
))


# --- reserves (money set aside inside the customer's own accounts) ---


class ReserveArgs(Args):
    amount_yuan: float | None = Field(default=None, gt=0)
    name: str = Field(default="预留资金", min_length=1, max_length=20)
    until: str | None = Field(default=None, max_length=25)
    month_of: str | None = Field(default=None, max_length=25)


def reserve_resolve(ctx: Ctx, args: ReserveArgs) -> dict:
    fen = amount_fen(args.amount_yuan, ctx)
    source = ledger.checking(ctx.session, ctx.user.id)
    if source.balance_fen < fen:
        raise Refuse("INSUFFICIENT_FUNDS", "活期余额不足。", "Not enough money in the current account.")
    release = None
    if args.until:
        release = clock.to_date(args.until)
    elif args.month_of:
        day = clock.to_date(args.month_of)
        release = clock.add_months(date(day.year, day.month, 1), 1) - timedelta(days=1)
    if release and release < ctx.today:
        raise Refuse("PAST_DATE", "释放日期已经过去。", "That release date has passed.")
    return {"fen": fen, "name": args.name, "release_on": release.isoformat() if release else None,
            "month": release.strftime("%Y-%m") if release else None}


def reserve_run(ctx: Ctx, r: dict) -> dict:
    source = ledger.checking(ctx.session, ctx.user.id)
    reserve = BankAccount(user_id=ctx.user.id, kind="reserve", name=r["name"], name_en=r["name"],
                          number=f"RSV-{clock.iso(ctx.now)[:10]}", purpose=r["name"], release_on=r["release_on"],
                          created_at=clock.iso(ctx.now))
    ctx.session.add(reserve)
    ctx.session.flush()
    ledger.move(ctx.session, source, reserve, r["fen"], when=ctx.now, plan_id=ctx.plan.id if ctx.plan else None)
    return {"reserve_id": reserve.id, "fen": r["fen"], "release_on": r["release_on"]}


def reserve_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    reserve = ctx.session.get(BankAccount, res["reserve_id"])
    if reserve and reserve.status == "open":
        if reserve.balance_fen:
            ledger.move(ctx.session, reserve, ledger.checking(ctx.session, ctx.user.id), reserve.balance_fen, when=ctx.now)
        reserve.status = "closed"
        ctx.session.add(reserve)
    return {"released": True}


register(Action(
    name="reserve_create", args=ReserveArgs,
    help="Set money aside from the current account in a named reserve. amount_yuan, name, until (YYYY-MM-DD) or month_of (a date in the month it is for).",
    resolve=reserve_resolve, run=reserve_run,
    describe=lambda ctx, r: ctx.t(f"从活期划出 {yuan(r['fen'])} 到预留资金“{r['name']}”" + (f"，{r['release_on']} 后未用部分自动退回" if r["release_on"] else ""),
                                  f"Set aside {yuan(r['fen'])} from the current account as “{r['name']}”" + (f"; anything unused returns after {r['release_on']}" if r["release_on"] else "")),
    reply=lambda ctx, r, res: ctx.t(f"已预留 {yuan(res['fen'])}（{r['name']}）。", f"Set aside {yuan(res['fen'])} as “{r['name']}”."),
    rule="Y_INTERNAL_MOVE", compensate=reserve_compensate,
))


class ReleaseArgs(Args):
    reserve: str | None = Field(default=None, max_length=30)


def release_resolve(ctx: Ctx, args: ReleaseArgs) -> dict:
    found = find_reserve(ctx.session, ctx.user.id, args.reserve)
    if found.value is None:
        if found.options:
            raise Ask("reserve", "要释放哪一笔预留资金？", "Which reserve should I release?",
                      [{"value": r.name, "label_zh": f"{r.name} {yuan(r.balance_fen)}", "label_en": f"{r.name_en} {yuan(r.balance_fen)}"}
                       for r in found.options])
        raise Refuse("NO_RESERVE", "没有预留资金。", "There is no money set aside.")
    return {"reserve_id": found.value.id, "name": found.value.name, "fen": found.value.balance_fen}


def release_run(ctx: Ctx, r: dict) -> dict:
    reserve = ledger.account(ctx.session, ctx.user.id, r["reserve_id"])
    fen = reserve.balance_fen
    if fen:
        ledger.move(ctx.session, reserve, ledger.checking(ctx.session, ctx.user.id), fen, when=ctx.now)
    reserve.status = "closed"
    ctx.session.add(reserve)
    return {"fen": fen}


register(Action(
    name="reserve_release", args=ReleaseArgs, help="Return a reserve's money to the current account.",
    resolve=release_resolve, run=release_run,
    describe=lambda ctx, r: ctx.t(f"把预留资金“{r['name']}”的 {yuan(r['fen'])} 退回活期", f"Return {yuan(r['fen'])} from “{r['name']}” to the current account"),
    reply=lambda ctx, r, res: ctx.t(f"已退回 {yuan(res['fen'])} 到活期账户。", f"Returned {yuan(res['fen'])} to the current account."),
    rule="Y_INTERNAL_MOVE",
))


def reserves_run(ctx: Ctx, r: dict) -> dict:
    rows = ctx.session.exec(select(BankAccount).where(BankAccount.user_id == ctx.user.id, BankAccount.kind == "reserve",
                                                      BankAccount.status == "open"))
    return {"items": [{"id": a.id, "name": a.name, "fen": a.balance_fen, "release_on": a.release_on} for a in rows]}


register(Action(
    name="reserves", args=Args, help="List money set aside in reserves.",
    resolve=lambda ctx, a: {}, run=reserves_run,
    describe=lambda ctx, r: ctx.t("查看预留资金", "List reserves"),
    reply=lambda ctx, r, res: "\n".join(f"· {x['name']} {yuan(x['fen'])}" + (ctx.t(f"（{x['release_on']} 退回）", f" (returns {x['release_on']})") if x["release_on"] else "")
                                        for x in res["items"]) or ctx.t("没有预留资金。", "Nothing is set aside."),
))


# --- merchant orders (gift shop partners for the cross-scenario plan) ---

MERCHANTS = {
    "florist": {"name": "花间鲜花", "name_en": "Huajian Florist", "items": [
        {"code": "roses", "name": "11枝红玫瑰花束", "name_en": "11 red roses", "fen": 19_900},
        {"code": "lilies", "name": "百合混搭花束", "name_en": "Lily bouquet", "fen": 16_800},
        {"code": "sunflowers", "name": "向日葵花束", "name_en": "Sunflower bouquet", "fen": 13_900}]},
    "bakery": {"name": "麦香蛋糕坊", "name_en": "Maixiang Bakery", "items": [
        {"code": "strawberry6", "name": "6寸草莓奶油蛋糕", "name_en": "6-inch strawberry cream cake", "fen": 16_800},
        {"code": "chocolate8", "name": "8寸巧克力慕斯蛋糕", "name_en": "8-inch chocolate mousse cake", "fen": 23_800},
        {"code": "fruit8", "name": "8寸鲜果蛋糕", "name_en": "8-inch fresh fruit cake", "fen": 21_800}]},
}


class OrderArgs(Args):
    merchant: Literal["florist", "bakery"]
    item: str | None = Field(default=None, max_length=30)
    deliver_on: str | None = Field(default=None, max_length=25)
    recipient: str | None = Field(default=None, max_length=40)
    pay_from: str | None = Field(default=None, max_length=40)


def order_resolve(ctx: Ctx, args: OrderArgs) -> dict:
    shop = MERCHANTS[args.merchant]
    item = shop["items"][0]
    if args.item:
        query = args.item.casefold()
        item = next((i for i in shop["items"] if query in (i["code"], i["name"].casefold(), i["name_en"].casefold())
                     or query in i["name"].casefold() or query in i["name_en"].casefold()), item)
    if not args.deliver_on:
        raise Ask("deliver_on", "请问哪天送达？", "Which day should it be delivered?")
    deliver = clock.to_date(args.deliver_on) if not args.deliver_on.startswith("$") else None
    if deliver and deliver < ctx.today:
        raise Refuse("PAST_DATE", "送达日期已经过去。", "That delivery date has passed.")
    recipient = None
    if args.recipient:
        payee = resolve_payee(ctx, args.recipient, "recipient")
        recipient = {"payee_id": payee.id, "name": payee.name, "name_en": payee.name_en or payee.name}
    # both languages are kept: the slip can be read in either, whatever language the request was in
    pay_from, label, label_en = "checking", "活期账户", "current account"
    if args.pay_from and args.pay_from.startswith("$"):
        pay_from, label, label_en = args.pay_from, "本计划预留的资金", "the reserve this plan sets aside"
    elif args.pay_from and args.pay_from != "checking":
        found = find_reserve(ctx.session, ctx.user.id, args.pay_from)
        if found.value:
            pay_from, label, label_en = found.value.id, found.value.name, f"the “{found.value.name}” reserve"
    return {"merchant": args.merchant, "shop": shop["name"], "shop_en": shop["name_en"], "item": item["code"],
            "item_name": item["name"], "item_name_en": item["name_en"], "fen": item["fen"],
            "deliver_on": deliver.isoformat() if deliver else args.deliver_on, "recipient": recipient,
            "pay_from": pay_from, "pay_from_label": label, "pay_from_label_en": label_en}


def order_run(ctx: Ctx, r: dict) -> dict:
    if r["pay_from"] == "checking":
        source = ledger.checking(ctx.session, ctx.user.id)
    else:
        source = ledger.account(ctx.session, ctx.user.id, r["pay_from"])
    shop = MERCHANTS[r["merchant"]]
    txn = ledger.debit(ctx.session, source, r["fen"], when=ctx.now, kind="order", counterparty=shop["name"],
                       plan_id=ctx.plan.id if ctx.plan else None, memo=r["item_name"], category="gifts")
    order = Order(user_id=ctx.user.id, merchant=r["merchant"], item=r["item"], item_name=r["item_name"],
                  amount_fen=r["fen"], deliver_on=r["deliver_on"],
                  recipient=r["recipient"]["payee_id"] if r["recipient"] else None, status="paid",
                  pay_from=source.id, pay_at=clock.iso(ctx.now), plan_id=ctx.plan.id if ctx.plan else None,
                  created_at=clock.iso(ctx.now), paid_at=txn.at)
    ctx.session.add(order)
    ctx.session.flush()
    return {"order_id": order.id, "txn_id": txn.id, "fen": r["fen"], "deliver_on": r["deliver_on"]}


def order_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    order = ctx.session.get(Order, res["order_id"])
    if order and order.status == "paid" and clock.to_date(order.deliver_on) > ctx.today:
        target = ledger.account(ctx.session, ctx.user.id, order.pay_from) if ctx.session.get(BankAccount, order.pay_from).status == "open" \
            else ledger.checking(ctx.session, ctx.user.id)
        ledger.credit(ctx.session, target, order.amount_fen, when=ctx.now, kind="refund",
                      counterparty=MERCHANTS[order.merchant]["name"], memo=ctx.t("订单取消退款", "Order cancelled"),
                      category="gifts")
        order.status = "cancelled"
        ctx.session.add(order)
        return {"refunded": True}
    return {"refunded": False}


def order_describe(ctx: Ctx, r: dict) -> str:
    who = ""
    if r["recipient"]:
        who = ctx.t(f"，送给{r['recipient']['name']}", f" for {r['recipient']['name_en']}")
    return ctx.t(f"在{r['shop']}订购 {r['item_name']} {yuan(r['fen'])}，{r['deliver_on']} 送达{who}，从{r['pay_from_label']}支付",
                 f"Order {r['item_name_en']} from {r['shop_en']} ({yuan(r['fen'])}), delivered {r['deliver_on']}{who}, paid from {r.get('pay_from_label_en', r['pay_from_label'])}")


register(Action(
    name="merchant_order", args=OrderArgs,
    help="Order from a partner shop. merchant florist|bakery, item (roses, lilies, sunflowers / strawberry6, chocolate8, fruit8), deliver_on (date or $step.birthday), recipient, pay_from (checking or $step.reserve_id).",
    resolve=order_resolve, run=order_run, describe=order_describe,
    reply=lambda ctx, r, res: ctx.t(f"已下单 {r['item_name']}（{yuan(res['fen'])}），{res['deliver_on']} 送达。",
                                    f"Ordered {r['item_name_en']} ({yuan(res['fen'])}) for delivery on {res['deliver_on']}."),
    rule="PAYMENT", payment=lambda r: r["fen"], compensate=order_compensate, schedulable=True,
))


# --- receipts ---


class ReceiptArgs(Args):
    receipt: str = Field(min_length=1, max_length=36)


def receipt_run(ctx: Ctx, r: dict) -> dict:
    row = ctx.session.get(Upload, r["receipt"])
    return {"reading": row.reading, "flags": row.flags, "read_by": row.read_by, "receipt": row.id}


def receipt_reply(ctx: Ctx, r: dict, res: dict) -> str:
    reading = res["reading"]
    if not reading.get("is_receipt"):
        return ctx.t("这张图片看起来不是小票，或者没能读出金额。", "That doesn't look like a receipt, or I couldn't read a total.")
    lines = [ctx.t(f"{reading['merchant']}，合计 {yuan(reading['total_fen'] or 0)}，共 {len(reading['items'])} 项。",
                   f"{reading['merchant']}: total {yuan(reading['total_fen'] or 0)}, {len(reading['items'])} items.")]
    if res["flags"]:
        lines.append(ctx.t("注意：小票里有隐藏文字或写给机器的指令，我没有执行它们。基于这张小票的操作都需要强验证。",
                           "Careful: this receipt contains hidden text or instructions aimed at a machine. I ignored them, and anything based on it needs strong verification."))
    else:
        lines.append(ctx.t("需要和谁 AA 吗？", "Want to split it with someone?"))
    return "\n".join(lines)


register(Action(
    name="read_receipt", args=ReceiptArgs,
    help="Show what an attached receipt says (merchant, total, items). receipt = the attached receipt id.",
    resolve=lambda ctx, a: {"receipt": load_receipt(ctx, a.receipt, need_total=False).id}, run=receipt_run,
    describe=lambda ctx, r: ctx.t("读取小票", "Read the receipt"), reply=receipt_reply,
    card=lambda ctx, r, res: {"type": "receipt_reading", **res},
))
