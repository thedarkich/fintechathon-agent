"""Append-only, hash-chained audit log per customer. Secrets never enter it."""

import hashlib
import json

from sqlalchemy import func
from sqlmodel import Session, select

from app.models import AuditEntry, now_iso

GENESIS = "0" * 64
SECRET_FIELDS = {"pin", "code", "password", "new_password", "new_pin", "assertion", "credential"}


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def entry_hash(prev_hash: str, seq: int, kind: str, plan_id: str | None, data: dict, at: str) -> str:
    body = canonical({"seq": seq, "kind": kind, "plan_id": plan_id, "data": data, "at": at})
    return hashlib.sha256((prev_hash + body).encode()).hexdigest()


def scrub(value):
    if isinstance(value, dict):
        return {k: ("[hidden]" if k in SECRET_FIELDS else scrub(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    return value


def append(session: Session, user_id: str, kind: str, data: dict | None = None,
           plan_id: str | None = None) -> AuditEntry:
    last = session.exec(
        select(AuditEntry).where(AuditEntry.user_id == user_id).order_by(AuditEntry.seq.desc()).limit(1)
    ).first()
    seq = (last.seq + 1) if last else 1
    prev = last.hash if last else GENESIS
    at = now_iso()
    clean = json.loads(canonical(scrub(data or {})))
    entry = AuditEntry(user_id=user_id, seq=seq, kind=kind, plan_id=plan_id, data=clean, at=at,
                       prev_hash=prev, hash=entry_hash(prev, seq, kind, plan_id, clean, at))
    session.add(entry)
    session.flush()
    return entry


def verify(session: Session, user_id: str) -> dict:
    prev, count = GENESIS, 0
    for entry in session.exec(
        select(AuditEntry).where(AuditEntry.user_id == user_id).order_by(AuditEntry.seq)
    ):
        count += 1
        expected = entry_hash(prev, entry.seq, entry.kind, entry.plan_id, entry.data, entry.at)
        if entry.prev_hash != prev or entry.hash != expected or entry.seq != count:
            return {"ok": False, "entries": count, "broken_at": entry.seq}
        prev = entry.hash
    return {"ok": True, "entries": count, "head": prev}


def count_since(session: Session, user_id: str, kinds: set[str], since_iso: str) -> int:
    return session.exec(
        select(func.count()).select_from(AuditEntry).where(
            AuditEntry.user_id == user_id, AuditEntry.kind.in_(kinds), AuditEntry.at >= since_iso
        )
    ).one()
