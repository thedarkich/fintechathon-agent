"""Safety lock (circuit breaker). Triggers and effects are listed in docs/SPEC.md §7."""

from datetime import UTC, datetime, timedelta

from sqlmodel import Session, select

from app.agent import audit
from app.models import SafetyLock, now_iso

RULES = [
    # (trigger kinds, threshold, window minutes, lock scope, lock minutes or None, reason)
    ({"verification_failed"}, 3, 15, "red", 30, "VERIFICATION_FAILURES"),
    ({"screening"}, 3, 10, "agent", None, "FLAGGED_REQUESTS"),
    ({"plan_rejected"}, 5, 10, "agent", None, "REJECTED_PLANS"),
    ({"payment_new_payee"}, 3, 60, "payments", None, "NEW_PAYEE_VELOCITY"),
]

MESSAGES = {
    "VERIFICATION_FAILURES": ("连续验证失败，大额和高风险操作已锁定 30 分钟。",
                              "Too many failed checks: red-tier actions are locked for 30 minutes."),
    "FLAGGED_REQUESTS": ("检测到多次试图绕过安全规则的请求，助手已暂停。完成一次身份验证即可恢复。",
                         "Several requests tried to get around the safety rules, so the assistant is paused. Verify your identity to resume."),
    "REJECTED_PLANS": ("助手连续生成了无效计划，已暂停以保安全。完成一次身份验证即可恢复。",
                       "The assistant produced several invalid plans and paused itself. Verify your identity to resume."),
    "NEW_PAYEE_VELOCITY": ("短时间内多次向新收款人付款，转账和付款已锁定。完成一次身份验证即可解除。",
                           "Several payments to new payees in a short time: payments are locked. Verify your identity to unlock."),
}


def _now() -> datetime:
    return datetime.now(UTC)


def active(session: Session, user_id: str) -> list[SafetyLock]:
    now = _now().isoformat()
    return [
        lock for lock in session.exec(
            select(SafetyLock).where(SafetyLock.user_id == user_id, SafetyLock.cleared_at.is_(None))
        )
        if lock.expires_at is None or lock.expires_at > now
    ]


def blocks(locks: list[SafetyLock], *, tier: str, payment: bool) -> SafetyLock | None:
    for lock in locks:
        if lock.scope == "agent" or (lock.scope == "red" and tier == "red") or (
            lock.scope == "payments" and payment
        ):
            return lock
    return None


def evaluate(session: Session, user_id: str) -> list[SafetyLock]:
    """Check the rolling windows after a security event and add any lock that is now due."""
    created = []
    current = {lock.reason for lock in active(session, user_id)}
    for kinds, threshold, minutes, scope, lock_minutes, reason in RULES:
        if reason in current:
            continue
        since = (_now() - timedelta(minutes=minutes)).isoformat()
        latest_unlock = session.exec(
            select(SafetyLock.cleared_at).where(SafetyLock.user_id == user_id, SafetyLock.reason == reason,
                                                SafetyLock.cleared_at.is_not(None))
            .order_by(SafetyLock.cleared_at.desc()).limit(1)
        ).first()
        if latest_unlock and latest_unlock > since:
            since = latest_unlock  # events before an unlock do not count again
        if audit.count_since(session, user_id, kinds, since) >= threshold:
            lock = SafetyLock(
                user_id=user_id, scope=scope, reason=reason,
                expires_at=(_now() + timedelta(minutes=lock_minutes)).isoformat() if lock_minutes else None,
            )
            session.add(lock)
            session.flush()
            audit.append(session, user_id, "lock", {"scope": scope, "reason": reason,
                                                    "expires_at": lock.expires_at})
            created.append(lock)
    return created


def clear(session: Session, user_id: str, *, by: str, scopes: set[str] | None = None) -> list[str]:
    cleared = []
    for lock in active(session, user_id):
        if scopes and lock.scope not in scopes:
            continue
        if lock.scope == "red" and by == "customer":
            continue  # a failed-verification lock is never cleared by another verification attempt
        lock.cleared_at, lock.cleared_by = now_iso(), by
        session.add(lock)
        cleared.append(lock.reason)
        audit.append(session, user_id, "unlock", {"scope": lock.scope, "reason": lock.reason, "by": by})
    return cleared


def describe(lock: SafetyLock, lang: str) -> str:
    zh, en = MESSAGES.get(lock.reason, ("安全锁已开启。", "A safety lock is active."))
    return zh if lang == "zh" else en
