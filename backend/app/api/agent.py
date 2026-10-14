"""Chat, plans, approvals and strong verification."""

from types import SimpleNamespace
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from app import clock
from app.agent import audit, executor, service, verify
from app.agent.actions import REGISTRY
from app.agent.core import Ctx
from app.agent.executor import PlanError
from app.agent.verify import VerifyError
from app.api.security import problem, require_user
from app.api.views import message_view, plan_view
from app.models import Conversation, Message, Plan, UserAccount

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    conversation_id: str | None = Field(default=None, max_length=36)
    lang: Literal["zh", "en"] = "zh"
    attachment_id: str | None = Field(default=None, max_length=36)


class ApproveIn(BaseModel):
    approval_hash: str = Field(min_length=64, max_length=64)
    lang: Literal["zh", "en"] = "zh"


class VerifyIn(ApproveIn):
    pin: str = Field(pattern=r"^\d{6}$")
    method: Literal["sms", "passkey"]
    challenge_id: str | None = Field(default=None, max_length=36)
    code: str | None = Field(default=None, max_length=8)
    credential: dict | None = None
    new_password: str | None = Field(default=None, min_length=10, max_length=128)
    new_pin: str | None = Field(default=None, pattern=r"^\d{6}$")


class CancelIn(BaseModel):
    rollback: bool = False
    lang: Literal["zh", "en"] = "zh"


class AnswerIn(BaseModel):
    value: str | int | float | list[int]
    lang: Literal["zh", "en"] = "zh"


class EditIn(BaseModel):
    step_id: str = Field(pattern=r"^s\d{1,2}$")
    args: dict
    lang: Literal["zh", "en"] = "zh"


def runtime(request: Request):
    return request.app.state.runtime


def load(session: Session, user_id: str, plan_id: str) -> tuple[UserAccount, Plan]:
    user = session.get(UserAccount, user_id)
    plan = session.get(Plan, plan_id)
    if plan is None or plan.user_id != user_id:
        raise problem(404, "Plan not found.", "未找到该计划。")
    return user, plan


def context(session: Session, user: UserAccount, plan: Plan | None, lang: str, **services) -> Ctx:
    return Ctx(session=session, user=user, now=clock.now(session, user.id), lang=lang, plan=plan,
               services=SimpleNamespace(**services) if services else None)


def respond(session: Session, ctx: Ctx, plan: Plan) -> dict:
    conversation = session.get(Conversation, plan.conversation_id)
    message = service.reply_for_plan(session, ctx, conversation, plan)
    session.commit()
    return {"plan": plan_view(plan, ctx), "messages": [message_view(message)]}


def plan_error(exc: PlanError | VerifyError):
    return problem(exc.status, exc.en, exc.zh, exc.code)


@router.post("/chat")
async def chat(request: Request, body: ChatIn, user_id: str = Depends(require_user)):
    with Session(runtime(request).engine) as session:
        user = session.get(UserAccount, user_id)
        conversation, messages, plan = await service.handle(
            session, user, runtime(request).planner, body.message, conversation_id=body.conversation_id, lang=body.lang,
            attachment_id=body.attachment_id)
        ctx = context(session, user, plan, messages[-1].lang if messages else body.lang)
        return {"conversation_id": conversation.id, "escalated": conversation.escalated,
                "messages": [message_view(m) for m in messages],
                "plan": plan_view(plan, ctx) if plan else None}


@router.get("/conversation")
async def conversation(request: Request, conversation_id: str | None = None, user_id: str = Depends(require_user)):
    with Session(runtime(request).engine) as session:
        user = session.get(UserAccount, user_id)
        conv = service.conversation_for(session, user, conversation_id)
        session.commit()
        rows = session.exec(select(Message).where(Message.conversation_id == conv.id)
                            .order_by(Message.at.desc()).limit(100)).all()
        return {"conversation_id": conv.id, "escalated": conv.escalated,
                "messages": [message_view(m) for m in reversed(rows)]}


@router.get("/conversations")
async def conversations(request: Request, user_id: str = Depends(require_user)):
    """The customer's chats, most recent first, each titled by the first thing they asked."""
    with Session(runtime(request).engine) as session:
        stats = {cid: (count, last) for cid, count, last in session.exec(
            select(Message.conversation_id, func.count(Message.id), func.max(Message.at))
            .where(Message.user_id == user_id).group_by(Message.conversation_id))}
        items = []
        for conv in session.exec(select(Conversation).where(Conversation.user_id == user_id, Conversation.hidden.is_not(True))):
            if conv.id not in stats:
                continue  # a chat opened but never used
            first = session.exec(select(Message.text).where(Message.conversation_id == conv.id, Message.role == "user")
                                 .order_by(Message.at).limit(1)).first()
            count, last = stats[conv.id]
            items.append({"id": conv.id, "title": (first or "")[:60], "updated_at": last, "messages": count,
                          "escalated": conv.escalated})
        items.sort(key=lambda item: item["updated_at"], reverse=True)
        return {"items": items[:100]}


@router.post("/conversations/{conversation_id}/hide")
async def hide_conversation(request: Request, conversation_id: str, user_id: str = Depends(require_user)):
    """Takes a chat off the list. Nothing is deleted: plans and the audit log still point at it."""
    with Session(runtime(request).engine) as session:
        conv = session.get(Conversation, conversation_id)
        if conv is None or conv.user_id != user_id:
            raise problem(404, "No such conversation.", "没有这个对话。")
        conv.hidden = True
        session.add(conv)
        session.commit()
        return {"ok": True}


@router.post("/conversation/new")
async def new_conversation(request: Request, user_id: str = Depends(require_user)):
    with Session(runtime(request).engine) as session:
        conv = Conversation(user_id=user_id)
        session.add(conv)
        session.commit()
        return {"conversation_id": conv.id, "escalated": False, "messages": []}


@router.get("/plans/{plan_id}")
async def get_plan(request: Request, plan_id: str, lang: Literal["zh", "en"] = "zh", user_id: str = Depends(require_user)):
    with Session(runtime(request).engine) as session:
        user, plan = load(session, user_id, plan_id)
        return plan_view(plan, context(session, user, plan, lang))


@router.post("/plans/{plan_id}/approve")
async def approve(request: Request, plan_id: str, body: ApproveIn, user_id: str = Depends(require_user)):
    with Session(runtime(request).engine) as session:
        user, plan = load(session, user_id, plan_id)
        ctx = context(session, user, plan, body.lang)
        try:
            plan = executor.approve(ctx, plan, body.approval_hash, verified=False, method="confirm")
        except PlanError as exc:
            raise plan_error(exc) from None
        return respond(session, ctx, plan)


def summary(ctx: Ctx, plan: Plan) -> tuple[str, str]:
    zh_ctx = Ctx(session=ctx.session, user=ctx.user, now=ctx.now, lang="zh", plan=plan)
    en_ctx = Ctx(session=ctx.session, user=ctx.user, now=ctx.now, lang="en", plan=plan)
    pending = [s for s in plan.steps if s.get("status") == "pending"]
    return (shorten("；".join(REGISTRY[s["action"]].describe(zh_ctx, s["resolved"]) for s in pending), 120),
            shorten("; ".join(REGISTRY[s["action"]].describe(en_ctx, s["resolved"]) for s in pending), 160))


def shorten(text: str, limit: int) -> str:
    """An SMS has room for the gist: cut at the limit and say so, rather than mid-word."""
    return text if len(text) <= limit else text[:limit - 1].rstrip(" ,，；;（(") + "…"


@router.post("/plans/{plan_id}/sms")
async def plan_sms(request: Request, plan_id: str, user_id: str = Depends(require_user)):
    with Session(runtime(request).engine) as session:
        user, plan = load(session, user_id, plan_id)
        if plan.status != "awaiting_approval" or plan.tier != "red":
            raise problem(409, "This plan does not need a code.", "该计划不需要验证码。")
        zh, en = summary(context(session, user, plan, "zh"), plan)
        challenge = verify.send_sms(session, user, plan_id=plan.id, purpose="plan", summary_zh=zh, summary_en=en)
        session.commit()
        return {"challenge_id": challenge.id, "phone": user.phone[:3] + "****" + user.phone[-4:], "expires_in": verify.CODE_SECONDS}


@router.post("/plans/{plan_id}/passkey-options")
async def plan_passkey_options(request: Request, plan_id: str, user_id: str = Depends(require_user)):
    with Session(runtime(request).engine) as session:
        user, plan = load(session, user_id, plan_id)
        try:
            options = verify.passkey_auth_options(session, user, runtime(request).settings, plan_id=plan.id, purpose="plan")
        except VerifyError as exc:
            raise plan_error(exc) from None
        session.commit()
        return options


@router.post("/plans/{plan_id}/verify")
async def plan_verify(request: Request, plan_id: str, body: VerifyIn, user_id: str = Depends(require_user)):
    settings = runtime(request).settings
    with Session(runtime(request).engine) as session:
        user, plan = load(session, user_id, plan_id)
        if plan.status != "awaiting_approval":
            raise problem(409, "This plan is not waiting for approval.", "该计划不在待确认状态。", "NOT_AWAITING")
        try:
            verify.check_pin(session, user, body.pin, plan.id)
            if body.method == "sms":
                verify.check_sms(session, user, body.challenge_id, body.code, plan_id=plan.id, purpose="plan")
            else:
                verify.check_passkey(session, user, settings, body.credential, plan_id=plan.id, purpose="plan")
        except VerifyError as exc:
            raise plan_error(exc) from None
        audit.append(session, user.id, "verified", {"method": body.method}, plan.id)
        secrets = {k: v for k, v in (("new_password", body.new_password), ("new_pin", body.new_pin)) if v}
        ctx = context(session, user, plan, body.lang, secrets=secrets, session_hash=request.scope.get("session_hash"))
        try:
            plan = executor.approve(ctx, plan, body.approval_hash, verified=True, method=body.method)
        except PlanError as exc:
            raise plan_error(exc) from None
        return respond(session, ctx, plan)


@router.post("/plans/{plan_id}/cancel")
async def cancel(request: Request, plan_id: str, body: CancelIn, user_id: str = Depends(require_user)):
    with Session(runtime(request).engine) as session:
        user, plan = load(session, user_id, plan_id)
        ctx = context(session, user, plan, body.lang)
        try:
            plan = executor.cancel(ctx, plan, rollback=body.rollback)
        except PlanError as exc:
            raise plan_error(exc) from None
        return respond(session, ctx, plan)


@router.post("/plans/{plan_id}/answer")
async def answer(request: Request, plan_id: str, body: AnswerIn, user_id: str = Depends(require_user)):
    with Session(runtime(request).engine) as session:
        user, plan = load(session, user_id, plan_id)
        ctx = context(session, user, plan, body.lang)
        try:
            plan = executor.answer(ctx, plan, body.value)
        except PlanError as exc:
            raise plan_error(exc) from None
        return respond(session, ctx, plan)


@router.post("/plans/{plan_id}/edit")
async def edit(request: Request, plan_id: str, body: EditIn, user_id: str = Depends(require_user)):
    with Session(runtime(request).engine) as session:
        user, plan = load(session, user_id, plan_id)
        ctx = context(session, user, plan, body.lang)
        try:
            plan = executor.edit(ctx, plan, body.step_id, body.args)
        except PlanError as exc:
            raise plan_error(exc) from None
        return respond(session, ctx, plan)
