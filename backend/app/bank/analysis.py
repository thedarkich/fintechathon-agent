"""Bill analysis: spending by category, reports, unusual transactions and recurring charges.

Everything here is fixed code over the customer's own rows. Each flag carries its reason.
"""

import re
import statistics
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from sqlmodel import Session, select

from app import clock
from app.bank.categories import normalize
from app.clock import CST
from app.models import Subscription, Txn

SPEND_KINDS = {"card", "direct_debit", "transfer_out", "order"}
MUSIC = ("网易云音乐", "qq音乐", "酷狗", "酷我", "apple music", "spotify")
VIDEO = ("腾讯视频", "爱奇艺", "优酷", "芒果tv", "哔哩哔哩", "bilibili")


def txns_between(session: Session, user_id: str, start: date, end: date) -> list[Txn]:
    """Posted transactions with start <= day < end."""
    return list(session.exec(
        select(Txn).where(
            Txn.user_id == user_id,
            Txn.at >= clock.iso(datetime.combine(start, datetime.min.time(), CST)),
            Txn.at < clock.iso(datetime.combine(end, datetime.min.time(), CST)),
        ).order_by(Txn.at)
    ).all())


def is_spend(t: Txn) -> bool:
    return t.status == "posted" and t.amount_fen < 0 and t.kind in SPEND_KINDS


def period_bounds(period: str, today: date, offset: int = 0) -> tuple[date, date]:
    """period 'month' or 'year'; offset 0 = current (to date), -1 = previous full period."""
    if period == "year":
        year = today.year + offset
        return date(year, 1, 1), min(date(year + 1, 1, 1), today + timedelta(days=1))
    first = clock.add_months(date(today.year, today.month, 1), offset)
    return first, min(clock.add_months(first, 1), today + timedelta(days=1))


def summarize(txns: list[Txn]) -> dict:
    spend = [t for t in txns if is_spend(t)]
    by_category: dict[str, int] = defaultdict(int)
    by_merchant: dict[str, int] = defaultdict(int)
    for t in spend:
        by_category[t.category] += -t.amount_fen
        by_merchant[re.sub(r"\(.*?\)", "", t.counterparty).strip()] += -t.amount_fen
    income = sum(t.amount_fen for t in txns if t.status == "posted" and t.amount_fen > 0
                 and t.kind in {"salary", "transfer_in", "refund"})
    total = sum(by_category.values())
    return {
        "spend_fen": total,
        "income_fen": income,
        "net_fen": income - total,
        "count": len(spend),
        "categories": [
            {"category": c, "fen": v, "share": round(v / total, 4) if total else 0}
            for c, v in sorted(by_category.items(), key=lambda kv: -kv[1])
        ],
        "top_merchants": [
            {"merchant": m, "fen": v}
            for m, v in sorted(by_merchant.items(), key=lambda kv: -kv[1])[:5]
        ],
        "largest": [
            {"id": t.id, "at": t.at, "merchant": t.counterparty, "fen": -t.amount_fen,
             "category": t.category}
            for t in sorted(spend, key=lambda t: t.amount_fen)[:5]
        ],
    }


def spending(session: Session, user_id: str, start: date, end: date, category: str | None = None) -> dict:
    txns = txns_between(session, user_id, start, end)
    if category:
        txns = [t for t in txns if t.category == category]
    result = summarize(txns)
    result.update(start=start.isoformat(), end=(end - timedelta(days=1)).isoformat(), category=category)
    return result


def report(session: Session, user_id: str, today: date, period: str, offset: int) -> dict:
    start, end = period_bounds(period, today, offset)
    previous_start, previous_end = period_bounds(period, start - timedelta(days=1), 0)
    if period == "month":
        previous_end = start
    current = summarize(txns_between(session, user_id, start, end))
    previous = summarize(txns_between(session, user_id, previous_start, previous_end))
    series = []
    if period == "year":
        month = start
        while month < end:
            following = clock.add_months(month, 1)
            series.append({"label": month.strftime("%Y-%m"),
                           "fen": summarize(txns_between(session, user_id, month, min(following, end)))["spend_fen"]})
            month = following
    else:
        day = start
        while day < end:
            series.append({"label": day.isoformat(),
                           "fen": summarize(txns_between(session, user_id, day, day + timedelta(days=1)))["spend_fen"]})
            day += timedelta(days=1)
    previous_by = {c["category"]: c["fen"] for c in previous["categories"]}
    changes = [
        {"category": c["category"], "fen": c["fen"], "previous_fen": previous_by.get(c["category"], 0)}
        for c in current["categories"]
    ]
    return {
        "period": period,
        "start": start.isoformat(),
        "end": (end - timedelta(days=1)).isoformat(),
        "complete": end <= today,
        **current,
        "previous_spend_fen": previous["spend_fen"],
        "changes": changes,
        "series": series,
    }


def anomalies(session: Session, user_id: str, today: date, days: int = 30) -> list[dict]:
    window_start = today - timedelta(days=days)
    history = txns_between(session, user_id, window_start - timedelta(days=180), today + timedelta(days=1))
    recent = [t for t in history if t.at >= clock.iso(datetime.combine(window_start, datetime.min.time(), CST))]
    earlier = [t for t in history if t not in recent]
    seen_before = {normalize(re.sub(r"\(.*?\)", "", t.counterparty)) for t in earlier}
    card_spend = [-t.amount_fen for t in earlier if is_spend(t) and t.kind == "card" and t.channel != "auto"]
    typical = statistics.median(card_spend) if card_spend else 5_000
    found: list[dict] = []

    def flag(t: Txn, code: str, en: str, zh: str):
        found.append({"txn_id": t.id, "at": t.at, "merchant": t.counterparty, "fen": -t.amount_fen,
                      "code": code, "reason_en": en, "reason_zh": zh, "status": t.status,
                      "card_id": t.card_id})

    spend = sorted((t for t in recent if t.amount_fen < 0), key=lambda t: t.at)
    for previous, current in zip(spend, spend[1:], strict=False):
        if (previous.counterparty == current.counterparty and previous.amount_fen == current.amount_fen
                and previous.status == current.status == "posted"
                and (clock.parse(current.at) - clock.parse(previous.at)) <= timedelta(minutes=10)):
            flag(current, "DUPLICATE_CHARGE",
                 "Same merchant and amount charged twice within 10 minutes.",
                 "同一商户、同一金额在 10 分钟内扣款两次。")
    for t in spend:
        when = clock.parse(t.at).astimezone(CST)
        name = normalize(re.sub(r"\(.*?\)", "", t.counterparty))
        if t.status == "declined" and t.country != "CN":
            flag(t, "OVERSEAS_DECLINED",
                 "An overseas charge was attempted and declined (overseas payments are off on that card).",
                 "有一笔境外扣款尝试被拒绝（该卡已关闭境外支付）。")
            continue
        if t.status != "posted" or t.kind != "card" or t.channel == "auto":
            continue
        new_merchant = name not in seen_before
        large = -t.amount_fen >= max(5 * typical, 100_000)
        night = when.hour < 5
        if new_merchant and large:
            reason_en = "Large first-time payment to a merchant you have never paid before"
            reason_zh = "首次向从未消费过的商户支付大额款项"
            if night:
                reason_en += ", made between midnight and 5 am"
                reason_zh += "，且发生在凌晨"
            flag(t, "NEW_MERCHANT_LARGE", reason_en + ".", reason_zh + "。")
        elif night and large:
            flag(t, "NIGHT_LARGE", "Large payment made between midnight and 5 am.", "凌晨发生的大额支付。")
    # category spike: the last full month against the six months before it
    last_start, last_end = period_bounds("month", today, -1)
    last = summarize(txns_between(session, user_id, last_start, last_end))
    baseline: dict[str, list[int]] = defaultdict(list)
    for back in range(2, 8):
        s, e = period_bounds("month", today, -back)
        month = {c["category"]: c["fen"] for c in summarize(txns_between(session, user_id, s, e))["categories"]}
        for category in {c["category"] for c in last["categories"]}:
            baseline[category].append(month.get(category, 0))
    for c in last["categories"]:
        average = statistics.mean(baseline[c["category"]]) if baseline[c["category"]] else 0
        if average >= 20_000 and c["fen"] >= average * 1.4 and c["category"] not in {"housing", "family"}:
            found.append({
                "txn_id": None, "at": last_start.isoformat(), "merchant": None, "fen": c["fen"],
                "code": "CATEGORY_SPIKE", "category": c["category"], "average_fen": round(average),
                "reason_en": f"Spending in this category last month was {c['fen'] / average:.1f}× the six-month average.",
                "reason_zh": f"上月该类消费是近六个月平均值的 {c['fen'] / average:.1f} 倍。",
                "status": "posted", "card_id": None,
            })
    order = {"OVERSEAS_DECLINED": 0, "NEW_MERCHANT_LARGE": 1, "DUPLICATE_CHARGE": 2, "NIGHT_LARGE": 3,
             "CATEGORY_SPIKE": 4}
    return sorted(found, key=lambda f: (order.get(f["code"], 9), f["at"]))


def merchant_key(name: str) -> str:
    name = re.sub(r"\(.*?\)", "", name)
    for word in ("自动续费", "年费", "会员", "vip", "svip"):
        name = name.replace(word, "")
    return normalize(name)


def detect_recurring(txns: list[Txn], today: date) -> list[dict]:
    """Outgoing charges of the same amount to the same merchant at a monthly or yearly rhythm."""
    groups: dict[tuple[str, int], list[Txn]] = defaultdict(list)
    per_merchant: Counter = Counter()
    for t in txns:
        if t.status == "posted" and t.amount_fen < 0 and t.kind in {"card", "direct_debit"}:
            groups[(merchant_key(t.counterparty), t.amount_fen)].append(t)
            per_merchant[merchant_key(t.counterparty)] += 1
    found = []
    for (key, amount), charges in groups.items():
        charges.sort(key=lambda t: t.at)
        days = [clock.to_date(t.at) for t in charges]
        gaps = [(b - a).days for a, b in zip(days, days[1:], strict=False)]
        if len(charges) >= 3 and gaps and all(25 <= g <= 35 for g in gaps[-3:]):
            cycle, length = "monthly", 31
            next_day = clock.add_months(days[-1], 1)
        elif len(charges) >= 2 and gaps and all(350 <= g <= 380 for g in gaps) and per_merchant[key] == len(charges):
            # a shop seen for other purchases (a café, a delivery app) that happens to repeat a price is not a subscription
            cycle, length = "yearly", 366
            next_day = clock.add_months(days[-1], 12)
        else:
            continue
        if (today - days[-1]).days > length * 1.5:
            continue  # stopped: no longer charging
        latest = charges[-1]
        found.append({
            "key": f"{key}|{-amount}", "merchant": re.sub(r"\(.*?\)", "", latest.counterparty).strip(),
            "category": latest.category, "amount_fen": -amount, "cycle": cycle,
            "first_seen": charges[0].at, "last_charged": latest.at,
            "next_charge_on": next_day.isoformat(), "charges": len(charges), "card_id": latest.card_id,
        })
    return sorted(found, key=lambda s: s["next_charge_on"])


def refresh_subscriptions(session: Session, user_id: str, today: date) -> list[Subscription]:
    txns = txns_between(session, user_id, today - timedelta(days=800), today + timedelta(days=1))
    existing = {s.key: s for s in session.exec(select(Subscription).where(Subscription.user_id == user_id))}
    found = detect_recurring(txns, today)
    for item in found:
        row = existing.get(item["key"])
        if row is None:
            row = Subscription(user_id=user_id, **item)
            existing[item["key"]] = row
        elif row.status in ("active", "ended"):
            row.status = "active"  # charging again
            for field in ("last_charged", "next_charge_on", "charges", "card_id"):
                setattr(row, field, item[field])
        session.add(row)
    # no longer recurring (it stopped, or an older rule mistook repeat purchases for one): stop listing and renewing it
    detected = {item["key"] for item in found}
    for key, row in existing.items():
        if row.status == "active" and key not in detected:
            row.status = "ended"
            session.add(row)
    session.flush()
    return sorted(existing.values(), key=lambda s: (s.status != "active", s.next_charge_on))


def overlaps(subscriptions: list[Subscription]) -> list[dict]:
    active = [s for s in subscriptions if s.status == "active"]
    result = []
    for group, words in (("music", MUSIC), ("video", VIDEO)):
        members = [s for s in active if any(w in normalize(s.merchant) for w in words)]
        if len(members) >= 2:
            result.append({"group": group, "ids": [s.id for s in members],
                           "merchants": [s.merchant for s in members],
                           "monthly_fen": sum(s.amount_fen for s in members if s.cycle == "monthly")})
    return result


def new_trials(subscriptions: list[Subscription], today: date) -> list[str]:
    """Active subscriptions that began within the last 100 days (often a trial that converted)."""
    return [s.id for s in subscriptions
            if s.status == "active" and (today - clock.to_date(s.first_seen)).days <= 100]


def monthly_cost(subscriptions: list[Subscription]) -> int:
    total = 0
    for s in subscriptions:
        if s.status == "active":
            total += s.amount_fen if s.cycle == "monthly" else round(s.amount_fen / 12)
    return total


def typical_transfer(session: Session, user_id: str, today: date) -> int:
    txns = txns_between(session, user_id, today - timedelta(days=180), today + timedelta(days=1))
    amounts = [-t.amount_fen for t in txns if t.kind == "transfer_out" and t.status == "posted"]
    return int(statistics.median(amounts)) if amounts else 50_000


def counts_by_category(txns: list[Txn]) -> Counter:
    return Counter(t.category for t in txns if is_spend(t))
