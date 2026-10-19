"""The app's own screens: transfer by phone number, Payments (bills and top-ups), and QR pay.

Lookups here only read. Anything that moves money goes through POST /api/screens/plan, which makes the
same kind of plan as the assistant and returns it waiting for the customer's confirmation.
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app import clock
from app.agent import service
from app.agent.core import Ctx
from app.api.accounts import throttle
from app.api.security import problem, require_user
from app.api.views import plan_view
from app.bank import billers, directory, qr, transfers
from app.bank.directory import mask_name
from app.models import Contact, SavedBill, UserAccount

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
Lang = Literal["zh", "en"]


def engine(request: Request):
    return request.app.state.runtime.engine


class ScreenPlanIn(BaseModel):
    action: Literal["transfer", "phone_transfer", "bill_pay", "bill_autopay", "qr_pay", "contact_add"]
    args: dict[str, Any] = Field(max_length=8)
    lang: Lang = "zh"


@router.post("/screens/plan")
async def screens_plan(request: Request, body: ScreenPlanIn, user_id: str = Depends(require_user)):
    with Session(engine(request)) as session:
        user = session.get(UserAccount, user_id)
        try:
            plan = service.screen_plan(session, user, body.action, body.args, lang=body.lang)
        except service.ScreenError as exc:
            raise problem(422, "Those details can't be used.", "这些信息无法使用。", exc.errors[0].split(":")[0]) from None
        ctx = Ctx(session=session, user=user, now=clock.now(session, user_id), lang=body.lang, plan=plan)
        return {"plan": plan_view(plan, ctx)}


# --- transfer by phone number ---


@router.get("/directory")
async def directory_lookup(request: Request, phone: str = Query(pattern=r"^1\d{10}$"), lang: Lang = "zh",
                           user_id: str = Depends(require_user)):
    """Who a number belongs to: a saved contact, someone in the phone directory (masked name), or nobody."""
    throttle(request, [("directory", user_id, 3600, 60)])  # a lookup is not a way to list strangers' names
    with Session(engine(request)) as session:
        user = session.get(UserAccount, user_id)
        if user.phone and phone == user.phone:
            return {"kind": "self"}
        saved = session.exec(select(Contact).where(Contact.user_id == user_id, Contact.phone == phone)).first()
        zh = lang == "zh"
        if saved:
            return {"kind": "contact", "contact": {"id": saved.id, "name": saved.name if zh else (saved.name_en or saved.name),
                                               "note": saved.note if zh else transfers.note_en(saved.note),
                                               "bank": saved.bank if zh else transfers.bank_en(saved.bank),
                                               "account_tail": saved.account_no[-4:]}}
        found = directory.lookup(phone)
        if found is None:
            return {"kind": "none"}
        return {"kind": "directory", "name": found["masked"], "bank": found["bank"] if zh else transfers.bank_en(found["bank"]),
                "same_bank": found["bank"] == transfers.OWN_BANK}


# --- payments ---


def bill_view(session: Session, user: UserAccount, saved: SavedBill, lang: str) -> dict:
    today = clock.now(session, user.id).date()
    period = today.strftime("%Y-%m")
    state = billers.bill(session, user.id, saved.provider, saved.account, period, from_history=saved.found_in_history)
    own_phone = billers.PROVIDERS[saved.provider]["category"] == "mobile" and saved.account == user.phone
    return {"id": saved.id, "provider": billers.provider_view(saved.provider, lang), "account": saved.account,
            "label": ("我的手机" if lang == "zh" else "My phone") if own_phone else saved.label,
            "autopay": saved.autopay, "autopay_limit_fen": saved.autopay_limit_fen, "next_autopay_on": saved.next_autopay_on,
            "billed_fen": state["billed_fen"], "due_fen": state["due_fen"], "period": period if state["billed_fen"] is not None else None}


@router.get("/billers")
async def biller_catalogue(lang: Lang = "zh"):
    return {"categories": billers.catalogue(lang)}


@router.get("/bills")
async def saved_bills(request: Request, lang: Lang = "zh", user_id: str = Depends(require_user)):
    with Session(engine(request)) as session:
        user = session.get(UserAccount, user_id)
        billers.setup_from_history(session, user_id, clock.now(session, user_id).date(), user.phone)
        session.commit()
        rows = session.exec(select(SavedBill).where(SavedBill.user_id == user_id, SavedBill.status == "active")
                            .order_by(SavedBill.created_at)).all()
        return {"items": [bill_view(session, user, s, lang) for s in rows]}


@router.get("/bills/lookup")
async def bill_lookup(request: Request, provider: str = Query(max_length=12), account: str = Query(max_length=24),
                      lang: Lang = "zh", user_id: str = Depends(require_user)):
    """What a provider says is due on an account this month, before the customer decides to pay."""
    if provider not in billers.PROVIDERS:
        raise problem(404, "There is no such provider.", "没有这个缴费单位。")
    account = billers.normalize_account(provider, account)
    if wrong := billers.check_account(provider, account):
        raise problem(422, wrong[1], wrong[0], "BAD_ACCOUNT")
    throttle(request, [("bill_lookup", user_id, 3600, 120)])
    with Session(engine(request)) as session:
        user = session.get(UserAccount, user_id)
        today = clock.now(session, user_id).date()
        period = today.strftime("%Y-%m")
        saved = session.exec(select(SavedBill).where(SavedBill.user_id == user_id, SavedBill.provider == provider,
                                                     SavedBill.account == account, SavedBill.status == "active")).first()
        history = bool(saved and saved.found_in_history)
        state = billers.bill(session, user_id, provider, account, period, from_history=history)
        mobile = billers.PROVIDERS[provider]["category"] == "mobile"
        holder = None if mobile else (mask_name(user.name) if history and user.name else billers.holder(provider, account))
        return {"provider": billers.provider_view(provider, lang), "account": account, "holder": holder,
                "period": period if state["billed_fen"] is not None and billers.PROVIDERS[provider]["category"] != "fines" else None,
                "billed_fen": state["billed_fen"], "due_fen": state["due_fen"],
                "detail": state["detail"][0 if lang == "zh" else 1] if state["detail"] else None,
                "saved_id": saved.id if saved else None, "autopay": bool(saved and saved.autopay),
                "autopay_limit_fen": saved.autopay_limit_fen if saved else None,
                "next_autopay_on": saved.next_autopay_on if saved else None}


@router.post("/bills/{bill_id}/remove")
async def remove_bill(request: Request, bill_id: str, user_id: str = Depends(require_user)):
    """Takes a bill off My payments, and with it any automatic payment. Past payments stay on the statement."""
    with Session(engine(request)) as session:
        saved = session.get(SavedBill, bill_id)
        if saved is None or saved.user_id != user_id:
            raise problem(404, "No such bill.", "没有这个缴费项目。")
        saved.status = "removed"
        saved.autopay = False
        session.add(saved)
        session.commit()
        return {"ok": True}


# --- QR pay ---


@router.get("/qr/read")
async def qr_read(p: str = Query(max_length=300), lang: Lang = "zh"):
    """What a scanned code says. Only this bank's payment codes are read; anything else is reported as such."""
    found = qr.read(p)
    if found is None:
        return {"valid": False}
    return {"valid": True, "merchant": qr.merchant_view(found["code"], lang), "fen": found["fen"], "order": found["order"]}


@router.get("/qr/merchants")
async def qr_merchants(lang: Lang = "zh"):
    """The demo shops, each with its printed (static) code, for the demo till."""
    return {"items": [{**qr.merchant_view(code, lang), "payload": qr.payload(code)} for code in qr.MERCHANTS]}
