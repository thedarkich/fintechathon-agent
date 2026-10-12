"""Analysis code for common open-ended questions, so the offline planner can use the sandbox too.

The output is ordinary generated code: it goes through exactly the same checks and sandbox as
code written by the model.
"""

import re
from datetime import date, timedelta

from app.clock import add_months

MERCHANT_WORDS = [
    (("咖啡", "coffee", "瑞幸", "星巴克", "luckin", "starbucks"), ["瑞幸", "星巴克", "咖啡", "luckin", "starbucks"]),
    (("外卖", "takeaway", "delivery", "美团", "饿了么"), ["美团外卖", "饿了么"]),
    (("打车", "taxi", "didi", "滴滴"), ["滴滴"]),
    (("奶茶", "bubble tea", "milk tea", "喜茶"), ["喜茶", "蜜雪", "茶颜"]),
    (("火锅", "hotpot", "海底捞"), ["海底捞", "火锅"]),
    (("淘宝", "taobao"), ["淘宝"]),
    (("京东", "jd.com"), ["京东"]),
    (("电影", "movie", "猫眼"), ["猫眼", "电影"]),
]
CATEGORY_WORDS = [
    ("groceries", ("超市", "买菜", "groceries", "supermarket")),
    ("shopping", ("购物", "网购", "shopping")),
    ("dining", ("餐饮", "吃饭", "dining", "eating out")),
    ("transport", ("交通", "transport")),
    ("digital", ("会员", "订阅", "subscription")),
]


def _hours(text: str) -> tuple[int | None, int | None]:
    low = text.lower()
    after = before = None
    if m := re.search(r"(晚上|下午|夜里)?\s*(\d{1,2})\s*点\s*(以后|之后|后)", text):
        after = int(m.group(2)) + (12 if m.group(1) and int(m.group(2)) < 12 else 0)
    elif m := re.search(r"after\s*(\d{1,2})\s*(pm|am|:00)?", low):
        after = int(m.group(1)) + (12 if m.group(2) == "pm" and int(m.group(1)) < 12 else 0)
    if m := re.search(r"(早上|上午)?\s*(\d{1,2})\s*点\s*(以前|之前|前)", text):
        before = int(m.group(2))
    elif m := re.search(r"before\s*(\d{1,2})\s*(am|pm)?", low):
        before = int(m.group(1)) + (12 if m.group(2) == "pm" and int(m.group(1)) < 12 else 0)
    if after is None and re.search(r"深夜|半夜|凌晨|late at night|after midnight", low):
        after, before = 0, 5
    return after, before


def _period(text: str, today: date) -> tuple[date, date, str]:
    low = text.lower()
    if "今年" in text or "this year" in low:
        return date(today.year, 1, 1), today, "year"
    if "去年" in text or "last year" in low:
        return date(today.year - 1, 1, 1), date(today.year - 1, 12, 31), "year"
    if "上个月" in text or "上月" in text or "last month" in low:
        first = add_months(date(today.year, today.month, 1), -1)
        return first, date(today.year, today.month, 1) - timedelta(days=1), "month"
    if "本月" in text or "这个月" in text or "this month" in low:
        return date(today.year, today.month, 1), today, "month"
    if m := re.search(r"(?:最近|过去|近)\s*(\d+)\s*天|(?:last|past)\s*(\d+)\s*days", low):
        days = int(m.group(1) or m.group(2))
        return today - timedelta(days=days - 1), today, "days"
    return today - timedelta(days=364), today, "year"


def is_analysis_question(text: str) -> bool:
    low = text.lower()
    after, before = _hours(text)
    return bool(
        after is not None or before is not None
        or re.search(r"周末|工作日|weekend|weekday|几次|多少次|how many times|how often|平均|average|按月|每个月花|per month|by month|最多的一天|busiest", low)
    )


def from_question(text: str, today: date) -> str | None:
    if not is_analysis_question(text):
        return None
    low = text.lower()
    merchants = next((names for words, names in MERCHANT_WORDS if any(w in low for w in words)), [])
    category = next((c for c, words in CATEGORY_WORDS if any(w in low for w in words)), None)
    after, before = _hours(text)
    weekend = True if re.search(r"周末|weekend", low) else False if re.search(r"工作日|weekday", low) else None
    start, end, _ = _period(text, today)
    mode = "count" if re.search(r"几次|多少次|how many times|how often", low) else \
        "average" if re.search(r"平均|average", low) else "sum"
    title = text.strip()[:80]
    return f'''def answer(txns):
    merchants = {merchants!r}
    category = {category!r}
    after, before = {after!r}, {before!r}
    weekend = {weekend!r}
    start, end = {start.isoformat()!r}, {end.isoformat()!r}
    picked = []
    for t in txns:
        if t["amount"] >= 0 or not (start <= t["date"] <= end):
            continue
        if merchants and not any(m in t["merchant"].lower() for m in merchants):
            continue
        if category and t["category"] != category:
            continue
        if after is not None and t["hour"] < after:
            continue
        if before is not None and t["hour"] >= before:
            continue
        if weekend is not None and (t["weekday"] >= 5) != weekend:
            continue
        picked.append(t)
    months = {{}}
    for t in picked:
        months[t["date"][:7]] = months.get(t["date"][:7], 0) + (1 if {mode!r} == "count" else -t["amount"])
    rows = [[month, round(value, 2)] for month, value in sorted(months.items())]
    total = -sum(t["amount"] for t in picked)
    if {mode!r} == "count":
        return {{"title": {title!r}, "value": len(picked), "unit": "count", "rows": rows}}
    if {mode!r} == "average":
        return {{"title": {title!r}, "value": round(total / len(picked), 2) if picked else 0, "unit": "yuan", "rows": rows}}
    return {{"title": {title!r}, "value": round(total, 2), "unit": "yuan", "rows": rows}}
'''
