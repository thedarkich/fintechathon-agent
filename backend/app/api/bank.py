"""The app's own pages: the customer reading their bank directly (no AI involved), plus the
simulated phone, reminders, the audit trail, safety locks and passkeys."""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app import clock
from app.agent import audit, locks, policy, screening, verify
from app.agent.actions.queries import card_view, matching, txn_view
from app.agent.actions.subscriptions import subscriptions_run
from app.agent.actions.wealth import holdings_run, products_run
from app.agent.core import Ctx
from app.agent.verify import VerifyError
from app.api.accounts import throttle
from app.api.security import problem, require_user
from app.bank import analysis, transfers
from app.models import (
    AuditEntry,
    BankAccount,
    Card,
    Collection,
    Notification,
    Passkey,
    Payee,
    PayeeMessage,
    Plan,
    RiskProfile,
    ScheduledTransfer,
    SmsMessage,
    Transfer,
    UserAccount,
)

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
Lang = Literal["zh", "en"]


def ctx_for(request: Request, session: Session, user_id: str, lang: str) -> Ctx:
    user = session.get(UserAccount, user_id)
    return Ctx(session=session, user=user, now=clock.now(session, user_id), lang=lang)


def lock_views(session: Session, user_id: str, lang: str) -> list[dict]:
    return [{"scope": x.scope, "reason": x.reason, "since": x.at, "expires_at": x.expires_at,
             "text": locks.describe(x, lang)} for x in locks.active(session, user_id)]


@router.get("/bank/overview")
async def overview(request: Request, lang: Lang = "zh", user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        ctx = ctx_for(request, session, user_id, lang)
        accounts = session.exec(select(BankAccount).where(BankAccount.user_id == user_id, BankAccount.status == "open")
                                .order_by(BankAccount.created_at)).all()
        holdings = holdings_run(ctx, {})
        month = analysis.spending(session, user_id, *analysis.period_bounds("month", ctx.today, 0))
        unread = len(session.exec(select(Notification.id).where(Notification.user_id == user_id,
                                                                 Notification.read.is_(False))).all())
        return {
            "now": clock.iso(ctx.now), "name": ctx.user.name,
            "accounts": [{"id": a.id, "kind": a.kind, "name": a.name if lang == "zh" else a.name_en, "number": a.number,
                          "fen": a.balance_fen, "release_on": a.release_on} for a in accounts],
            "cash_fen": sum(a.balance_fen for a in accounts), "invest_fen": holdings["value_fen"],
            "month_spend_fen": month["spend_fen"], "month_income_fen": month["income_fen"],
            "cards": [card_view(c, ctx) for c in session.exec(select(Card).where(Card.user_id == user_id))],
            "unread": unread, "locks": lock_views(session, user_id, lang),
            "has_passkey": session.exec(select(Passkey.id).where(Passkey.user_id == user_id)).first() is not None,
        }


@router.get("/bank/transactions")
async def transactions(request: Request, days: int = Query(30, ge=1, le=800), category: str | None = None,
                       q: str | None = Query(None, max_length=40), limit: int = Query(100, ge=1, le=500),
                       offset: int = Query(0, ge=0), user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        today = clock.now(session, user_id).date()
        rows = analysis.txns_between(session, user_id, today - timedelta(days=days - 1), today + timedelta(days=1))
        if category:
            rows = [t for t in rows if t.category == category]
        if q:
            rows = [t for t in rows if q.casefold() in t.counterparty.casefold()]
        rows = sorted(rows, key=lambda t: t.at, reverse=True)
        return {"count": len(rows), "items": [txn_view(t) for t in rows[offset:offset + limit]]}


@router.get("/bank/transactions/search")
async def search_transactions(request: Request, start: date, end: date, category: str | None = Query(None, max_length=30),
                              merchant: str | None = Query(None, max_length=40), payee_id: str | None = Query(None, max_length=40),
                              direction: Literal["in", "out", "any"] = "any", min_fen: int | None = Query(None, ge=0),
                              max_fen: int | None = Query(None, ge=0), limit: int | None = Query(None, ge=1, le=50),
                              offset: int = Query(0, ge=0), size: int = Query(10, ge=1, le=50),
                              user_id: str = Depends(require_user)):
    """One page of a search, as the assistant's transactions card ran it (its query), or one day of the calendar.
    Read-only, and only the signed-in customer's own records."""
    if end < start or (end - start).days > 800:
        raise problem(400, "Pick a range of at most 800 days.", "请选择不超过 800 天的时间范围。", "BAD_RANGE")
    r = {"start": start.isoformat(), "end": end.isoformat(), "category": category, "merchant": merchant, "payee_id": payee_id,
         "direction": direction, "min_fen": min_fen, "max_fen": max_fen, "limit": limit}
    with Session(request.app.state.runtime.engine) as session:
        rows = matching(session, user_id, r)
        return {"count": len(rows), "items": [txn_view(t) for t in rows[offset:offset + size]]}


@router.get("/bank/report")
async def report(request: Request, period: Literal["month", "year"] = "month", offset: int = Query(0, ge=-24, le=0),
                 user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        today = clock.now(session, user_id).date()
        return analysis.report(session, user_id, today, period, offset)


@router.get("/bank/anomalies")
async def anomalies(request: Request, days: int = Query(30, ge=7, le=120), user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        today = clock.now(session, user_id).date()
        return {"items": analysis.anomalies(session, user_id, today, days)}


@router.get("/bank/subscriptions")
async def subscriptions(request: Request, lang: Lang = "zh", user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        result = subscriptions_run(ctx_for(request, session, user_id, lang), {})
        session.commit()
        return result


@router.get("/bank/cards")
async def cards(request: Request, lang: Lang = "zh", user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        ctx = ctx_for(request, session, user_id, lang)
        return {"items": [card_view(c, ctx) for c in session.exec(select(Card).where(Card.user_id == user_id)
                                                                  .order_by(Card.created_at))]}


@router.get("/bank/payees")
async def payees(request: Request, user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        rows = session.exec(select(Payee).where(Payee.user_id == user_id).order_by(Payee.created_at)).all()
        return {"items": [{"id": p.id, "name": p.name, "name_en": p.name_en, "note": p.note, "note_en": transfers.note_en(p.note), "bank": p.bank,
                           "bank_en": transfers.bank_en(p.bank),
                           "account_tail": p.account_no[-4:], "phone": p.phone[:3] + "****" + p.phone[-4:],
                           "relationship": p.relationship, "birthday": p.birthday, "created_at": p.created_at}
                          for p in rows]}


@router.get("/bank/wealth")
async def wealth(request: Request, lang: Lang = "zh", user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        ctx = ctx_for(request, session, user_id, lang)
        profile = session.get(RiskProfile, user_id)
        return {"holdings": holdings_run(ctx, {}), "products": products_run(ctx, {"risk_max": None, "kind": None}),
                "profile": {"level": profile.level, "assessed_at": profile.assessed_at} if profile else None}


@router.get("/bank/scheduled")
async def scheduled(request: Request, user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        rows = session.exec(select(ScheduledTransfer).where(ScheduledTransfer.user_id == user_id)
                            .order_by(ScheduledTransfer.run_at)).all()
        names = {p.id: (p.name, p.name_en or p.name) for p in session.exec(select(Payee).where(Payee.user_id == user_id))}
        collections = session.exec(select(Collection).where(Collection.user_id == user_id)
                                   .order_by(Collection.created_at.desc())).all()
        return {"transfers": [{"id": s.id, "payee": names.get(s.payee_id, ("?", "?"))[0], "payee_en": names.get(s.payee_id, ("?", "?"))[1],
                               "fen": s.amount_fen, "run_at": s.run_at,
                               "repeat": s.repeat, "status": s.status} for s in rows],
                "collections": [{"id": c.id, "title": c.title, "total_fen": c.total_fen, "status": c.status,
                                 "participants": c.participants} for c in collections]}


@router.get("/bank/transfers")
async def transfer_list(request: Request, lang: Lang = "zh", user_id: str = Depends(require_user)):
    """Transfers as the bank processes them: route, arrival option and every stage with its time."""
    with Session(request.app.state.runtime.engine) as session:
        now = clock.now(session, user_id)
        rows = session.exec(select(Transfer).where(Transfer.user_id == user_id)
                            .order_by(Transfer.created_at.desc()).limit(30)).all()
        return {"items": [transfers.view(row, lang, now) for row in rows]}


@router.get("/payee-phone")
async def payee_phone(request: Request, user_id: str = Depends(require_user)):
    """What the payees' phones received from their banks (the other half of the two-phone demo)."""
    with Session(request.app.state.runtime.engine) as session:
        names = {p.id: (p.name, p.name_en or p.name) for p in session.exec(select(Payee).where(Payee.user_id == user_id))}
        rows = session.exec(select(PayeeMessage).where(PayeeMessage.user_id == user_id)
                            .order_by(PayeeMessage.at.desc()).limit(20)).all()
        return {"items": [{"id": m.id, "at": m.at, "payee": names.get(m.payee_id, ("?", "?"))[0],
                           "payee_en": names.get(m.payee_id, ("?", "?"))[1], "text": m.text, "text_en": m.text_en}
                          for m in rows]}


@router.get("/notifications")
async def notifications(request: Request, lang: Lang = "zh", user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        rows = session.exec(select(Notification).where(Notification.user_id == user_id)
                            .order_by(Notification.at.desc()).limit(50)).all()
        return {"items": [{"id": n.id, "at": n.at, "kind": n.kind, "read": n.read,
                           "title": n.title if lang == "zh" else n.title_en, "body": n.body if lang == "zh" else n.body_en,
                           "suggestion": n.suggestion if lang == "zh" else n.suggestion_en} for n in rows]}


@router.post("/notifications/read")
async def notifications_read(request: Request, user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        for n in session.exec(select(Notification).where(Notification.user_id == user_id, Notification.read.is_(False))):
            n.read = True
            session.add(n)
        session.commit()
        return {"ok": True}


@router.get("/phone")
async def phone(request: Request, user_id: str = Depends(require_user)):
    """The simulated phone's SMS inbox (demo only: a real bank sends these to the customer's phone)."""
    with Session(request.app.state.runtime.engine) as session:
        user = session.get(UserAccount, user_id)
        rows = session.exec(select(SmsMessage).where(SmsMessage.user_id == user_id)
                            .order_by(SmsMessage.at.desc()).limit(20)).all()
        return {"number": user.phone[:3] + "****" + user.phone[-4:],
                "items": [{"id": m.id, "at": m.at, "text": m.text, "text_en": m.text_en} for m in rows]}


# What the codes in the audit log mean, [zh, en] by kind of code. The entries keep their codes (they are hashed as
# written); the History page shows these words next to them.
AUDIT_LABELS = {
    "rule": policy.RULE_TEXT, "signal": policy.SIGNAL_TEXT, "flag": screening.FLAG_TEXT, "lock": locks.MESSAGES,
    "purpose": {key: value[:2] for key, value in policy.PURPOSES.items()},
    "route": transfers.ROUTES, "arrival": transfers.ARRIVALS, "status": transfers.STATUSES, "return": transfers.RETURN_REASONS,
}


@router.get("/audit")
async def audit_log(request: Request, plan_id: str | None = Query(None, max_length=36),
                    limit: int = Query(200, ge=1, le=1000), user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        query = select(AuditEntry).where(AuditEntry.user_id == user_id)
        if plan_id:
            query = query.where(AuditEntry.plan_id == plan_id)
        rows = session.exec(query.order_by(AuditEntry.seq.desc()).limit(limit)).all()
        return {"items": [{"seq": e.seq, "kind": e.kind, "plan_id": e.plan_id, "data": e.data, "at": e.at,
                           "hash": e.hash, "prev_hash": e.prev_hash} for e in rows], "labels": AUDIT_LABELS}


@router.get("/audit/verify")
async def audit_verify(request: Request, user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        return audit.verify(session, user_id)


PAYMENT_ACTIONS = {"transfer", "phone_transfer", "schedule_transfer", "merchant_order", "wealth_subscribe"}


def bank_outcome(session: Session, plan: Plan, lang: str) -> tuple[str | None, str | None]:
    """A finished plan's transfer can still be returned by the payee's bank or cancelled before it arrives;
    the customer's history says what happened to the money, not only that the step ran."""
    for step in plan.steps:
        transfer_id = (step.get("result") or {}).get("transfer_id")
        row = session.get(Transfer, transfer_id) if step["action"] in ("transfer", "phone_transfer") and transfer_id else None
        if row is None:
            continue
        zh = lang == "zh"
        if row.status == "returned":
            why = transfers.RETURN_REASONS[row.reason][0 if zh else 1] if row.reason else ""
            return "returned", (f"对方银行退回：{why}" if zh else f"Returned by the payee's bank: {why}")
        if row.status == "cancelled":
            return "cancelled", ("到账前已撤销，钱已退回" if zh else "Cancelled before it arrived; the money is back")
        if row.status in ("accepted", "clearing"):
            return "waiting", (f"预计 {row.arrive_at[5:16].replace('T', ' ')} 到账" if zh
                               else f"Arriving around {row.arrive_at[5:16].replace('T', ' ')}")
    return None, None


@router.get("/plans")
async def plans(request: Request, lang: Lang = "zh", limit: int = Query(50, ge=1, le=200),
                user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        rows = session.exec(select(Plan).where(Plan.user_id == user_id).order_by(Plan.created_at.desc()).limit(limit)).all()
        items = []
        for p in rows:
            failed = next((s for s in p.steps if s.get("status") == "failed" and s.get("error")), None)
            outcome, outcome_text = bank_outcome(session, p, lang) if p.status == "done" else (None, None)
            items.append({
                "id": p.id, "status": p.status, "tier": p.tier, "request": p.request, "created_at": p.created_at,
                "source": p.source, "flags": p.flags, "steps": len(p.steps),
                "actions": [s["action"] for s in p.steps],
                "fen": sum((s.get("resolved") or {}).get("fen") or 0 for s in p.steps if s["action"] in PAYMENT_ACTIONS) or None,
                "reason": (failed["error"]["zh"] if lang == "zh" else failed["error"]["en"]) if failed else outcome_text,
                "outcome": outcome,
            })
        return {"items": items}


# --- safety locks ---


class UnlockIn(BaseModel):
    pin: str = Field(pattern=r"^\d{6}$")
    challenge_id: str = Field(max_length=36)
    code: str = Field(max_length=8)
    lang: Lang = "zh"


@router.get("/locks")
async def get_locks(request: Request, lang: Lang = "zh", user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        return {"items": lock_views(session, user_id, lang)}


@router.post("/unlock/sms")
async def unlock_sms(request: Request, user_id: str = Depends(require_user)):
    throttle(request, [("sms-user", user_id, 600, 10)])  # the same per-customer cap on codes as for plans
    with Session(request.app.state.runtime.engine) as session:
        user = session.get(UserAccount, user_id)
        challenge = verify.send_sms(session, user, plan_id=None, purpose="unlock", summary_zh="解除安全锁",
                                    summary_en="lifting a safety lock")
        session.commit()
        return {"challenge_id": challenge.id, "phone": user.phone[:3] + "****" + user.phone[-4:]}


@router.post("/unlock")
async def unlock(request: Request, body: UnlockIn, user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        user = session.get(UserAccount, user_id)
        try:
            verify.check_pin(session, user, body.pin, None)
            verify.check_sms(session, user, body.challenge_id, body.code, plan_id=None, purpose="unlock")
        except VerifyError as exc:
            raise problem(exc.status, exc.en, exc.zh, exc.code) from None
        cleared = locks.clear(session, user_id, by="customer", scopes={"agent", "payments"})
        session.commit()
        return {"cleared": cleared, "locks": lock_views(session, user_id, body.lang)}


# --- passkeys ---


class PasskeyIn(BaseModel):
    credential: dict
    label: str = Field(default="", max_length=40)


@router.get("/passkeys")
async def passkeys(request: Request, user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        rows = session.exec(select(Passkey).where(Passkey.user_id == user_id)).all()
        return {"items": [{"id": p.id[:12], "label": p.label, "created_at": p.created_at} for p in rows]}


@router.post("/passkeys/options")
async def passkey_options(request: Request, user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        user = session.get(UserAccount, user_id)
        options = verify.passkey_registration_options(session, user, request.app.state.runtime.settings)
        session.commit()
        return options


@router.post("/passkeys")
async def passkey_add(request: Request, body: PasskeyIn, user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        user = session.get(UserAccount, user_id)
        try:
            key = verify.passkey_register(session, user, request.app.state.runtime.settings, body.credential, body.label)
        except VerifyError as exc:
            raise problem(exc.status, exc.en, exc.zh, exc.code) from None
        session.commit()
        return {"id": key.id[:12], "label": key.label}
