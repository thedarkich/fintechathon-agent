"""Strong verification for red steps: transaction PIN plus an SMS code or a passkey.

PINs and codes arrive at their own endpoints, are compared in constant time and are never
logged. Failures count towards the safety lock.
"""

import hashlib
import hmac
import json
import secrets
import time
from urllib.parse import urlparse

import webauthn
from sqlmodel import Session, select
from webauthn.helpers import bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.agent import audit, locks
from app.models import Challenge, Passkey, SmsMessage, UserAccount

CODE_SECONDS = 300
MAX_ATTEMPTS = 3


class VerifyError(Exception):
    def __init__(self, status: int, code: str, en: str, zh: str):
        super().__init__(en)
        self.status, self.code, self.en, self.zh = status, code, en, zh


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def failed(session: Session, user_id: str, what: str, plan_id: str | None) -> None:
    audit.append(session, user_id, "verification_failed", {"factor": what}, plan_id)
    locks.evaluate(session, user_id)
    session.commit()


def check_pin(session: Session, user: UserAccount, pin: str | None, plan_id: str | None) -> None:
    from app.api.accounts import verify_password

    if not user.pin_hash:
        raise VerifyError(409, "NO_PIN", "Set a transaction PIN first.", "请先设置交易密码。")
    if not pin or not (len(pin) == 6 and pin.isdigit()) or not verify_password(user.pin_hash, pin):
        failed(session, user.id, "pin", plan_id)
        raise VerifyError(401, "BAD_PIN", "The PIN is incorrect.", "交易密码不正确。")


def send_sms(session: Session, user: UserAccount, *, plan_id: str | None, purpose: str, summary_zh: str,
             summary_en: str) -> Challenge:
    code = f"{secrets.randbelow(10**6):06d}"
    challenge = Challenge(user_id=user.id, plan_id=plan_id, purpose=purpose, kind="sms", code_hash=digest(code),
                          expires_at=int(time.time()) + CODE_SECONDS)
    session.add(challenge)
    session.add(SmsMessage(
        user_id=user.id,
        text=f"【中联银行】验证码 {code}，用于：{summary_zh}。5 分钟内有效。请勿告诉任何人，银行工作人员不会向您索要验证码。",
        text_en=f"[Central Union Bank] Code {code} for: {summary_en}. Valid for 5 minutes. Never share it; bank staff will never ask for it.",
    ))
    audit.append(session, user.id, "challenge_sent", {"kind": "sms", "purpose": purpose,
                                                      "phone": user.phone[:3] + "****" + user.phone[-4:]}, plan_id)
    session.flush()
    return challenge


def check_sms(session: Session, user: UserAccount, challenge_id: str | None, code: str | None, *,
              plan_id: str | None, purpose: str) -> None:
    challenge = session.get(Challenge, challenge_id) if challenge_id else None
    if (challenge is None or challenge.user_id != user.id or challenge.kind != "sms" or challenge.used
            or challenge.purpose != purpose or challenge.plan_id != plan_id):
        raise VerifyError(400, "NO_CHALLENGE", "Request a new code.", "请重新获取验证码。")
    if challenge.expires_at < time.time() or challenge.attempts >= MAX_ATTEMPTS:
        raise VerifyError(400, "CODE_EXPIRED", "The code expired. Request a new one.", "验证码已失效，请重新获取。")
    challenge.attempts += 1
    session.add(challenge)
    if not code or not hmac.compare_digest(digest(code.strip()), challenge.code_hash or ""):
        failed(session, user.id, "sms", plan_id)
        raise VerifyError(401, "BAD_CODE", "The code is incorrect.", "验证码不正确。")
    challenge.used = True
    session.add(challenge)


# --- passkeys (WebAuthn) ---


def origin_and_rp(settings) -> tuple[str, str]:
    origin = settings.public_base_url.rstrip("/")
    return origin, settings.passkey_rp_id or urlparse(origin).hostname or "localhost"


def passkey_registration_options(session: Session, user: UserAccount, settings) -> dict:
    _, rp_id = origin_and_rp(settings)
    existing = session.exec(select(Passkey).where(Passkey.user_id == user.id)).all()
    options = webauthn.generate_registration_options(
        rp_id=rp_id, rp_name="Central Union Bank", user_name=user.email, user_id=user.id.encode(),
        user_display_name=user.name,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED, user_verification=UserVerificationRequirement.REQUIRED),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=webauthn.base64url_to_bytes(p.id)) for p in existing],
    )
    session.add(Challenge(user_id=user.id, purpose="passkey_register", kind="passkey",
                          payload={"challenge": bytes_to_base64url(options.challenge)},
                          expires_at=int(time.time()) + CODE_SECONDS))
    return json.loads(webauthn.options_to_json(options))


def latest_challenge(session: Session, user_id: str, purpose: str, plan_id: str | None) -> Challenge:
    challenge = session.exec(
        select(Challenge).where(Challenge.user_id == user_id, Challenge.purpose == purpose, Challenge.kind == "passkey",
                                Challenge.used.is_(False), Challenge.plan_id == plan_id)
        .order_by(Challenge.created_at.desc()).limit(1)
    ).first()
    if challenge is None or challenge.expires_at < time.time():
        raise VerifyError(400, "NO_CHALLENGE", "Start the passkey check again.", "请重新发起通行密钥验证。")
    return challenge


def passkey_register(session: Session, user: UserAccount, settings, credential: dict, label: str) -> Passkey:
    origin, rp_id = origin_and_rp(settings)
    challenge = latest_challenge(session, user.id, "passkey_register", None)
    challenge.used = True
    session.add(challenge)
    try:
        verified = webauthn.verify_registration_response(
            credential=credential, expected_challenge=webauthn.base64url_to_bytes(challenge.payload["challenge"]),
            expected_rp_id=rp_id, expected_origin=origin, require_user_verification=True)
    except Exception:
        raise VerifyError(400, "PASSKEY_REJECTED", "The passkey could not be registered.", "通行密钥注册失败。") from None
    passkey = Passkey(id=bytes_to_base64url(verified.credential_id), user_id=user.id,
                      public_key=bytes_to_base64url(verified.credential_public_key),
                      sign_count=verified.sign_count, label=label[:40])
    session.add(passkey)
    audit.append(session, user.id, "passkey_added", {"label": passkey.label})
    return passkey


def passkey_auth_options(session: Session, user: UserAccount, settings, *, plan_id: str | None, purpose: str) -> dict:
    _, rp_id = origin_and_rp(settings)
    keys = session.exec(select(Passkey).where(Passkey.user_id == user.id)).all()
    if not keys:
        raise VerifyError(409, "NO_PASSKEY", "No passkey is set up on this account.", "该账户尚未设置通行密钥。")
    options = webauthn.generate_authentication_options(
        rp_id=rp_id, allow_credentials=[PublicKeyCredentialDescriptor(id=webauthn.base64url_to_bytes(k.id)) for k in keys],
        user_verification=UserVerificationRequirement.REQUIRED)
    session.add(Challenge(user_id=user.id, plan_id=plan_id, purpose=purpose, kind="passkey",
                          payload={"challenge": bytes_to_base64url(options.challenge)},
                          expires_at=int(time.time()) + CODE_SECONDS))
    return json.loads(webauthn.options_to_json(options))


def check_passkey(session: Session, user: UserAccount, settings, credential: dict | None, *, plan_id: str | None,
                  purpose: str) -> None:
    origin, rp_id = origin_and_rp(settings)
    challenge = latest_challenge(session, user.id, purpose, plan_id)
    challenge.used = True
    session.add(challenge)
    key = session.get(Passkey, str((credential or {}).get("id", "")))
    if key is None or key.user_id != user.id:
        failed(session, user.id, "passkey", plan_id)
        raise VerifyError(401, "PASSKEY_UNKNOWN", "That passkey is not registered here.", "该通行密钥未在此账户注册。")
    try:
        verified = webauthn.verify_authentication_response(
            credential=credential, expected_challenge=webauthn.base64url_to_bytes(challenge.payload["challenge"]),
            expected_rp_id=rp_id, expected_origin=origin,
            credential_public_key=webauthn.base64url_to_bytes(key.public_key),
            credential_current_sign_count=key.sign_count, require_user_verification=True)
    except Exception:
        failed(session, user.id, "passkey", plan_id)
        raise VerifyError(401, "PASSKEY_REJECTED", "The passkey check failed.", "通行密钥验证失败。") from None
    key.sign_count = verified.new_sign_count
    session.add(key)
