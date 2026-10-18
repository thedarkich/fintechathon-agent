"""The app's own screens: transfer by phone number.

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
from app.bank import directory, transfers
from app.models import Payee, UserAccount

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
Lang = Literal["zh", "en"]


def engine(request: Request):
    return request.app.state.runtime.engine


class ScreenPlanIn(BaseModel):
    action: Literal["transfer", "phone_transfer"]
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
    """Who a number belongs to: a saved payee, someone in the phone directory (masked name), or nobody."""
    throttle(request, [("directory", user_id, 3600, 60)])  # a lookup is not a way to list strangers' names
    with Session(engine(request)) as session:
        user = session.get(UserAccount, user_id)
        if user.phone and phone == user.phone:
            return {"kind": "self"}
        saved = session.exec(select(Payee).where(Payee.user_id == user_id, Payee.phone == phone)).first()
        zh = lang == "zh"
        if saved:
            return {"kind": "payee", "payee": {"id": saved.id, "name": saved.name if zh else (saved.name_en or saved.name),
                                               "note": saved.note if zh else transfers.note_en(saved.note),
                                               "bank": saved.bank if zh else transfers.bank_en(saved.bank),
                                               "account_tail": saved.account_no[-4:]}}
        found = directory.lookup(phone)
        if found is None:
            return {"kind": "none"}
        return {"kind": "directory", "name": found["masked"], "bank": found["bank"] if zh else transfers.bank_en(found["bank"]),
                "same_bank": found["bank"] == transfers.OWN_BANK}

