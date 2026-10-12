"""Bank time. China Standard Time has no daylight saving, so a fixed UTC+8 offset is exact.

Each customer has a demo clock: real time plus an offset that only the demo panel and tests move,
so scheduled steps, renewals and birthdays can be shown without waiting.
"""

from datetime import UTC, date, datetime, timedelta, timezone

from sqlmodel import Session

from app.models import DemoClock

CST = timezone(timedelta(hours=8))


def real_now() -> datetime:
    return datetime.now(UTC)


def offset(session: Session, user_id: str) -> int:
    row = session.get(DemoClock, user_id)
    return row.offset_seconds if row else 0


def now(session: Session, user_id: str) -> datetime:
    return (real_now() + timedelta(seconds=offset(session, user_id))).astimezone(CST)


def advance(session: Session, user_id: str, seconds: int) -> None:
    row = session.get(DemoClock, user_id) or DemoClock(user_id=user_id)
    row.offset_seconds += seconds
    session.add(row)


def reset(session: Session, user_id: str) -> None:
    row = session.get(DemoClock, user_id)
    if row:
        session.delete(row)


def iso(moment: datetime) -> str:
    return moment.astimezone(CST).isoformat(timespec="seconds")


def parse(value: str) -> datetime:
    moment = datetime.fromisoformat(value)
    return moment if moment.tzinfo else moment.replace(tzinfo=CST)


def day_start(moment: datetime) -> datetime:
    local = moment.astimezone(CST)
    return datetime(local.year, local.month, local.day, tzinfo=CST)


def to_date(value: str | date | datetime) -> date:
    if isinstance(value, datetime):
        return value.astimezone(CST).date()
    if isinstance(value, date):
        return value
    return parse(value).date() if "T" in value else date.fromisoformat(value)


def add_months(day: date, months: int) -> date:
    month = day.month - 1 + months
    year = day.year + month // 12
    month = month % 12 + 1
    last = [31, 29 if year % 4 == 0 and (year % 100 or year % 400 == 0) else 28, 31, 30, 31, 30,
            31, 31, 30, 31, 30, 31][month - 1]
    return date(year, month, min(day.day, last))


def next_birthday(mm_dd: str, today: date) -> date:
    month, day = (int(part) for part in mm_dd.split("-"))
    for year in (today.year, today.year + 1):
        try:
            candidate = date(year, month, day)
        except ValueError:  # 29 February in a non-leap year
            candidate = date(year, 3, 1)
        if candidate >= today:
            return candidate
    raise ValueError("unreachable")
