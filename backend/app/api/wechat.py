"""The WeChat assistant channel (simulated).

Two sides, kept apart on purpose:
- the bank app (the signed-in session): link a chat account with the transaction PIN, see the link, unlink it;
- the channel (only its own token, the stand-in for the chat app's signed callback): send a message, get the replies.
The channel's token can't reach any other route: plans are approved and verified in the app alone, so a chat account
in the wrong hands can ask, but never move money.
"""

import secrets
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.agent import audit, locks, service, verify
from app.agent.verify import VerifyError
from app.api.accounts import throttle
from app.api.security import problem, require_user
from app.channels import wechat
from app.models import ChannelLink, UserAccount, now_iso

app_side = APIRouter(prefix="/api/wechat", dependencies=[Depends(require_user)])
channel_side = APIRouter(prefix="/api/channels/wechat")


class LinkIn(BaseModel):
    pin: str = Field(pattern=r"^\d{6}$")


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    lang: Literal["zh", "en"] = "zh"


def active_link(session: Session, user_id: str) -> ChannelLink | None:
    return session.exec(select(ChannelLink).where(ChannelLink.user_id == user_id, ChannelLink.revoked_at.is_(None))).first()


def link_view(link: ChannelLink | None) -> dict:
    if link is None:
        return {"linked": False}
    return {"linked": True, "openid": link.openid[:4] + "****" + link.openid[-4:], "linked_at": link.created_at}


@app_side.get("/link")
async def link_status(request: Request, user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        return link_view(active_link(session, user_id))


@app_side.post("/link")
async def link(request: Request, body: LinkIn, user_id: str = Depends(require_user)):
    """Linking gives a chat account the right to ask about this bank account, so it takes the transaction PIN. A wrong
    PIN counts towards the safety lock like any other; while that lock is on, nothing can be linked."""
    with Session(request.app.state.runtime.engine) as session:
        user = session.get(UserAccount, user_id)
        if any(lock.scope in ("red", "agent") for lock in locks.active(session, user_id)):
            raise problem(423, "The safety lock is on: nothing can be linked until it's lifted.",
                          "安全锁已开启，解除前不能绑定。", "LOCKED")
        try:
            verify.check_pin(session, user, body.pin, None)
        except VerifyError as exc:
            raise problem(exc.status, exc.en, exc.zh, exc.code) from None
        for old in session.exec(select(ChannelLink).where(ChannelLink.user_id == user_id, ChannelLink.revoked_at.is_(None))):
            old.revoked_at = now_iso()
            session.add(old)
        token = secrets.token_urlsafe(32)
        link = ChannelLink(user_id=user_id, openid="o" + secrets.token_hex(12), token_hash=verify.digest(token))
        session.add(link)
        audit.append(session, user_id, "channel_linked", {"channel": "wechat", "openid": link_view(link)["openid"]})
        session.commit()
        # the token is shown once, to the simulated chat app; the bank keeps only its hash
        return {**link_view(link), "token": token}


@app_side.post("/unlink")
async def unlink(request: Request, user_id: str = Depends(require_user)):
    with Session(request.app.state.runtime.engine) as session:
        removed = 0
        for link in session.exec(select(ChannelLink).where(ChannelLink.user_id == user_id, ChannelLink.revoked_at.is_(None))):
            link.revoked_at = now_iso()
            session.add(link)
            removed += 1
        if removed:
            audit.append(session, user_id, "channel_unlinked", {"channel": "wechat"})
        session.commit()
        return {"linked": False}


def channel_link(request: Request, session: Session) -> ChannelLink:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    link = None
    if scheme.lower() == "bearer" and 20 <= len(token) <= 128:
        link = session.exec(select(ChannelLink).where(ChannelLink.token_hash == verify.digest(token),
                                                      ChannelLink.revoked_at.is_(None))).first()
    if link is None:
        raise problem(401, "This chat account isn't linked to a bank account. Link it in the bank app first.",
                      "这个微信还没有绑定银行账户，请先在银行 App 里绑定。", "NOT_LINKED")
    return link


@channel_side.post("/message")
async def message(request: Request, body: MessageIn):
    runtime = request.app.state.runtime
    with Session(runtime.engine) as session:
        link = channel_link(request, session)
        throttle(request, [("wechat-message", link.id, 60, 20)])
        user = session.get(UserAccount, link.user_id)
        conversation = service.screens_conversation(session, user, "wechat")
        _, messages, _ = await service.handle(session, user, runtime.planner, body.text, conversation_id=conversation.id,
                                              lang=body.lang, channel="wechat")
        lang = next((m.lang for m in reversed(messages) if m.role != "user"), body.lang)
        return {"replies": wechat.replies(messages, lang)}
