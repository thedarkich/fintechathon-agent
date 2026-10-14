"""What happens as (demo) time passes: scheduled steps and transfers run with a fresh tier check,
subscriptions renew (cancelled ones don't), reserves return, salary arrives, friends pay their
split-bill shares, and reminders are raised (renewals, birthdays, unusual transactions)."""

from dataclasses import replace
from datetime import date, datetime, time, timedelta

from sqlmodel import Session, select

from app import clock
from app.agent import audit, executor, policy
from app.agent.actions import REGISTRY, bills
from app.agent.core import TIERS, Ctx
from app.bank import analysis, ledger, transfers
from app.bank.ledger import BankError
from app.clock import CST
from app.models import (
    BankAccount,
    Card,
    Collection,
    Conversation,
    Payee,
    Plan,
    ScheduledTransfer,
    Subscription,
    Txn,
    UserAccount,
)
from app.money import yuan


def scheduled_done(ctx: Ctx, scheduled_id: str) -> None:
    row = ctx.session.get(ScheduledTransfer, scheduled_id)
    if row is None:
        return
    row.last_run_at = clock.iso(ctx.now)
    if row.repeat == "monthly":
        row.run_at = clock.iso(datetime.combine(clock.add_months(clock.to_date(row.run_at), 1),
                                                clock.parse(row.run_at).timetz()))
        row.status = "scheduled"
    else:
        row.status = "done"
    ctx.session.add(row)


def approved_tier(session: Session, row: ScheduledTransfer) -> str:
    plan = session.get(Plan, row.plan_id) if row.plan_id else None
    for step in (plan.steps if plan else []):
        if step["action"] == "schedule_transfer" and (step.get("result") or {}).get("scheduled_id") == row.id:
            return step.get("approved_tier") or step.get("tier") or "yellow"
    return "yellow"


def run_scheduled_transfer(ctx: Ctx, row: ScheduledTransfer) -> None:
    # The bank processes it at its scheduled time, even if the demo clock jumped past it.
    ctx = replace(ctx, now=min(ctx.now, clock.parse(row.run_at)))
    payee = ctx.session.get(Payee, row.payee_id)
    action = REGISTRY["transfer"]
    resolved = {"payee_id": payee.id, "fen": row.amount_fen, "payee_new": False}
    decision = policy.decide(ctx, action, resolved, pay_day=ctx.today, already_counted_fen=row.amount_fen)
    audit.append(ctx.session, ctx.user.id, "scheduled_check", {"scheduled_id": row.id, **decision}, row.plan_id)
    if decision["blocked_by"] or TIERS[decision["tier"]] > TIERS[approved_tier(ctx.session, row)]:
        row.status = "waiting_approval"
        ctx.session.add(row)
        conversation = ctx.session.exec(select(Conversation).where(Conversation.user_id == ctx.user.id)
                                        .order_by(Conversation.created_at.desc()).limit(1)).first()
        if conversation is None:
            conversation = Conversation(user_id=ctx.user.id)
            ctx.session.add(conversation)
            ctx.session.flush()
        plan = Plan(user_id=ctx.user.id, conversation_id=conversation.id, request=f"scheduled transfer {row.id}",
                    lang=ctx.lang, source="scheduler",
                    steps=[{"id": "s1", "action": "transfer", "after": [], "run_at": None,
                            "args": {"payee": payee.id, "amount_yuan": row.amount_fen / 100, "memo": row.memo},
                            "meta": {"scheduled_id": row.id}}])
        ctx.session.add(plan)
        ctx.session.flush()
        executor.prepare(ctx, plan)
        from app.agent.service import reply_for_plan

        reply_for_plan(ctx.session, ctx, conversation, plan)
        executor.notify(ctx, f"scheduled:{row.id}:{row.run_at}", "schedule", "预约转账需要您确认",
                        "A scheduled transfer needs your approval",
                        f"向 {payee.name} 的 {yuan(row.amount_fen)} 执行前复核：当天累计已超过 ¥1,000，需要强验证。",
                        f"{yuan(row.amount_fen)} to {payee.name_en or payee.name}: today's total is now over ¥1,000, so it needs strong verification.")
        return
    try:
        transfers.send(ctx.session, ctx.user, payee, ledger.checking(ctx.session, ctx.user.id), row.amount_fen,
                       now=ctx.now, memo=row.memo, plan_id=row.plan_id, scheduled_id=row.id)
    except BankError as exc:
        row.status, row.detail = "failed", exc.code
        ctx.session.add(row)
        executor.notify(ctx, f"scheduled:{row.id}:{row.run_at}:failed", "schedule", "预约转账未成功",
                        "A scheduled transfer failed", f"向 {payee.name} 转账 {yuan(row.amount_fen)} 失败：{exc.zh}",
                        f"{yuan(row.amount_fen)} to {payee.name_en or payee.name} failed: {exc.en}")
        return
    run_at = row.run_at
    scheduled_done(ctx, row.id)
    audit.append(ctx.session, ctx.user.id, "scheduled_run", {"scheduled_id": row.id, "fen": row.amount_fen}, row.plan_id)
    executor.notify(ctx, f"scheduled:{row.id}:{run_at}:done", "schedule", "预约转账已完成", "Scheduled transfer sent",
                    f"已向 {payee.name} 转账 {yuan(row.amount_fen)}。", f"Sent {yuan(row.amount_fen)} to {payee.name_en or payee.name}.")


def settle_transfers(ctx: Ctx) -> None:
    """Delayed transfers whose arrival time has come clear now: they arrive, or the payee's bank returns them."""
    for row in transfers.settle_due(ctx.session, ctx.user.id, ctx.now):
        amount = yuan(row.amount_fen)
        if row.status == "returned":
            zh, en = transfers.RETURN_REASONS[row.reason]
            executor.notify(ctx, f"transfer:{row.id}:returned", "info", "转账被退回", "A transfer was returned",
                            f"向 {row.payee_name} 的 {amount} 被对方银行退回：{zh}。钱已回到您的账户。",
                            f"The {amount} to {row.payee_name_en} was returned because {en}. The money is back in your account.")
        else:
            executor.notify(ctx, f"transfer:{row.id}:arrived", "info", "转账已到账", "A transfer arrived",
                            f"向 {row.payee_name} 的 {amount} 已到账。", f"The {amount} to {row.payee_name_en} has arrived.")


def renew_subscriptions(ctx: Ctx) -> None:
    for sub in ctx.session.exec(select(Subscription).where(Subscription.user_id == ctx.user.id)):
        if sub.status != "active":
            continue
        while clock.to_date(sub.next_charge_on) <= ctx.today:
            day = clock.to_date(sub.next_charge_on)
            card = ctx.session.get(Card, sub.card_id) if sub.card_id else None
            when = clock.iso(datetime.combine(day, time(0, 30), CST))
            checking = ledger.checking(ctx.session, ctx.user.id)
            declined = card is not None and card.status != "active"
            ctx.session.add(Txn(user_id=ctx.user.id, account_id=checking.id, at=when, amount_fen=-sub.amount_fen,
                                kind="card" if card else "direct_debit", counterparty=sub.merchant, category=sub.category,
                                channel="auto", card_id=sub.card_id, status="declined" if declined else "posted"))
            if not declined:
                checking.balance_fen -= sub.amount_fen
                ctx.session.add(checking)
                sub.last_charged = when
                sub.charges += 1
            else:
                executor.notify(ctx, f"declined:{sub.id}:{day}", "info", "自动扣费被拒绝", "A recurring charge was declined",
                                f"{sub.merchant} {yuan(sub.amount_fen)} 因卡片已冻结或挂失而被拒绝。",
                                f"{sub.merchant} {yuan(sub.amount_fen)} was declined because the card is frozen or lost.")
            sub.next_charge_on = (clock.add_months(day, 1) if sub.cycle == "monthly" else clock.add_months(day, 12)).isoformat()
            ctx.session.add(sub)
        days_left = (clock.to_date(sub.next_charge_on) - ctx.today).days
        remind = sub.remind_days_before or (7 if sub.cycle == "yearly" else None)
        if remind and 0 <= days_left <= remind:
            executor.notify(ctx, f"renewal:{sub.id}:{sub.next_charge_on}", "renewal", f"{sub.merchant} 即将续费",
                            f"{sub.merchant} renews soon",
                            f"{sub.next_charge_on} 将扣费 {yuan(sub.amount_fen)}。不需要的话可以让我取消。",
                            f"{yuan(sub.amount_fen)} will be charged on {sub.next_charge_on}. I can cancel it if you don't need it.",
                            suggestion=f"取消{sub.merchant}", suggestion_en=f"Cancel {sub.merchant}")


def salary(ctx: Ctx) -> None:
    checking = ledger.checking(ctx.session, ctx.user.id)
    last = ctx.session.exec(select(Txn).where(Txn.user_id == ctx.user.id, Txn.kind == "salary")
                            .order_by(Txn.at.desc()).limit(1)).first()
    if last is None:
        return
    day = clock.add_months(date(clock.to_date(last.at).year, clock.to_date(last.at).month, 10), 1)
    while day <= ctx.today:
        ledger.credit(ctx.session, checking, 1_680_000, when=datetime.combine(day, time(9, 30), CST), kind="salary",
                      counterparty=last.counterparty, memo="工资")
        day = clock.add_months(day, 1)


def release_reserves(ctx: Ctx) -> None:
    for reserve in ctx.session.exec(select(BankAccount).where(BankAccount.user_id == ctx.user.id,
                                                             BankAccount.kind == "reserve", BankAccount.status == "open")):
        if reserve.release_on and clock.to_date(reserve.release_on) < ctx.today:
            if reserve.balance_fen:
                ledger.move(ctx.session, reserve, ledger.checking(ctx.session, ctx.user.id), reserve.balance_fen, when=ctx.now)
            reserve.status = "closed"
            ctx.session.add(reserve)
            audit.append(ctx.session, ctx.user.id, "reserve_released", {"reserve": reserve.id})


def collections(ctx: Ctx) -> None:
    for row in ctx.session.exec(select(Collection).where(Collection.user_id == ctx.user.id, Collection.status == "open")):
        created = clock.parse(row.created_at)
        people = [dict(p) for p in row.participants]
        changed = False
        for index, person in enumerate(people):
            if person["status"] == "pending" and ctx.now >= created + timedelta(hours=index + 1):
                ledger.credit(ctx.session, ledger.checking(ctx.session, ctx.user.id), person["share_fen"], when=ctx.now,
                              kind="transfer_in", counterparty=person["name"], memo=f"AA：{row.title}")
                person["status"] = "paid"
                changed = True
        if changed:
            row.participants = people
            if all(p["status"] == "paid" for p in people):
                row.status = "closed"
                executor.notify(ctx, f"collection:{row.id}:closed", "info", "AA 收款已收齐", "Split bill fully paid",
                                f"“{row.title}”的 AA 款项已全部到账。", f"Everyone has paid their share of “{row.title}”.")
            ctx.session.add(row)


def reminders(ctx: Ctx) -> None:
    for payee in ctx.session.exec(select(Payee).where(Payee.user_id == ctx.user.id, Payee.birthday.is_not(None))):
        upcoming = clock.next_birthday(payee.birthday, ctx.today)
        days = (upcoming - ctx.today).days
        if payee.relationship in ("spouse", "mother", "father") and days <= 40:
            who = {"spouse": ("爱人", "your partner"), "mother": ("妈妈", "your mom"), "father": ("爸爸", "your dad")}[payee.relationship]
            executor.notify(ctx, f"birthday:{payee.id}:{upcoming}", "birthday", f"{payee.name}的生日快到了",
                            f"{payee.name_en or payee.name}'s birthday is coming up",
                            f"{upcoming}（{days} 天后）。要我当月预留 ¥1,000，并提前两天订好鲜花和蛋糕吗？",
                            f"{upcoming} (in {days} days). Shall I set aside ¥1,000 that month and order flowers and a cake two days before?",
                            suggestion=f"{who[0]}生日快到了，帮我预留1000元，提前两天订花和蛋糕",
                            suggestion_en=f"It's {who[1]}'s birthday soon: set aside 1000 and order flowers and a cake two days before")
    for item in analysis.anomalies(ctx.session, ctx.user.id, ctx.today, 14):
        if item["code"] in ("NEW_MERCHANT_LARGE", "OVERSEAS_DECLINED", "DUPLICATE_CHARGE"):
            executor.notify(ctx, f"anomaly:{item['txn_id']}", "anomaly",
                            "发现一笔需要留意的交易", "A transaction worth checking",
                            f"{item['at'][:10]} {item['merchant']} {yuan(item['fen'])}：{item['reason_zh']}",
                            f"{item['at'][:10]} {item['merchant']} {yuan(item['fen'])}: {item['reason_en']}",
                            suggestion="帮我看看有没有异常交易", suggestion_en="Check my account for unusual transactions")


def tick(session: Session, user: UserAccount, lang: str = "zh") -> None:
    ctx = Ctx(session=session, user=user, now=clock.now(session, user.id), lang=lang)
    for plan in session.exec(select(Plan).where(Plan.user_id == user.id, Plan.status == "scheduled")).all():
        ctx.plan = plan
        ctx.lang = plan.lang
        executor.execute(ctx, plan)
    ctx.lang = lang
    for row in session.exec(select(ScheduledTransfer).where(
            ScheduledTransfer.user_id == user.id, ScheduledTransfer.status == "scheduled",
            ScheduledTransfer.run_at <= clock.iso(ctx.now))).all():
        run_scheduled_transfer(ctx, row)
    settle_transfers(ctx)
    salary(ctx)
    renew_subscriptions(ctx)
    bills.run_autopays(ctx, executor.notify)
    release_reserves(ctx)
    collections(ctx)
    reminders(ctx)
    session.commit()
