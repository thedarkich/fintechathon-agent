"""Bills and shop payments started from the app's screens: Payments (缴费) and QR pay (扫码付).

The screens send the same kind of plan as the assistant: these steps are resolved, tiered, approved and
audited exactly like a transfer. They are screen_only, so the assistant's planner is never offered them.
"""

from datetime import date, datetime, time

from pydantic import Field
from sqlmodel import select

from app import clock
from app.agent.actions.payments import SINGLE_TRANSFER_CAP, amount_fen, source_account
from app.agent.core import Action, Args, Ask, Ctx, Refuse, register
from app.bank import billers, ledger, qr
from app.bank.directory import mask_name
from app.clock import CST
from app.models import BillPayment, SavedBill
from app.money import to_fen, yuan

TOP_UP_CAP = 50_000  # ¥500 per mobile top-up


def provider_info(code: str) -> dict:
    if code not in billers.PROVIDERS:
        raise Refuse("UNKNOWN_PROVIDER", "没有这个缴费单位。", "There is no such provider.")
    return billers.PROVIDERS[code]


def saved_bill(ctx: Ctx, provider: str, account: str) -> SavedBill | None:
    return ctx.session.exec(select(SavedBill).where(SavedBill.user_id == ctx.user.id, SavedBill.provider == provider,
                                                    SavedBill.account == account, SavedBill.status == "active")).first()


def account_for(ctx: Ctx, provider: str, given: str | None) -> str:
    """The account typed on the screen, or the one saved for this provider."""
    if given:
        account = billers.normalize_account(provider, given)
    else:
        saved = ctx.session.exec(select(SavedBill).where(SavedBill.user_id == ctx.user.id, SavedBill.provider == provider,
                                                         SavedBill.status == "active")).all()
        if len(saved) != 1:
            raise Ask("account", "请填写户号。", "Which account?",
                      [{"value": s.account, "label_zh": s.account, "label_en": s.account} for s in saved])
        account = saved[0].account
    if problem := billers.check_account(provider, account):
        raise Refuse("BAD_ACCOUNT", *problem)
    return account


def names(info: dict) -> dict:
    zh, en, _ = billers.CATEGORIES[info["category"]]
    return {"provider_name": info["name"], "provider_name_en": info["name_en"], "category": info["category"],
            "category_name": zh, "category_name_en": en}


def holder_for(ctx: Ctx, provider: str, account: str, saved: SavedBill | None) -> str:
    # bills the customer already paid by direct debit are in their own name
    return mask_name(ctx.user.name) if saved and saved.found_in_history and ctx.user.name else billers.holder(provider, account)


# --- pay a bill or top up a phone ---


class BillPayArgs(Args):
    provider: str = Field(min_length=2, max_length=12)
    account: str | None = Field(default=None, max_length=24)
    amount_yuan: float | None = Field(default=None, gt=0)
    save: bool = False


def bill_pay_resolve(ctx: Ctx, args: BillPayArgs) -> dict:
    info = provider_info(args.provider)
    account = account_for(ctx, args.provider, args.account)
    saved = saved_bill(ctx, args.provider, account)
    period = ctx.today.strftime("%Y-%m")
    state = billers.bill(ctx.session, ctx.user.id, args.provider, account, period,
                         from_history=bool(saved and saved.found_in_history))
    if info["category"] == "mobile":
        fen = amount_fen(args.amount_yuan, ctx)
        if fen > TOP_UP_CAP:
            raise Refuse("OVER_TOP_UP_CAP", f"单次充值最多 {yuan(TOP_UP_CAP)}。", f"A top-up can be at most {yuan(TOP_UP_CAP)}.")
        holder, billed_period = None, None
    else:
        if not state["due_fen"]:
            raise Refuse("NOTHING_DUE", f"{info['name']} {account} 目前没有待缴费用。",
                         f"Nothing is due on {info['name_en']} {account}.")
        fen = to_fen(args.amount_yuan) if args.amount_yuan else state["due_fen"]
        if not 0 < fen <= state["due_fen"]:
            raise Refuse("OVER_DUE", f"金额不能超过待缴的 {yuan(state['due_fen'])}。",
                         f"The amount can't be more than the {yuan(state['due_fen'])} due.")
        holder = holder_for(ctx, args.provider, account, saved)
        billed_period = None if info["category"] == "fines" else period
    source = source_account(ctx, "checking")
    if source.balance_fen < fen:
        raise Refuse("INSUFFICIENT_FUNDS", f"{source.name}余额 {yuan(source.balance_fen)}，不足以支付 {yuan(fen)}。",
                     f"{source.name_en} has {yuan(source.balance_fen)}, not enough for {yuan(fen)}.")
    return {"provider": args.provider, **names(info), "account": account, "holder": holder, "period": billed_period,
            "fen": fen, "source_id": source.id, "source": source.name, "source_en": source.name_en,
            "save": bool(args.save and saved is None), "detail": state["detail"]}


def bill_pay_run(ctx: Ctx, r: dict) -> dict:
    info = billers.PROVIDERS[r["provider"]]
    source = ledger.account(ctx.session, ctx.user.id, r["source_id"])
    txn = ledger.debit(ctx.session, source, r["fen"], when=ctx.now, kind="bill", counterparty=info["counterparty"],
                       memo=r["account"], category=info["spend"], plan_id=ctx.plan.id if ctx.plan else None)
    ctx.session.add(BillPayment(user_id=ctx.user.id, provider=r["provider"], account=r["account"],
                                period=r["period"] or ctx.today.strftime("%Y-%m"), amount_fen=r["fen"], at=txn.at,
                                txn_id=txn.id, plan_id=ctx.plan.id if ctx.plan else None))
    if r.get("save") and saved_bill(ctx, r["provider"], r["account"]) is None:
        ctx.session.add(SavedBill(user_id=ctx.user.id, provider=r["provider"], account=r["account"], created_at=txn.at))
    ctx.session.flush()
    return {"fen": r["fen"], "balance_fen": source.balance_fen, "txn_id": txn.id, "at": txn.at}


def bill_pay_describe(ctx: Ctx, r: dict) -> str:
    if r["category"] == "mobile":
        return ctx.t(f"给 {r['account']} 充话费 {yuan(r['fen'])}（{r['provider_name']}）",
                     f"Top up {r['account']} with {yuan(r['fen'])} ({r['provider_name_en']})")
    month = ctx.t(f"，{r['period'][:4]}年{int(r['period'][5:])}月账单", f", {r['period']} bill") if r.get("period") else ""
    return ctx.t(f"缴{r['category_name']} {yuan(r['fen'])}：{r['provider_name']} {r['account']}{month}",
                 f"Pay {yuan(r['fen'])} {r['category_name_en'].lower()}: {r['provider_name_en']} {r['account']}{month}")


register(Action(
    name="bill_pay", args=BillPayArgs,
    help="Pay a bill (electricity, water, gas, internet, property, traffic fine) or top up a phone, from the Payments screen.",
    resolve=bill_pay_resolve, run=bill_pay_run, describe=bill_pay_describe,
    reply=lambda ctx, r, res: ctx.t(f"已缴费：{r['provider_name']} {yuan(r['fen'])}。{r['source']}余额 {yuan(res['balance_fen'])}。",
                                    f"Paid {yuan(r['fen'])} to {r['provider_name_en']}. {r['source_en']} balance: {yuan(res['balance_fen'])}."),
    rule="PAYMENT", payment=lambda r: r["fen"], screen_only=True,
))


# --- automatic payment of a monthly bill ---


class BillAutopayArgs(Args):
    provider: str = Field(min_length=2, max_length=12)
    account: str | None = Field(default=None, max_length=24)
    on: bool = True
    limit_yuan: float | None = Field(default=None, gt=0, le=5000)


def first_autopay_day(ctx: Ctx, saved: SavedBill | None) -> date:
    if saved and saved.next_autopay_on and date.fromisoformat(saved.next_autopay_on) > ctx.today:
        return date.fromisoformat(saved.next_autopay_on)
    day = date(ctx.today.year, ctx.today.month, 10)  # the day after this month's bill is out
    return day if day > ctx.today else clock.add_months(day, 1)


def bill_autopay_resolve(ctx: Ctx, args: BillAutopayArgs) -> dict:
    info = provider_info(args.provider)
    if info["bill"] is None:
        raise Refuse("NO_AUTOPAY", f"{info['name']}只能手动缴费。", f"{info['name_en']} can only be paid by hand.")
    account = account_for(ctx, args.provider, args.account)
    saved = saved_bill(ctx, args.provider, account)
    if not args.on and not (saved and saved.autopay):
        raise Refuse("AUTOPAY_OFF", "这个账单没有开通自动缴费。", "Automatic payment is not on for this bill.")
    limit = to_fen(args.limit_yuan) if args.limit_yuan else (saved.autopay_limit_fen if saved and saved.autopay_limit_fen
                                                            else billers.AUTOPAY_LIMIT_FEN)
    return {"provider": args.provider, **names(info), "account": account, "on": args.on, "limit_fen": limit,
            "first_on": first_autopay_day(ctx, saved).isoformat() if args.on else None}


def bill_autopay_run(ctx: Ctx, r: dict) -> dict:
    saved = saved_bill(ctx, r["provider"], r["account"])
    before = {"autopay": saved.autopay, "limit": saved.autopay_limit_fen, "next": saved.next_autopay_on} if saved else None
    if saved is None:
        saved = SavedBill(user_id=ctx.user.id, provider=r["provider"], account=r["account"], created_at=clock.iso(ctx.now))
    saved.autopay = r["on"]
    saved.autopay_limit_fen = r["limit_fen"] if r["on"] else saved.autopay_limit_fen
    saved.next_autopay_on = r["first_on"]
    ctx.session.add(saved)
    ctx.session.flush()
    return {"saved_id": saved.id, "before": before}


def bill_autopay_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    saved = ctx.session.get(SavedBill, res["saved_id"])
    if saved is None:
        return {"restored": False}
    if res["before"] is None:
        saved.status = "removed"
    else:
        saved.autopay, saved.autopay_limit_fen, saved.next_autopay_on = (res["before"]["autopay"], res["before"]["limit"],
                                                                         res["before"]["next"])
    ctx.session.add(saved)
    return {"restored": True}


def bill_autopay_describe(ctx: Ctx, r: dict) -> str:
    if not r["on"]:
        return ctx.t(f"关闭{r['category_name']}自动缴费：{r['provider_name']} {r['account']}",
                     f"Turn off automatic {r['category_name_en'].lower()} payment: {r['provider_name_en']} {r['account']}")
    return ctx.t(f"开通{r['category_name']}自动缴费：{r['provider_name']} {r['account']}，每月账单不超过 {yuan(r['limit_fen'])} 时"
                 f"从活期自动扣款，超过会提醒你手动缴，{r['first_on']} 起",
                 f"Pay {r['category_name_en'].lower()} automatically: {r['provider_name_en']} {r['account']}, each month's bill up to "
                 f"{yuan(r['limit_fen'])} from your current account (above that you're asked to pay it yourself), from {r['first_on']}")


register(Action(
    name="bill_autopay", args=BillAutopayArgs,
    help="Turn automatic payment of a monthly bill on (with a limit) or off, from the Payments screen.",
    resolve=bill_autopay_resolve, run=bill_autopay_run, describe=bill_autopay_describe,
    reply=lambda ctx, r, res: ctx.t("已开通自动缴费。" if r["on"] else "已关闭自动缴费。",
                                    "Automatic payment is on." if r["on"] else "Automatic payment is off."),
    rule="Y_SUBSCRIPTION", compensate=bill_autopay_compensate, screen_only=True,
))


def run_autopays(ctx: Ctx, notify) -> None:
    """Pay each bill whose automatic-payment day has come, up to its limit; above the limit, tell the customer."""
    rows = ctx.session.exec(select(SavedBill).where(SavedBill.user_id == ctx.user.id, SavedBill.status == "active",
                                                    SavedBill.autopay == True)).all()  # noqa: E712
    for saved in rows:
        info = billers.PROVIDERS.get(saved.provider)
        if info is None or not saved.next_autopay_on:
            continue
        day = date.fromisoformat(saved.next_autopay_on)
        while day <= ctx.today:
            period = day.strftime("%Y-%m")
            due = billers.bill(ctx.session, ctx.user.id, saved.provider, saved.account, period,
                               from_history=saved.found_in_history)["due_fen"] or 0
            key = f"autopay:{saved.id}:{period}"
            limit = saved.autopay_limit_fen or billers.AUTOPAY_LIMIT_FEN
            checking = ledger.checking(ctx.session, ctx.user.id)
            if due and due > limit:
                notify(ctx, key, "info", f"{info['name']}账单超过自动缴费上限", f"{info['name_en']} bill is over your limit",
                       f"本月 {yuan(due)}，超过你设的 {yuan(limit)}，这次没有自动扣款。请在“缴费”里核对后手动缴纳。",
                       f"This month's {yuan(due)} is over your {yuan(limit)} limit, so it wasn't paid automatically. "
                       f"Check it and pay it in Payments.")
            elif due and checking.balance_fen < due:
                notify(ctx, key, "info", f"{info['name']}自动缴费失败", f"{info['name_en']} automatic payment failed",
                       f"活期余额不足 {yuan(due)}。", f"There wasn't {yuan(due)} in your current account.")
            elif due:
                when = min(datetime.combine(day, time(4, 15), CST), ctx.now)
                txn = ledger.debit(ctx.session, checking, due, when=when, kind="bill", counterparty=info["counterparty"],
                                   memo=saved.account, category=info["spend"])
                txn.channel = "auto"
                ctx.session.add(BillPayment(user_id=ctx.user.id, provider=saved.provider, account=saved.account,
                                            period=period, amount_fen=due, at=txn.at, auto=True, txn_id=txn.id))
                notify(ctx, key, "info", f"已自动缴纳{info['name']}账单", f"{info['name_en']} bill paid automatically",
                       f"{period} 账单 {yuan(due)} 已从活期扣款。", f"The {period} bill of {yuan(due)} was paid from your current account.")
            day = clock.add_months(day, 1)
        saved.next_autopay_on = day.isoformat()
        ctx.session.add(saved)


# --- pay a shop by QR code ---


class QrPayArgs(Args):
    code: str = Field(pattern=r"^M\d{4}$")
    amount_yuan: float | None = Field(default=None, gt=0)
    order: str | None = Field(default=None, pattern=r"^[A-Za-z0-9-]{1,24}$")


def qr_pay_resolve(ctx: Ctx, args: QrPayArgs) -> dict:
    if args.code not in qr.MERCHANTS:
        raise Refuse("UNKNOWN_MERCHANT", "这个收款码不属于本行登记的商户。", "This code doesn't belong to a shop registered with the bank.")
    name, name_en, city, category = qr.MERCHANTS[args.code]
    fen = amount_fen(args.amount_yuan, ctx)
    if fen > SINGLE_TRANSFER_CAP:
        raise Refuse("OVER_SINGLE_CAP", f"单笔付款上限为 {yuan(SINGLE_TRANSFER_CAP)}。",
                     f"A single payment can be at most {yuan(SINGLE_TRANSFER_CAP)}.")
    source = source_account(ctx, "checking")
    if source.balance_fen < fen:
        raise Refuse("INSUFFICIENT_FUNDS", f"{source.name}余额 {yuan(source.balance_fen)}，不足以支付 {yuan(fen)}。",
                     f"{source.name_en} has {yuan(source.balance_fen)}, not enough for {yuan(fen)}.")
    return {"code": args.code, "merchant": name, "merchant_en": name_en, "city": city, "category": category, "fen": fen,
            "order": args.order, "source_id": source.id, "source": source.name, "source_en": source.name_en}


def qr_pay_run(ctx: Ctx, r: dict) -> dict:
    source = ledger.account(ctx.session, ctx.user.id, r["source_id"])
    txn = ledger.debit(ctx.session, source, r["fen"], when=ctx.now, kind="qr", counterparty=r["merchant"],
                       memo=r.get("order"), category=r["category"], plan_id=ctx.plan.id if ctx.plan else None)
    txn.channel = "pos"
    ctx.session.add(txn)
    return {"fen": r["fen"], "balance_fen": source.balance_fen, "txn_id": txn.id, "at": txn.at}


register(Action(
    name="qr_pay", args=QrPayArgs,
    help="Pay a shop by scanning its QR code, from the QR screen.",
    resolve=qr_pay_resolve, run=qr_pay_run,
    describe=lambda ctx, r: ctx.t(f"扫码付款 {yuan(r['fen'])} 给 {r['merchant']}" + (f"（订单 {r['order']}）" if r.get("order") else ""),
                                  f"Pay {yuan(r['fen'])} to {r['merchant_en']} by QR" + (f" (order {r['order']})" if r.get("order") else "")),
    reply=lambda ctx, r, res: ctx.t(f"已付款：{r['merchant']} {yuan(r['fen'])}。{r['source']}余额 {yuan(res['balance_fen'])}。",
                                    f"Paid {yuan(r['fen'])} to {r['merchant_en']}. {r['source_en']} balance: {yuan(res['balance_fen'])}."),
    rule="PAYMENT", payment=lambda r: r["fen"], screen_only=True,
))
