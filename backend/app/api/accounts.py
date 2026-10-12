"""Customer accounts: email/password sign-in with durable, hashed session cookies.

Sign-up also sets the 6-digit transaction PIN and opens the customer's own simulated bank.
"""

import asyncio
import hashlib
import hmac
import re
import secrets
import time
import unicodedata

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, text
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app import clock
from app.agent import audit
from app.api.security import SESSION_COOKIE, hash_private, problem, session_digest, session_user_id
from app.bank.seed import seed_customer
from app.models import RateBucket, UserAccount, UserSession

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32, "maxmem": 64 * 1024 * 1024}
LOGIN_WINDOW = 900

router = APIRouter(prefix="/api")


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=10, max_length=128)


class Registration(Credentials):
    name: str = Field(min_length=2, max_length=60)
    pin: str = Field(pattern=r"^\d{6}$")


class AccountView(BaseModel):
    id: str
    name: str
    email: str
    phone: str
    operator: bool = False
    has_pin: bool = True


class AccountResponse(BaseModel):
    user: AccountView


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **SCRYPT)
    return f"scrypt${SCRYPT['n']}${SCRYPT['r']}${SCRYPT['p']}${salt.hex()}${digest.hex()}"


def verify_password(stored: str, password: str) -> bool:
    try:
        kind, n, r, p, salt, digest = stored.split("$")
        if kind != "scrypt":
            return False
        params = {"n": int(n), "r": int(r), "p": int(p), "dklen": len(digest) // 2, "maxmem": SCRYPT["maxmem"]}
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **params)
    except ValueError:
        return False
    return hmac.compare_digest(actual.hex(), digest)


# Unknown emails still pay for one scrypt, so response time does not reveal which accounts exist.
UNKNOWN_ACCOUNT = hash_password(secrets.token_urlsafe(16))


def weak_pin(pin: str) -> bool:
    return len(set(pin)) == 1 or pin in "0123456789" or pin in "9876543210"


def normalize_email(value: str) -> str:
    email = unicodedata.normalize("NFKC", value).strip().lower()
    if len(email) > 254 or not EMAIL.match(email):
        raise problem(422, "Enter a valid email address.", "请输入有效的邮箱地址。")
    return email


def clean_name(value: str) -> str:
    name = " ".join(unicodedata.normalize("NFKC", value).split())
    if not 2 <= len(name) <= 60 or any(unicodedata.category(c).startswith("C") for c in name):
        raise problem(422, "Use 2–60 characters for your name.", "姓名需为 2–60 个字符。")
    return name


def view(user: UserAccount) -> AccountView:
    return AccountView(id=user.id, name=user.name, email=user.email, operator=user.operator,
                       phone=user.phone[:3] + "****" + user.phone[-4:] if user.phone else "",
                       has_pin=bool(user.pin_hash))


def throttle(request: Request, limits):
    """Durable fixed-window counters. Identities are stored hashed."""
    runtime = request.app.state.runtime
    salt = runtime.settings.ip_hash_salt.get_secret_value() or runtime.fallback_salt
    now = int(time.time())
    with runtime.engine.connect() as conn:
        conn.execute(text("BEGIN IMMEDIATE"))
        try:
            conn.execute(delete(RateBucket).where(RateBucket.expires_at <= now))
            for scope, identity, seconds, limit in limits:
                key = f"{scope}:{now // seconds}:{hash_private(identity, salt)}"
                count = conn.execute(select(RateBucket.count).where(RateBucket.key == key)).scalar_one_or_none() or 0
                if count >= limit:
                    raise problem(429, "Too many attempts. Wait and try again.", "尝试过于频繁，请稍后再试。")
                conn.execute(
                    insert(RateBucket).values(key=key, count=count + 1, expires_at=(now // seconds + 1) * seconds)
                    .on_conflict_do_update(index_elements=["key"], set_={"count": count + 1})
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def device_limits(request: Request, scope: str, seconds: int, limit: int):
    device = request.headers.get("x-device-id", "")
    return [(scope, device, seconds, limit)] if 0 < len(device) <= 64 else []


def end_session(request: Request):
    token = request.cookies.get(SESSION_COOKIE, "")
    if token:
        with Session(request.app.state.runtime.engine) as session:
            session.execute(delete(UserSession).where(UserSession.token_hash == session_digest(token)))
            session.commit()


def start_session(request: Request, response: Response, user_id: str):
    settings = request.app.state.runtime.settings
    end_session(request)  # never keep a session identifier chosen before sign-in
    token = secrets.token_urlsafe(32)
    ttl = settings.session_ttl_hours * 3600
    now = int(time.time())
    with Session(request.app.state.runtime.engine) as session:
        session.execute(delete(UserSession).where(UserSession.expires_at <= now))
        session.add(UserSession(token_hash=session_digest(token), user_id=user_id, expires_at=now + ttl))
        session.commit()
    response.set_cookie(SESSION_COOKIE, token, max_age=ttl, path="/", httponly=True, samesite="strict",
                        secure=settings.public_base_url.startswith("https://"))


@router.post("/register", status_code=201, response_model=AccountResponse)
async def register(request: Request, response: Response, body: Registration):
    throttle(request, [("register-global", "global", 60, 20), *device_limits(request, "register-device", 3600, 10)])
    email, name = normalize_email(body.email), clean_name(body.name)
    if weak_pin(body.pin):
        raise problem(422, "Choose a PIN that is not repeated or sequential digits.", "交易密码不能是重复或连续数字。")
    password_hash, pin_hash = await asyncio.gather(asyncio.to_thread(hash_password, body.password),
                                                   asyncio.to_thread(hash_password, body.pin))
    with Session(request.app.state.runtime.engine) as session:
        user = UserAccount(email=email, name=name, password_hash=password_hash, pin_hash=pin_hash)
        session.add(user)
        try:
            session.flush()
        except IntegrityError:
            raise problem(409, "This email already has an account. Sign in instead.", "该邮箱已注册，请直接登录。") from None
        seed_customer(session, user, clock.now(session, user.id))
        audit.append(session, user.id, "account_opened", {"seeded": True})
        session.commit()
        result = view(user)
    start_session(request, response, result.id)
    return {"user": result}


@router.post("/login", response_model=AccountResponse)
async def login(request: Request, response: Response, body: Credentials):
    email = normalize_email(body.email)
    throttle(request, [("login-global", "global", 60, 120), ("login-email", email, LOGIN_WINDOW, 10),
                       *device_limits(request, "login-device", LOGIN_WINDOW, 30)])
    with Session(request.app.state.runtime.engine) as session:
        user = session.execute(select(UserAccount).where(UserAccount.email == email)).scalar_one_or_none()
        stored = user.password_hash if user else UNKNOWN_ACCOUNT
        result = view(user) if user else None
    if not await asyncio.to_thread(verify_password, stored, body.password) or result is None:
        raise problem(401, "Email or password is incorrect.", "邮箱或密码不正确。")
    start_session(request, response, result.id)
    return {"user": result}


@router.post("/logout")
async def logout(request: Request, response: Response):
    end_session(request)
    settings = request.app.state.runtime.settings
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="strict",
                           secure=settings.public_base_url.startswith("https://"))
    return {"ok": True}


@router.get("/me", response_model=AccountResponse)
async def me(request: Request):
    user_id = session_user_id(request)
    if user_id is None:
        raise problem(401, "Not signed in.", "尚未登录。")
    with Session(request.app.state.runtime.engine) as session:
        user = session.get(UserAccount, user_id)
        if user is None:
            raise problem(401, "Not signed in.", "尚未登录。")
        return {"user": view(user)}
