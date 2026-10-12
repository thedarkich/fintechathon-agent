"""Demo tools for the customer's own simulated bank: move the clock forward, or start over."""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlmodel import Session

from app import clock
from app.agent import audit, scheduler
from app.api.security import problem, require_user
from app.bank.seed import reset_customer, seed_customer
from app.models import UserAccount

router = APIRouter(prefix="/api/demo", dependencies=[Depends(require_user)])


class AdvanceIn(BaseModel):
    days: int = Field(default=0, ge=0, le=60)
    hours: int = Field(default=0, ge=0, le=48)
    lang: str = Field(default="zh", pattern="^(zh|en)$")


def enabled(request: Request):
    if not request.app.state.runtime.settings.demo_tools_enabled:
        raise problem(403, "Demo tools are turned off.", "演示工具已关闭。")


@router.get("/clock")
async def demo_clock(request: Request, user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        return {"now": clock.iso(clock.now(session, user_id)), "offset_seconds": clock.offset(session, user_id)}


@router.post("/advance")
async def advance(request: Request, body: AdvanceIn, user_id: str = Depends(require_user)):
    enabled(request)
    seconds = body.days * 86400 + body.hours * 3600
    with Session(request.app.state.runtime.engine) as session:
        clock.advance(session, user_id, seconds)
        audit.append(session, user_id, "demo_clock", {"advanced_seconds": seconds})
        session.commit()
        user = session.get(UserAccount, user_id)
        scheduler.tick(session, user, body.lang)
        return {"now": clock.iso(clock.now(session, user_id)), "offset_seconds": clock.offset(session, user_id)}


@router.post("/reset")
async def reset(request: Request, user_id: str = Depends(require_user)):
    enabled(request)
    with Session(request.app.state.runtime.engine) as session:
        user = session.get(UserAccount, user_id)
        reset_customer(session, user_id)
        session.flush()
        seed_customer(session, user, clock.now(session, user_id))
        audit.append(session, user_id, "demo_reset", {})
        session.commit()
        return {"ok": True, "now": clock.iso(clock.now(session, user_id))}
