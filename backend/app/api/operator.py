"""Human takeover. Operators can read, reply, cancel and unlock. They can never approve a step
on a customer's behalf: approval and strong verification stay with the customer."""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app import clock
from app.agent import audit, executor, locks
from app.agent.core import Ctx
from app.agent.executor import PlanError
from app.api.security import problem, require_operator
from app.api.views import message_view, plan_view
from app.models import AuditEntry, Conversation, Message, Plan, SafetyLock, UserAccount

router = APIRouter(prefix="/api/operator", dependencies=[Depends(require_operator)])


class ReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.get("/queue")
async def queue(request: Request):
    with Session(request.app.state.runtime.engine) as session:
        escalated = session.exec(select(Conversation).where(Conversation.escalated.is_(True))).all()
        locked_users = {x.user_id for x in session.exec(select(SafetyLock).where(SafetyLock.cleared_at.is_(None)))}
        items = []
        for conv in escalated:
            user = session.get(UserAccount, conv.user_id)
            items.append({"conversation_id": conv.id, "user": user.name, "email": user.email, "reason": conv.escalated_reason,
                          "locked": conv.user_id in locked_users})
        for user_id in locked_users - {c.user_id for c in escalated}:
            user = session.get(UserAccount, user_id)
            conv = session.exec(select(Conversation).where(Conversation.user_id == user_id)
                                .order_by(Conversation.created_at.desc()).limit(1)).first()
            if conv:
                items.append({"conversation_id": conv.id, "user": user.name, "email": user.email, "reason": "safety lock",
                              "locked": True})
        return {"items": items}


def conversation(session: Session, conversation_id: str) -> Conversation:
    conv = session.get(Conversation, conversation_id)
    if conv is None:
        raise problem(404, "Conversation not found.", "未找到该会话。")
    return conv


@router.get("/conversations/{conversation_id}")
async def detail(request: Request, conversation_id: str):
    with Session(request.app.state.runtime.engine) as session:
        conv = conversation(session, conversation_id)
        user = session.get(UserAccount, conv.user_id)
        ctx = Ctx(session=session, user=user, now=clock.now(session, user.id), lang="zh")
        messages = session.exec(select(Message).where(Message.conversation_id == conv.id).order_by(Message.at)).all()
        plans = session.exec(select(Plan).where(Plan.conversation_id == conv.id).order_by(Plan.created_at.desc()).limit(10)).all()
        trail = session.exec(select(AuditEntry).where(AuditEntry.user_id == user.id).order_by(AuditEntry.seq.desc()).limit(60)).all()
        return {"conversation_id": conv.id, "escalated": conv.escalated, "user": {"name": user.name, "email": user.email},
                "messages": [message_view(m) for m in messages], "plans": [plan_view(p, ctx) for p in plans],
                "locks": [{"scope": x.scope, "reason": x.reason, "since": x.at} for x in locks.active(session, user.id)],
                "audit": [{"seq": e.seq, "kind": e.kind, "plan_id": e.plan_id, "data": e.data, "at": e.at} for e in trail]}


@router.post("/conversations/{conversation_id}/reply")
async def reply(request: Request, conversation_id: str, body: ReplyIn):
    with Session(request.app.state.runtime.engine) as session:
        conv = conversation(session, conversation_id)
        message = Message(conversation_id=conv.id, user_id=conv.user_id, role="operator", text=body.text)
        session.add(message)
        audit.append(session, conv.user_id, "operator", {"event": "reply", "length": len(body.text)})
        session.commit()
        return message_view(message)


@router.post("/conversations/{conversation_id}/release")
async def release(request: Request, conversation_id: str):
    with Session(request.app.state.runtime.engine) as session:
        conv = conversation(session, conversation_id)
        conv.escalated = False
        session.add(conv)
        session.add(Message(conversation_id=conv.id, user_id=conv.user_id, role="system",
                            text="人工客服已结束服务，助手重新为您服务。 / The operator has handed you back to the assistant."))
        audit.append(session, conv.user_id, "operator", {"event": "released"})
        session.commit()
        return {"ok": True}


@router.post("/plans/{plan_id}/cancel")
async def cancel_plan(request: Request, plan_id: str):
    with Session(request.app.state.runtime.engine) as session:
        plan = session.get(Plan, plan_id)
        if plan is None:
            raise problem(404, "Plan not found.", "未找到该计划。")
        user = session.get(UserAccount, plan.user_id)
        ctx = Ctx(session=session, user=user, now=clock.now(session, user.id), lang=plan.lang, plan=plan)
        try:
            plan = executor.cancel(ctx, plan, rollback=False)
        except PlanError as exc:
            raise problem(exc.status, exc.en, exc.zh, exc.code) from None
        audit.append(session, user.id, "operator", {"event": "cancelled_plan"}, plan.id)
        session.commit()
        return plan_view(plan, ctx)


@router.post("/users/{conversation_id}/unlock")
async def unlock(request: Request, conversation_id: str):
    with Session(request.app.state.runtime.engine) as session:
        conv = conversation(session, conversation_id)
        cleared = locks.clear(session, conv.user_id, by="operator")
        session.commit()
        return {"cleared": cleared}
