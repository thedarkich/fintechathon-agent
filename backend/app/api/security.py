import asyncio
import base64
import hashlib
import hmac
import re
import time
from pathlib import Path
from urllib.parse import urlparse

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlmodel import Session
from starlette.responses import JSONResponse

from app.models import UserAccount, UserSession

SESSION_COOKIE = "bank_agent_session"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
MAX_BODY = 6 * 1024 * 1024


def problem(status, en, zh, code: str | None = None):
    detail = {"message_en": en, "message_zh": zh}
    if code:
        detail["code"] = code
    return HTTPException(status_code=status, detail=detail)


def has_admin_token(request: Request):
    expected = request.app.state.runtime.settings.admin_token.get_secret_value()
    scheme, _, supplied = request.headers.get("authorization", "").partition(" ")
    return bool(expected and scheme.lower() == "bearer" and hmac.compare_digest(supplied.encode(), expected.encode()))


def session_digest(token: str):
    return hashlib.sha256(token.encode()).hexdigest()


def session_user_id(request: Request) -> str | None:
    """The signed-in customer for this request's session cookie, or None. Looked up once per request."""
    if "session_user_id" not in request.scope:
        token = request.cookies.get(SESSION_COOKIE, "")
        user_id = None
        if 20 <= len(token) <= 128:
            with Session(request.app.state.runtime.engine) as session:
                user_id = session.execute(
                    select(UserSession.user_id).where(UserSession.token_hash == session_digest(token),
                                                      UserSession.expires_at > int(time.time()))
                ).scalar_one_or_none()
        request.scope["session_user_id"] = user_id
        request.scope["session_hash"] = session_digest(token) if user_id else None
    return request.scope["session_user_id"]


def same_origin(request: Request):
    """Cookie-authorized writes must come from this site (SameSite=Strict is the first line)."""
    origin = urlparse(request.headers.get("origin", ""))
    allowed = {request.url.netloc, urlparse(request.app.state.runtime.settings.public_base_url).netloc}
    return origin.scheme in {"http", "https"} and origin.netloc in allowed - {""}


def refuse_other_sites(request: Request):
    """Public account routes (sign-in, sign-up, demo, sign-out): a browser posting from another site's page is refused.
    Security best practice (login CSRF); scripts that send no Origin header are unaffected."""
    if request.headers.get("origin") is not None and not same_origin(request):
        raise problem(403, "Cross-site request refused.", "已拒绝跨站请求。", "CROSS_SITE")


def page_policy(static_dir: Path) -> str:
    """Content-Security-Policy for the app shell (security best practice: script injection can't run). Only this
    site's files run, plus the inline scripts index.html ships, allowed by their SHA-256 hashes."""
    hashes = []
    index = static_dir / "index.html"
    if index.is_file():
        for body in re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", index.read_text(encoding="utf-8"), re.S):
            hashes.append("'sha256-" + base64.b64encode(hashlib.sha256(body.encode()).digest()).decode() + "'")
    return "; ".join([
        "default-src 'self'",
        "script-src " + " ".join(["'self'", *hashes]),
        "style-src 'self' 'unsafe-inline'",  # React sets style attributes
        "img-src 'self' data: blob:",  # receipt previews are blob: URLs
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ])


def require_user(request: Request) -> str:
    user_id = session_user_id(request)
    if user_id is None:
        raise problem(401, "Sign in first.", "请先登录。", "NOT_SIGNED_IN")
    if request.method not in SAFE_METHODS and not same_origin(request):
        raise problem(403, "Cross-site request refused.", "已拒绝跨站请求。", "CROSS_SITE")
    return user_id


def require_operator(request: Request) -> str:
    """Bank operators: the admin token, or an account marked as operator."""
    if has_admin_token(request):
        return "admin-token"
    user_id = require_user(request)
    with Session(request.app.state.runtime.engine) as session:
        user = session.get(UserAccount, user_id)
        if user is None or not user.operator:
            raise problem(403, "Operators only.", "仅限银行工作人员。", "NOT_OPERATOR")
    return user_id


def hash_private(value, salt):
    return hmac.new(salt.encode(), value.encode(), hashlib.sha256).hexdigest()


class RequestBoundary:
    """Bound request body size and time, and concurrent writes, before parsing."""

    def __init__(self, app, *, body_timeout=15, max_inflight=16):
        self.app = app
        self.body_timeout = body_timeout
        self.max_inflight = max_inflight
        self.inflight = 0
        self.policy = (None, "")  # (index.html modification time, policy), rebuilt when the page is rebuilt

    def page_policy(self, scope) -> str:
        static_dir = scope["app"].state.runtime.settings.static_dir
        index = static_dir / "index.html"
        stamp = index.stat().st_mtime if index.is_file() else None
        if self.policy[0] != stamp or not self.policy[1]:
            self.policy = (stamp, page_policy(static_dir))
        return self.policy[1]

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def secured_send(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).extend(
                    [(b"x-content-type-options", b"nosniff"), (b"referrer-policy", b"no-referrer")]
                )
                if scope["path"].startswith("/api/"):
                    message["headers"].append((b"cache-control", b"no-store"))
                elif "app" in scope and hasattr(scope["app"].state, "runtime"):
                    message["headers"].append((b"content-security-policy", self.page_policy(scope).encode()))
            await send(message)

        async def reject(status, en, zh):
            response = JSONResponse({"message_en": en, "message_zh": zh}, status_code=status)
            await response(scope, receive, secured_send)

        if scope["method"] not in {"POST", "PUT", "PATCH", "DELETE"}:
            return await self.app(scope, receive, secured_send)
        if self.inflight >= self.max_inflight:
            return await reject(503, "The service is busy. Try again shortly.", "服务繁忙，请稍后再试。")
        self.inflight += 1
        try:
            content = bytearray()
            try:
                async with asyncio.timeout(self.body_timeout):
                    while True:
                        part = await receive()
                        if part["type"] == "http.disconnect":
                            return
                        chunk = part.get("body", b"")
                        if len(content) + len(chunk) > MAX_BODY:
                            return await reject(413, "The request is too large.", "请求内容过大。")
                        content.extend(chunk)
                        if not part.get("more_body", False):
                            break
            except TimeoutError:
                return await reject(408, "The request timed out. Try again.", "请求超时，请重试。")
            consumed = False
            original = receive

            async def replay():
                nonlocal consumed
                if not consumed:
                    consumed = True
                    return {"type": "http.request", "body": bytes(content), "more_body": False}
                return await original()

            await self.app(scope, replay, secured_send)
        finally:
            self.inflight -= 1
