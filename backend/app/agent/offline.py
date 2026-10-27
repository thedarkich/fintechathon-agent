"""Deterministic planner for Chinese and English, used when no AI provider is configured.

It covers the demo scenarios and the test suite without an API key. It produces exactly the same
plan format as the model, so everything after planning (validation, policy, approval) is identical.
"""

import re
from datetime import date, timedelta

from app.agent.planner import AskOut, PlanOut, StepOut
from app.clock import add_months
from app.sandbox import templates

CN_DIGITS = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
CN_UNITS = {"十": 10, "百": 100, "千": 1000, "万": 10000}
WEEKDAY_ZH = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}
WEEKDAY_EN = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}

RELATION_WORDS = ["老婆", "媳妇", "妻子", "爱人", "太太", "老公", "妈妈", "老妈", "爸爸", "老爸", "我爸", "我妈", "房东", "室友",
                  "wife", "husband", "partner", "spouse", "mom", "mum", "mother", "dad", "father", "landlord", "roommate"]
SUB_NAMES = ["爱奇艺", "腾讯视频", "网易云音乐", "网易云", "qq音乐", "百度网盘", "健身", "wps", "京东plus", "中国移动",
             "宽带", "iqiyi", "tencent video", "netease", "qq music", "baidu", "gym", "jd plus",
             "netflix", "spotify", "apple music", "youtube", "优酷", "芒果tv", "哔哩哔哩", "bilibili", "喜马拉雅"]
CATEGORY_WORDS = [
    ("dining", ["吃饭", "餐饮", "外卖", "吃的", "咖啡", "dining", "food", "eating", "restaurant", "coffee", "takeaway"]),
    ("groceries", ["超市", "买菜", "groceries", "supermarket"]),
    ("shopping", ["购物", "网购", "淘宝", "shopping"]),
    ("transport", ["交通", "打车", "地铁", "transport", "taxi", "didi"]),
    ("entertainment", ["娱乐", "电影", "entertainment", "movies"]),
    ("digital", ["会员", "订阅费", "digital", "streaming"]),
    ("utilities", ["水电", "话费", "电费", "utilities", "bills"]),
    ("travel", ["旅行", "旅游", "酒店", "travel", "hotel"]),
    ("health", ["健康", "医疗", "健身", "health", "medical", "fitness"]),
]


# the bank's partner services for a birthday, and the words that name them; flowers and a cake when none is named
SHOPS = (("florist", ("花", "flower")), ("bakery", ("蛋糕", "cake")),
         ("gift", ("礼物", "礼品", "礼盒", "gift", "present")),
         ("restaurant", ("餐厅", "订座", "订位", "订桌", "订个桌", "晚餐", "吃顿饭", "吃饭", "dinner", "restaurant", "table for")))


def cn_number(text: str) -> float | None:
    """'两千五' -> 2500, '三百' -> 300, '1万' -> 10000, '一千二百' -> 1200."""
    if not text:
        return None
    if re.fullmatch(r"[\d.]+[万千kK]?", text):
        value = float(re.sub(r"[万千kK]", "", text))
        return value * (10000 if "万" in text else 1000 if re.search(r"[千kK]", text) else 1)
    total, section, number, last_unit = 0, 0, 0, 1
    for ch in text:
        if ch in CN_DIGITS:
            number = CN_DIGITS[ch]
        elif ch in CN_UNITS:
            unit = CN_UNITS[ch]
            if unit == 10000:
                total += (section + number) * unit
                section, number = 0, 0
            else:
                section += (number or 1) * unit
                number = 0
            last_unit = unit
        else:
            return None
    if number and last_unit >= 100:  # '两千五' means 2500
        number *= last_unit // 10
    return float(total + section + number) or None


# how the customer wants a transfer to arrive (bank/transfers.py)
STANDARD_ARRIVAL = re.compile(r"(普通|延时|延迟|2\s*小时(后)?|两小时(后)?)到账|\bdelayed\b|\bin (2|two) hours\b")
NEXT_DAY_ARRIVAL = re.compile(r"(次日|明天|隔天|第二天)(凌晨)?到账|next[- ]day|arrive tomorrow")

AMOUNT = re.compile(
    r"(?:¥|￥|rmb\s*|cny\s*)?(\d+(?:\.\d{1,2})?\s*[万千kK]?|[零〇一二两三四五六七八九十百千万]{1,8})\s*(?:元|块钱|块|rmb|yuan|cny)?",
    re.IGNORECASE)


def unclear_amount(text: str) -> bool:
    """'-100' or '200.555': not an amount to guess at; ask for it instead."""
    return bool(re.search(r"(?<![0-9A-Za-z])[-−]\s*\d", text) or re.search(r"\d\.\d{3,}", text))


def amounts(text: str) -> list[float]:
    found = []
    cleaned = re.sub(r"1\d{10}", " ", text)  # phone numbers are not amounts
    cleaned = re.sub(r"\d{4}-\d{2}-\d{2}", " ", cleaned)
    # dates and times are not amounts; \b only works after English units ('1号给房东' has no word break)
    cleaned = re.sub(r"(\d{1,2})\s*(?:号|日|月|点|天|周|个月|年|小时|分钟|(?:days?|weeks?|months?|years?|hours?|minutes?|th|st|nd|rd)\b)",
                     " ", cleaned)
    cleaned = re.sub(r"(尾号|ending|card)\s*\d{4}", " ", cleaned)
    for match in AMOUNT.finditer(cleaned):
        raw = match.group(1).replace(" ", "")
        if re.fullmatch(r"[零〇一二两三四五六七八九十百千万]+", raw) and len(raw) == 1 and raw not in "十百千万":
            continue  # a lone '一' is not an amount
        value = cn_number(raw)
        if value:
            found.append(value)
    return found


def when_from(text: str, today: date) -> tuple[str | None, str]:
    """Returns (date or datetime string, repeat)."""
    lowered = text.lower()
    repeat = "monthly" if re.search(r"每个?月|every month|monthly", lowered) else "none"
    hour = 9
    hour_match = re.search(r"(\d{1,2})\s*(点|:00|am|pm)", lowered)
    if hour_match:
        hour = int(hour_match.group(1)) + (12 if hour_match.group(2) == "pm" and int(hour_match.group(1)) < 12 else 0)
        if re.search(r"下午|晚上", text) and hour < 12:
            hour += 12
    day = None
    if m := re.search(r"(\d{4}-\d{2}-\d{2})", text):
        day = date.fromisoformat(m.group(1))
    elif "后天" in text or "day after tomorrow" in lowered:
        day = today + timedelta(days=2)
    elif "明天" in text or "tomorrow" in lowered:
        day = today + timedelta(days=1)
    elif m := re.search(r"下(?:个)?(?:周|星期|礼拜)([一二三四五六日天])", text):
        day = today + timedelta(days=(7 - today.weekday()) + WEEKDAY_ZH[m.group(1)])
    elif m := re.search(r"next (monday|tuesday|wednesday|thursday|friday|saturday|sunday)", lowered):
        day = today + timedelta(days=(7 - today.weekday()) + WEEKDAY_EN[m.group(1)])  # like 下周五: that day next week
    elif m := re.search(r"(?:this|on) (monday|tuesday|wednesday|thursday|friday|saturday|sunday)", lowered):
        day = today + timedelta(days=(WEEKDAY_EN[m.group(1)] - today.weekday()) % 7 or 7)  # the coming one
    elif m := re.search(r"(?<![上下每])(?:这|本)?(?:周|星期|礼拜)([一二三四五六日天])", text):
        day = today + timedelta(days=(WEEKDAY_ZH[m.group(1)] - today.weekday()) % 7 or 7)  # '周五给妈妈转500': the coming Friday
    elif m := re.search(r"(\d+)\s*天后|in (\d+) days", lowered):
        day = today + timedelta(days=int(m.group(1) or m.group(2)))
    elif m := re.search(r"(?:每个?月)?(\d{1,2})\s*[号日]|on the (\d{1,2})(?:st|nd|rd|th)", lowered):
        n = int(m.group(1) or m.group(2))
        candidate = date(today.year, today.month, min(n, 28))
        day = candidate if candidate > today else add_months(candidate, 1)
    if day is None:
        return None, repeat
    return f"{day.isoformat()}T{hour:02d}:00", repeat


SPAN_UNITS = {"天": 1, "日": 1, "day": 1, "周": 7, "星期": 7, "礼拜": 7, "week": 7, "个月": 30, "月": 30, "month": 30,
              "年": 365, "year": 365}


def span_from(text: str, today: date) -> tuple[date, date] | None:
    """A stretch of time that isn't a calendar month or year: '上周', '这周', '最近三个月', '近半年', 'the last 2 weeks',
    '今年' (the year to date). Returns (first day, last day), both included."""
    lowered = text.lower()
    monday = today - timedelta(days=today.weekday())
    if has(text, "上周", "上星期", "上个星期", "上礼拜", "上个礼拜", "last week"):
        return monday - timedelta(days=7), monday - timedelta(days=1)
    if has(text, "这周", "本周", "这星期", "这个星期", "这礼拜", "this week"):
        return monday, today
    if m := re.search(r"(?:最近|近|过去|这)\s*(半)\s*(年)|(?:最近|近|过去)\s*(\d{1,3}|[一二两三四五六七八九十]{1,3})\s*(个月|天|日|周|星期|礼拜|年)"
                      r"|\b(?:last|past)\s+(\d{1,3}|two|three|four|five|six|twelve)\s+(day|week|month|year)s?\b", lowered):
        if m.group(1):
            days = 182
        else:
            raw, unit = (m.group(3), m.group(4)) if m.group(3) else (m.group(5), m.group(6))
            words = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "twelve": 12}
            n = int(raw) if raw.isdigit() else words.get(raw) or int(cn_number(raw) or 0)
            if not n:
                return None
            days = n * SPAN_UNITS[unit]
        return today - timedelta(days=min(days, 730) - 1), today
    if has(text, "今年", "this year"):
        return date(today.year, 1, 1), today
    if has(text, "去年", "last year"):
        return date(today.year - 1, 1, 1), date(today.year - 1, 12, 31)
    return None


def found(word: str, lowered: str) -> bool:
    """English words must start a word ('pin' is not in 'shopping', 'mum' not in 'maximum'); Chinese matches anywhere."""
    if word.isascii() and word[:1].isalpha():
        return re.search(r"(?<![a-z])" + re.escape(word), lowered) is not None
    return word in lowered


def has(text: str, *words: str) -> bool:
    lowered = text.lower()
    return any(found(w, lowered) for w in words)


def payee_from(text: str) -> str | None:
    phone = re.search(r"1\d{10}", text)
    if phone:
        return phone.group(0)
    if m := re.search(r"(?:备注|标签)(?:是|为|叫)?\s*[“\"']?([一-龥A-Za-z0-9]{2,10}?)[”\"']?\s*的(?:人|那位|那个人|收款人)", text):
        return m.group(1)  # '给备注是房租的人转3200': the resolver also matches notes
    if m := re.search(r"(?:尾号|末四位|后四位)\s*(\d{4})", text):
        return m.group(1)  # '给尾号1123的那个人转100'
    text = re.sub(r"我的?(大学|高中|初中|老)?(同学|朋友|同事|好友|哥们|闺蜜|邻居)", "", text)  # '转500给我同学张伟'
    for word in RELATION_WORDS:
        if found(word, text.lower()):
            return word
    patterns = [
        r"(?:给|向|转给|打给|汇给|付给)\s*(?:我的?)?([一-龥]{2,4}?)(?:转|汇|打|付|发|的|那|\d|[零一二两三四五六七八九十百千万]|，|。|$)",
        r"(?:转|汇|打)(?:账)?\s*[\d零一二两三四五六七八九十百千万.]+\s*(?:元|块)?\s*给\s*([一-龥]{2,4})",
        r"([一-龥]{2,3}?)(?:借我|借给我)",  # '孙磊借我的钱还他600'
        r"\bto\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
        r"\b(?i:send|pay|transfer|wire)\s+(?:(?i:back)\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+\d",  # 'Pay back Sun Lei 600'
    ]
    for pattern in patterns:
        if m := re.search(pattern, text):
            name = m.group(1)
            if name not in ("我", "我的", "他", "她"):
                return name
    return None


def names_in(text: str) -> list[str]:
    """People in a split-bill request: '和张伟、王芳AA', 'with Zhang Wei and Wang Fang'."""
    people = []
    if m := re.search(r"(?:和|跟|与)([一-龥、，,和 ]+?)(?:一起)?(?:AA|aa|平摊|分摊|均摊|分)", text):
        people = [p for p in re.split(r"[、，, 和]+", m.group(1)) if p]
    elif m := re.search(r"with\s+([A-Za-z ,]+?)(?:\s*$|\s+for|\s+from|\s+\d)", text):
        people = [p.strip() for p in re.split(r",|\band\b", m.group(1)) if p.strip()]
    return people[:10]


def card_hint(text: str) -> str | None:
    # four digits name a card only next to a card word ('尾号0428', 'card 0428', '0428的卡'); '调到5000' is an amount
    if m := re.search(r"(?:尾号|末四位|后四位|ending(?:\s+in)?|last\s+four|cards?|卡号?|\*{2,})\s*(\d{4})(?![\d元块万千])"
                      r"|(?<!\d)(\d{4})\s*的?\s*(?:卡|card)", text, re.IGNORECASE):
        return m.group(1) or m.group(2)
    if has(text, "虚拟", "virtual", "网购卡") or (has(text, "网购", "网上购物", "online shopping") and has(text, "卡", "card")):
        return "virtual"  # '网购那张卡' too
    if has(text, "借记", "debit", "实体", "工资卡", "储蓄卡"):
        return "debit"
    return None


def product_words(text: str) -> list[str]:
    found = []
    for words, name in ((("货币", "money market"), "货币"), (("债", "bond"), "债"), (("混合", "均衡", "balanced", "mixed"), "混合"),
                        (("股票", "科技", "equity", "tech", "stock"), "股票"), (("qdii", "全球", "global", "overseas fund"), "QDII")):
        if has(text, *words):
            found.append(name)
    return found


SWITCH_ON = ("开通", "打开", "开启", "启用", "允许", "开了", "enable", "turn on", "allow", "activate")
SWITCH_OFF = ("关闭", "关掉", "关了", "禁用", "停用", "禁止", "disable", "turn off", "block", "switch off")
SWITCHES = (("overseas", ("境外", "海外", "国外", "overseas", "abroad", "international")),
            ("online", ("网上支付", "线上支付", "网上交易", "网上消费", "online payments", "online purchases")),
            ("atm", ("atm", "取现", "取款")), ("contactless", ("闪付", "contactless", "nfc")))
ONLINE_WORDS = ("网上", "线上", "网购", "online")  # enough once the customer has said 'card'


def switches_in(text: str, *, card: bool = False) -> dict:
    """'关闭境外交易' -> {'overseas': False}; empty unless the customer says on or off."""
    on, off = has(text, *SWITCH_ON), has(text, *SWITCH_OFF)
    if not (on or off):
        return {}
    found = {key: bool(on and not off) for key, words in SWITCHES if has(text, *words)}
    if card and "online" not in found and has(text, *ONLINE_WORDS):
        found["online"] = bool(on and not off)
    return found


BANKS = ("中国工商银行", "工商银行", "工行", "中国农业银行", "农业银行", "农行", "中国建设银行", "建设银行", "建行", "中国银行",
         "交通银行", "招商银行", "招行", "浦发银行", "中联银行", "ICBC", "China Merchants Bank", "Bank of China",
         "China Construction Bank", "Agricultural Bank of China", "Bank of Communications", "SPD Bank", "Central Union Bank")
BANK_FULL = {"工商银行": "中国工商银行", "工行": "中国工商银行", "农业银行": "中国农业银行", "农行": "中国农业银行",
             "建设银行": "中国建设银行", "建行": "中国建设银行", "招行": "招商银行", "ICBC": "中国工商银行",
             "China Merchants Bank": "招商银行", "Bank of China": "中国银行", "China Construction Bank": "中国建设银行",
             "Agricultural Bank of China": "中国农业银行", "Bank of Communications": "交通银行", "SPD Bank": "浦发银行",
             "Central Union Bank": "中联银行"}


def new_payee(text: str) -> PlanOut:
    """'添加收款人 王小明 13800001111 招商银行', 'add payee Wang Xiaoming, phone 13800001111'."""
    phone = re.search(r"(?<!\d)1\d{10}(?!\d)", text)
    account = re.search(r"(?<!\d)\d{12,19}(?!\d)", text)
    bank = next((b for b in BANKS if b.lower() in text.lower()), None)
    stripped = text
    for b in BANKS:
        stripped = re.sub(re.escape(b), " ", stripped, flags=re.IGNORECASE)
    name = re.search(r"收款人[:：\s]*(?:叫|是)?\s*([一-龥]{2,4})", stripped) \
        or re.search(r"(?:把|将)\s*([一-龥]{2,4})\s*(?:加|添加|存)", stripped) \
        or re.search(r"(?i:payee)[:\s]+(?:called\s+|named\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)", stripped) \
        or re.search(r"(?i:add)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?i:as)", stripped)
    if not name:
        return ask("新收款人叫什么名字？请一起告诉我手机号或银行卡号。", "What is the new payee's name? Please include their phone or account number.")
    args = {"name": name.group(1), "phone": phone.group(0) if phone else None,
            "account_no": account.group(0) if account else None, "bank": BANK_FULL.get(bank, bank) if bank else None}
    return one("payee_add", args)


def step(n: int, action: str, args: dict | None = None, **extra) -> StepOut:
    return StepOut(id=f"s{n}", action=action, args=args or {}, **extra)


def one(action: str, args: dict | None = None) -> PlanOut:
    return PlanOut(steps=[step(1, action, args)])


def ask(zh: str, en: str) -> PlanOut:
    return PlanOut(ask=AskOut(zh=zh, en=en))


def transactions(text: str, category: str | None, today: date, *, incoming: bool = False) -> PlanOut:
    days, span = None, span_from(text, today)
    if span is None and has(text, "上个月", "上月", "last month"):
        first = add_months(today.replace(day=1), -1)
        span = first, today.replace(day=1) - timedelta(days=1)
    if span is None and has(text, "一周", "7天", "七天", "week"):
        days = 7
    elif span is None and has(text, "今天", "today"):
        days = 1
    payee = None
    if m := re.search(r"(?:和|跟|与)\s*([一-龥]{2,4}?)(?:之间|的)", text) or re.search(r"\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)", text):
        payee = m.group(1)  # '我和张伟之间的转账记录', 'transfer history with Zhang Wei'
    elif has(text, "给", "to "):
        payee = payee_from(text)
    args = {}  # every match, a page at a time; a number caps it
    # '最近五笔交易', 'last 5 transactions'
    if m := re.search(r"(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*笔", text) or re.search(r"\blast (\d{1,2}) (?:transactions|payments)", text.lower()):
        args["limit"] = min(max(int(cn_number(m.group(1)) or 10), 1), 50)
    if category:
        args["category"] = category
    if payee:
        args["payee"] = payee
    # '我在星巴克的消费记录', 'payments at Starbucks'
    if m := re.search(r"在\s*([一-龥A-Za-z0-9]{2,12}?)\s*的?(?:消费|花|买|支付|付款)", text) \
            or re.search(r"\bat\s+([A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+)?)", text):
        args["merchant"] = m.group(1)
    if span:
        args["start"], args["end"] = span[0].isoformat(), span[1].isoformat()
    else:
        args["days"] = days or (90 if "merchant" in args else 30)  # one shop needs a longer look back
    if incoming:
        args["direction"] = "in"
    return one("transactions", args)


def payees_each(text: str) -> list[str]:
    """People who each get the same amount: '给爸爸妈妈各转500', '给张伟和王芳各转200'."""
    m = re.search(r"给\s*([一-龥、，, 和]{2,20}?)\s*各", text)
    if not m:
        return []
    chunk, people = m.group(1), []
    for word in RELATION_WORDS:
        if word in chunk:
            people.append(word)
            chunk = chunk.replace(word, " ")
    people += [p for p in re.split(r"[、，, 和]+", chunk) if len(p) >= 2]
    return people[:5] if len(people) >= 2 else []


HELP = ("我可以帮您：查余额和账单、分析消费、找出异常交易、转账和预约转账、AA 收款、管理银行卡、"
        "管理自动续费、查看和购买理财，以及把几件事串起来办（比如家人生日准备）。",
        "I can check balances and bills, analyse spending, spot unusual transactions, send or schedule transfers, "
        "split bills, manage cards and subscriptions, handle investments, and chain tasks together (like preparing for a birthday).")


def plan(text: str, today: date, *, pending_field: str | None = None, suspicious: bool = False,
         attachment: str | None = None) -> PlanOut:
    result = _with_receipt(text.strip(), attachment) if attachment else None
    result = result or _together(text.strip(), today, _plan(text.strip(), today, pending_field))
    result.suspicious = suspicious
    return result


# where one request ends and the next begins: '查余额，再看看有没有异常交易', 'freeze my card and show this month's spending'
JOINS = re.compile(r"[，,；;。]|顺便|另外|同时|然后|并且|再(?=帮|看|查|给|把|冻|取|开|关|申|买|转)|\balso\b|\bthen\b"
                   r"|\band\b(?=\s+(?:show|check|what|how|freeze|cancel|tell|list|give|send|turn|block|find))", re.IGNORECASE)


def area(action: str) -> str:
    """Which part of the bank an action belongs to: balance, spending, wealth, card, subscription, transfer..."""
    for prefix, name in (("wealth", "wealth"), ("card", "card"), ("subscription", "subscription"), ("transfer", "transfer"),
                         ("schedule", "transfer"), ("reserve", "reserve")):
        if action.startswith(prefix):
            return name
    return {"spending": "spending", "report": "spending", "analyze": "spending", "transactions": "spending"}.get(action, action)


def _together(text: str, today: date, whole: PlanOut) -> PlanOut:
    """Two or three requests in one message: each part is planned on its own, and the parts are kept only when every
    one of them is a request the planner understands by itself. Otherwise the message is read as a whole, as before."""
    if len(whole.steps) > 1:
        return whole
    parts = [p.strip() for p in JOINS.split(text) if p and len(p.strip()) >= 2]
    if not 2 <= len(parts) <= 3:
        return whole
    plans = [_plan(p, today, None) for p in parts]
    if any(len(p.steps) != 1 for p in plans):
        return whole  # a part that asks a question or is a plan of its own ('备注生活费', a birthday)
    if len({area(p.steps[0].action) for p in plans}) < len(plans):
        return whole  # two parts in the same area are one request said in two breaths ('我想理财，有什么推荐')
    steps, seen = [], set()
    for p in plans:
        key = (p.steps[0].action, repr(sorted(p.steps[0].args.items())))
        if key not in seen:
            seen.add(key)
            steps.append(step(len(steps) + 1, p.steps[0].action, p.steps[0].args))
    if len(steps) < 2 or (whole.steps and (whole.steps[0].action, repr(sorted(whole.steps[0].args.items()))) not in seen):
        return whole  # the whole message's own step leans on another part ('吃饭花了600，和张伟王芳AA' is one request)
    return PlanOut(steps=steps)


def _with_receipt(text: str, receipt: str) -> PlanOut | None:
    if has(text, "aa", "平摊", "分摊", "均摊", "split", "分一下", "分账"):
        people = names_in(text)
        if not people:
            return ask("和谁一起平摊这张小票？", "Who are you splitting this receipt with?")
        return one("collect", {"payees": people, "receipt": receipt})
    if not text or has(text, "小票", "收据", "账单", "看看", "多少", "receipt", "bill", "what", "read"):
        return one("read_receipt", {"receipt": receipt})
    return None


def _plan(text: str, today: date, pending_field: str | None) -> PlanOut:
    lowered = text.lower()
    money = amounts(text)

    # asking for a person; '客服已经批准了' only mentions one
    if has(text, "转人工", "人工客服", "人工服务", "找客服", "联系客服", "要客服", "接客服", "真人", "human", "real person",
           "operator", "talk to someone", "speak to someone", "talk to a person", "speak to a person", "customer service",
           "customer support", "agent please") or text.strip(" 。！!?？") in ("人工", "客服", "help desk"):
        return one("handoff", {"reason": text[:200]})

    # stopping a scheduled or monthly transfer, or a plan still waiting to run ('取消每月给妈妈的转账', '停止生日计划')
    stop = has(text, "取消", "停止", "停掉", "撤销", "不用再", "cancel", "stop", "undo", "call off")
    if stop and has(text, "转账", "汇款", "转", "transfer", "payment") \
            and has(text, "预约", "定时", "每月", "每个月", "按月", "自动", "安排的", "scheduled", "recurring", "monthly",
                    "every month", "standing order"):
        return one("scheduled_cancel", {"payee": payee_from(text)})
    if stop and (has(text, "计划", "安排", "plan") or (has(text, "生日", "birthday") and not money)):
        topic = next((w for w in ("生日", "birthday", "蛋糕", "cake", "花", "flower", "房租", "rent") if found(w, lowered)), None)
        return one("plan_cancel", {"plan": topic, "undo": has(text, "撤销", "退回", "还给我", "undo", "refund", "money back", "reverse")})

    # cross-scenario: birthday preparation
    if has(text, "生日", "birthday") and has(text, "准备", "安排", "预留", "花", "蛋糕", "礼物", "prepare", "plan", "flowers", "cake", "set aside", "gift",
                                          *(w for _, words in SHOPS for w in words)):
        who = next((w for w in RELATION_WORDS if found(w, lowered)), None)
        if who is None:
            return ask("请问是谁的生日？", "Whose birthday is it?")
        amount = money[0] if money else 1000
        before = 2
        if m := re.search(r"提前\s*(\d+|[一二两三四五六七])\s*天", text):
            before = int(m.group(1)) if m.group(1).isdigit() else CN_DIGITS[m.group(1)]
        elif has(text, "提前一周", "提前一个星期", "提前一个礼拜", "a week before", "a week early", "one week before"):
            before = 7
        elif m := re.search(r"\b(\d|one|two|three|four|five|six|seven) days? (before|early|ahead)", lowered):
            before = int(m.group(1)) if m.group(1).isdigit() else ["one", "two", "three", "four", "five", "six", "seven"].index(m.group(1)) + 1
        said, _ = when_from(re.sub(r"提前.{1,6}(天|周|星期|礼拜)", " ", text), today)
        day = said[:10] if said else "$s1.birthday"
        if said:
            order_day = date.fromisoformat(day) - timedelta(days=before)
            run_at = f"{order_day.isoformat()}T09:00" if order_day > today else None
        else:
            run_at = {"ref": "s1.birthday", "offset_days": -min(before, 60)}
        steps = [step(1, "contact_lookup", {"who": who}),
                 step(2, "reserve_create", {"amount_yuan": amount, "name": "生日礼物" if re.search(r"[一-龥]", text) else "Birthday gift",
                                            "month_of": day}, after=["s1"])]
        named = [shop for shop, words in SHOPS if has(text, *words)] or ["florist", "bakery"]
        for n, merchant in enumerate(named[:5], start=3):
            steps.append(step(n, "merchant_order", {"merchant": merchant, "deliver_on": day, "recipient": who,
                                                    "pay_from": "$s2.reserve_id"}, after=["s1", "s2"], run_at=run_at))
        return PlanOut(steps=steps)

    # cards; '健身卡下次扣钱前提醒我' is a subscription, said with the word 卡
    if has(text, "卡", "card") and not (any(n in lowered for n in SUB_NAMES)
                                        and has(text, "提醒", "续费", "扣钱", "扣费", "扣款", "remind", "renew")):
        hint = card_hint(text)
        if has(text, "余额", "多少钱", "还有多少", "balance") and not has(text, "限额", "额度", "limit"):
            return one("balance")
        if has(text, "挂失") or re.search(r"\breport\b.{0,30}\b(lost|stolen)\b", lowered):
            return one("card_report_lost", {"card": hint})
        if has(text, "盗刷", "可疑", "异常", "不认识", "不是我", "fraud", "suspicious", "unusual", "don't recognise", "don't recognize",
               "without permission", "unauthorized", "unauthorised", "wasn't me", "not me") \
                and not has(text, "冻结", "锁卡", "锁定", "freeze", "lock", "block"):
            return one("anomalies")  # 'fraud on my card statement': look first; the reply offers a freeze
        if has(text, "丢了", "丢失", "遗失", "被偷", "不见了", "lost", "stolen", "missing"):
            return one("card_freeze", {"card": hint})  # implicit intent: protect first; the reply offers a loss report
        if has(text, "解冻", "解锁", "unfreeze", "unlock", "unblock"):
            return one("card_unfreeze", {"card": hint})
        if has(text, "冻结", "锁卡", "锁定", "停一下", "先停", "暂停", "停一停", "freeze", "lock", "block", "pause"):
            return one("card_freeze", {"card": hint})
        if has(text, "限额", "额度", "limit"):
            if not money and has(text, "多少", "是什么", "查", "看", "what", "how much", "show"):
                return one("cards")  # '我的虚拟卡日限额是多少' asks; it changes nothing
            amount = money[0] if money else None
            return one("card_limit", {"card": hint, "daily_limit_yuan": amount})
        if switches := switches_in(text, card=True):
            return one("card_restrict", {"card": hint, **switches})
        # implied: '下周出国玩要刷卡' means overseas payments switched on (the card then asks for strong verification)
        if has(text, "出国", "去国外", "出境", "abroad", "going overseas", "trip overseas") \
                and has(text, "刷卡", "用卡", "能刷", "能用", "use my card", "use the card", "pay with") \
                and not has(text, *SWITCH_OFF, "记录", "明细", "花了", "多少", "history", "how much"):
            return one("card_restrict", {"card": hint, "overseas": True})
        if has(text, "申请", "办", "开一张", "apply", "get a", "new", "need a", "want a"):
            return one("card_apply", {"kind": "debit" if has(text, "实体", "借记", "debit", "physical") else "virtual"})
        if not has(text, "转", "transfer", "send"):
            return one("cards")

    # card switches named without the word 'card': '关闭境外交易', 'turn off overseas payments'
    if (switches := switches_in(text)) and not has(text, "转", "transfer", "send"):
        return one("card_restrict", {"card": card_hint(text), **switches})

    # payees: adding one, or the list ('Who can I pay?')
    if has(text, "添加收款人", "新增收款人", "加个收款人", "加一个收款人", "新收款人", "保存收款人", "存为收款人", "加为收款人",
           "add a payee", "add payee", "new payee", "save a payee", "as a payee") \
            and not has(text, "转", "汇", "付", "transfer", "send", "pay "):
        return new_payee(text)
    if has(text, "收款人", "联系人", "payees", "contacts", "who can i pay", "who can i send", "people i can pay",
           "people i pay") and not money:
        return one("payees")

    if has(text, "密码", "password", "pin"):
        if has(text, "交易密码", "支付密码", "pin"):
            return one("pin_change")
        if has(text, "改", "修改", "重置", "换", "change", "reset", "update"):
            return one("password_change")

    # subscriptions and direct debits
    sub = next((name for name in SUB_NAMES if name in lowered), None)
    if sub is None and has(text, "订阅", "会员", "subscription", "membership", "service"):
        sub = next((kind for kind, words in (("音乐", ("音乐", "music")), ("视频", ("视频", "video", "streaming")))
                    if has(text, *words)), None)
    renewal = has(text, "续费", "扣费", "扣款", "订阅", "会员", "renew", "subscription", "membership", "charge")
    if sub and has(text, "取消", "退订", "关闭", "不要", "退了", "退掉", "不看了", "不听了", "不用了", "不续了", "别续",
                   "cancel", "unsubscribe", "stop"):
        return one("subscription_cancel", {"merchant": sub})
    if has(text, "提醒", "remind") and (sub or renewal):
        days = next((int(m) for m in re.findall(r"(\d+)\s*(?:天|days?)", lowered)), 3)
        return one("subscription_remind", {"merchant": sub, "days_before": min(max(days, 1), 30)})
    if has(text, "订阅", "自动续费", "自动扣费", "自动扣款", "代扣", "会员", "subscription", "membership", "recurring",
           "direct debit", "auto-renew", "paying twice", "pay twice", "paying for two", "paying for the same",
           "paying for every month", "pay for every month", "pay every month", "paying every month", "monthly charges",
           "每月扣", "每个月扣", "每月都扣", "每个月都扣", "固定支出", "固定开销", "固定扣") \
            or re.search(r"每个?月.{0,4}(?:被扣|扣了|扣的|扣哪)", text):
        if has(text, "取消", "退订", "不要", "cancel", "unsubscribe", "stop") and sub is None:
            # a service the customer names but doesn't have ('取消Netflix会员') is refused by the bank's records
            named = re.search(r"(?:取消|退订|不要)掉?\s*(?:那个|这个)?\s*([A-Za-z0-9一-龥]{2,12}?)\s*的?(?:会员|订阅|自动续费|连续包月)", text) \
                or re.search(r"(?:cancel|stop)\s+(?:my\s+|the\s+|that\s+)?([a-z0-9 ]{2,20}?)\s+(?:subscription|membership)", lowered)
            return one("subscription_cancel", {"merchant": named.group(1).strip() if named else None})
        return one("subscriptions")

    # split bill: the progress question first, since '谁还没付AA的钱' also says AA
    if has(text, "收款进度", "谁还没付", "collections", "who has paid", "who hasn't paid", "who still owes") or (
            has(text, "还没付", "没给钱", "没转", "paid me") and has(text, "aa", "收款", "平摊", "分摊", "split")):
        return one("collections")
    if has(text, "aa", "平摊", "分摊", "均摊", "split"):
        people = names_in(text)
        if not people:
            return ask("和谁一起平摊？", "Who are you splitting it with?")
        args = {"payees": people}
        if purpose := re.search(r"(电费|水费|水电费|网费|燃气费|房租|饭钱|餐费|车费|打车费|话费|酒店|门票|机票|火车票|火锅|聚餐|晚饭|午饭|外卖|蛋糕)", text) \
                or re.search(r"\b(electricity|water|internet|gas|rent|dinner|lunch|taxi|hotel|tickets|groceries|takeaway)\b", lowered):
            args["title"] = purpose.group(1)
        if money:
            args["total_yuan"] = money[0]
        else:
            merchant = next((m for m in ("海底捞", "火锅", "美团", "星巴克", "haidilao", "hotpot", "dinner") if found(m, lowered)), None)
            if merchant:
                args["from_merchant"] = {"火锅": "海底捞", "haidilao": "海底捞", "hotpot": "海底捞", "dinner": "海底捞"}.get(merchant, merchant)
        return one("collect", args)

    # anomalies
    if has(text, "异常", "可疑", "陌生", "不认识", "盗刷", "奇怪", "重复扣款", "重复扣费", "扣了两次", "多扣", "suspicious", "unusual",
           "fraud", "anomal", "strange", "weird", "odd charge", "don't recognise", "don't recognize", "double charged", "charged twice", "duplicate charge"):
        return one("anomalies")

    # reserves, before wealth: '预留2000元旅游基金' is money set aside, not a fund purchase
    pot = not product_words(text) and (
        re.search(r"(存到|存进|放到|放进|转到|转进|攒到)\s*[一-龥]{0,6}(基金|资金|备用金|小金库)", text)
        or re.search(r"\b(put|move|save)\b.{0,20}\binto (a|my|the) [a-z ]{0,20}(fund|pot)\b", lowered))
    if pot or has(text, "预留", "存出来", "留出", "set aside", "put aside", "reserve"):
        if has(text, "释放", "退回", "取消", "release", "return"):
            return one("reserve_release")
        if money:
            label = re.search(r"([一-龥]{2,4}(?:基金|资金|备用金))", re.sub(r"(存到|存进|放到|放进|转到|转进|攒到|预留)", " ", text))
            english = re.search(r"into (?:a|my|the) ([a-z ]{0,20}(?:fund|pot))\b", lowered)
            name = label.group(1) if label else english.group(1).capitalize() if english else \
                "预留资金" if re.search(r"[一-龥]", text) else "Savings pot"
            return one("reserve_create", {"amount_yuan": money[0], "name": name})
        return one("reserves")

    # wealth; '我的风险等级是什么' is a question (the holdings answer includes the risk profile)
    if has(text, "风险等级", "风险承受", "承受多大风险", "能承受多少风险", "risk level", "risk tolerance", "how much risk",
           "what's my risk", "what is my risk") \
            and not has(text, "测评", "评估", "重新", "重做", "redo", "retake", "update", "questionnaire"):
        return one("wealth_holdings")
    if has(text, "风险测评", "风险评估", "测评", "risk assessment", "risk profile", "risk questionnaire"):
        return one("risk_assessment")
    if has(text, "赎回", "卖出", "redeem", "sell"):
        products = product_words(text)
        return one("wealth_redeem", {"product": products[0] if products else None, "amount_yuan": money[0] if money else None})
    if has(text, "对比", "比较", "哪个好", "哪个更好", "哪一个好", "有什么区别", "区别", "compare", "which is better",
           "which one is better", "difference between", " vs "):
        products = product_words(text)
        if len(products) >= 2:
            return one("wealth_compare", {"products": products[:4]})
        if has(text, "理财", "产品", "基金", "product", "fund", "invest"):
            return one("wealth_products")
    if has(text, "能买", "可以买", "有什么理财", "有哪些理财", "what can i buy", "what can i invest", "which products", "what products"):
        return one("wealth_products")
    if has(text, "推荐", "买什么", "买啥好", "买点啥好", "投啥好", "放哪好", "放哪里好", "怎么理财", "理财建议",
           "recommend", "suggest", "what should i invest", "where should i put") \
            or (has(text, "闲钱") and has(text, "放", "买", "投", "理财")) \
            or (money and has(text, "what should i buy", "what to buy", "what to do with")):
        horizon = 12
        if has(text, "三年", "3年", "3 years", "three years", "长期", "long term"):
            horizon = 36
        elif has(text, "半年", "6个月", "six months", "6 months"):
            horizon = 6
        elif has(text, "三个月", "3个月", "3 months", "短期", "short term"):
            horizon = 2
        return one("wealth_recommend", {"amount_yuan": money[0] if money else None, "horizon_months": horizon})
    if has(text, "申购", "买", "buy", "invest in") and (product_words(text) or has(text, "基金", "理财", "fund")):
        products = product_words(text)
        if not products:
            if has(text, "稳健", "低风险", "保本", "安全", "稳一点", "高收益", "收益高", "low-risk", "low risk", "safe", "steady", "high return"):
                return one("wealth_recommend", {"amount_yuan": money[0] if money else None, "horizon_months": 12})
            return ask("要购买哪一款产品？", "Which product would you like to buy?")
        return one("wealth_subscribe", {"product": products[0], "amount_yuan": money[0] if money else None})
    if has(text, "理财产品", "有哪些产品", "products", "funds available"):
        return one("wealth_products")
    if has(text, "理财", "基金", "收益", "持仓", "投资", "investment", "portfolio", "holdings", "returns", "funds"):
        return one("wealth_holdings")

    # stopping a delayed transfer before it arrives: '撤销刚才给周凯的转账', 'cancel the transfer to Zhou Kai'
    if has(text, "撤销", "撤回", "取消", "退回来", "cancel", "recall", "stop", "undo", "take back", "reverse") \
            and (has(text, "转账", "汇款", "transfer") or re.search(r"刚才|刚刚|上一笔|那笔|这笔", text)) \
            and not has(text, "预约", "定时", "每月", "scheduled", "recurring"):
        ref = re.search(r"#([0-9a-f]{6,})", lowered)
        return one("transfer_cancel", {"transfer": ref.group(1) if ref else payee_from(text)})

    # history, before transfers and spending: '转账记录' and '消费明细' are lists to look at
    category = next((c for c, words in CATEGORY_WORDS if has(text, *words)), None)
    incoming = has(text, "收到", "到账", "进账", "收入", "工资", "received", "income", "incoming", "salary") \
        and not (STANDARD_ARRIVAL.search(lowered) or NEXT_DAY_ARRIVAL.search(lowered) or "实时到账" in text)
    if incoming or has(text, "记录", "明细", "流水", "清单", "history", "records") \
            or re.search(r"转了(多少|几|哪些)|转过|付了(多少|几)", text):  # '上周给妈妈转了多少钱' asks about the past
        return transactions(text, category, today, incoming=incoming)

    # transfers
    if has(text, "预约转账", "定时转账", "scheduled transfer") and has(text, "查看", "看看", "看一下", "有哪些", "哪些", "我的", "list", "show", "what", "my", "upcoming"):
        return one("scheduled")
    if "各" in text and money and (people := payees_each(text)):
        return PlanOut(steps=[step(i + 1, "transfer", {"payee": p, "amount_yuan": money[0]}) for i, p in enumerate(people)])
    colloquial = re.search(r"给\s*[一-龥]{1,4}?\s*打\s*[\d零一二两三四五六七八九十百千万]"  # '给王芳打300块'
                           # '还他600'; '还有一百万', '还剩五千' are not repayments
                           r"|还(?!有|剩|是|要|在|没|能)(?:给)?\s*(?:他|她|[一-龥]{2,3}?)\s*[\d零一二两三四五六七八九十百千万]", text)
    if (colloquial or re.search(r"[交付缴].{0,6}房租|房租.{0,3}[交付缴]", text) or has(text, "转", "汇", "打钱", "打款", "付给", "还钱", "交租",
                                                                     "transfer", "send", "pay ", "wire")) \
            and not has(text, "转人工"):
        # '给妈妈转200，再给爸爸转300': one step per clause that names both a person and an amount
        clauses = [c for c in re.split(r"[，,；;。]|再|然后|并且|另外|和(?=给)|\band then\b|\bthen\b", text) if c.strip()]
        pairs = [(payee_from(c), amounts(c)) for c in clauses]
        pairs = [(p, a[0]) for p, a in pairs if p and len(a) == 1]
        if len(pairs) >= 2 and len({p for p, _ in pairs}) == len(pairs) and not when_from(text, today)[0]:
            return PlanOut(steps=[step(i + 1, "transfer", {"payee": p, "amount_yuan": a}) for i, (p, a) in enumerate(pairs)])
        payee = payee_from(text) or ("房东" if has(text, "房租", "交租", "rent") else None)
        amount = money[0] if money else None
        # '转-100' or '转200.555': ask for the amount rather than send ¥100 or ¥200.55
        if unclear_amount(text):
            amount = None
        if payee is None:
            return ask("请问要转给谁？", "Who should I send it to?")
        memo = None
        by_note = re.search(r"(?:备注|标签)(?:是|为|叫)?\s*\S{2,10}?的(?:人|那位|那个人|收款人)", text)
        if m := (None if by_note else re.search(r"(?:备注|附言|用途)[:：\s]*([一-龥A-Za-z0-9]{1,20})", text)) \
                or re.search(r"\bfor (rent|dinner|lunch|bills|groceries)\b", lowered):
            memo = m.group(1)
        elif has(text, "房租", "交租"):
            memo = "房租"  # with no amount, the bank fills in the last rent and says so on the card
        elif re.search(r"\brent\b", lowered):
            memo = "rent"
        # arrival choice: '普通到账' / '2小时后到账' / '次日到账'; '明天到账' is not a transfer scheduled for tomorrow
        arrival = "instant"
        if m := STANDARD_ARRIVAL.search(lowered):
            arrival = "standard"
        elif m := NEXT_DAY_ARRIVAL.search(lowered):
            arrival = "next_day"
        when, repeat = when_from(re.sub(re.escape(m.group(0)), " ", text, flags=re.IGNORECASE) if arrival != "instant" else text,
                                 today)
        if when:
            return one("schedule_transfer", {"payee": payee, "amount_yuan": amount, "when": when, "repeat": repeat, "memo": memo})
        args = {"payee": payee, "amount_yuan": amount, "memo": memo}
        if arrival != "instant":
            args["arrival"] = arrival
        return one("transfer", args)

    # open-ended questions: generated analysis code, run in the sandbox
    code = templates.from_question(text, today)
    if code and has(text, "花", "消费", "多少", "几次", "次数", "平均", "spend", "spent", "how much", "how many", "how often", "average"):
        return one("analyze", {"question": text[:300], "code": code, "days": 730})  # the template filters exact dates

    # spending, reports, history
    year = has(text, "年", "year", "annual")
    offset = -1 if has(text, "上个月", "上月", "去年", "last month", "last year", "previous") else 0
    if has(text, "比上个月", "和上个月比", "跟上个月比", "环比", "compared to last month", "vs last month"):
        return one("report", {"period": "month", "offset": 0})  # this month's report compares it with the last
    if has(text, "比前个月", "比前一个月", "比上上个月", "多花了多少", "少花了多少", "than the month before", "compared with the month before"):
        return one("report", {"period": "month", "offset": -1 if has(text, "上个月", "上月", "last month") else 0})
    if has(text, "报告", "总结", "报表", "月报", "年报", "占比", "比例", "share of", "年度账单", "月度账单", "年账单", "report", "summary", "review") \
            or re.search(r"账单.{0,4}(出|生成|做|整理).{0,2}(份|个|下)|(出|生成|做|整理)(一?份|个).{0,4}账单", text):  # '账单给我出一份'
        return one("report", {"period": "year" if year else "month", "offset": offset if (offset or year or has(text, "本月", "这个月", "this month", "今年", "this year")) else -1})
    if has(text, "习惯", "分析", "花太多", "花得太多", "花多了", "habits", "analyse my", "analyze my", "spending too much",
           "spend too much") and has(text, "花", "消费", "支出", "开销", "spend", "expens", "money"):
        overall = year or has(text, "习惯", "整体", "全部", "所有", "habits", "overall", "history")
        return one("report", {"period": "year" if overall else "month", "offset": 0})
    if has(text, "花了", "消费", "支出", "开销", "花销", "花太多", "花得", "花钱", "花哪", "花在哪", "where did my money go", "where's my money going", "where is my money going", "spend", "spent", "spending", "expenses"):
        span = None if has(text, "今年", "去年", "this year", "last year") else span_from(text, today)
        if span:  # '上周花了多少', '最近三个月花得最多的是什么'
            return one("spending", {"period": "custom", "start": span[0].isoformat(), "end": span[1].isoformat(),
                                    "category": category})
        return one("spending", {"period": "year" if year else "month", "offset": offset, "category": category})
    if has(text, "交易", "账单", "transactions", "statement", "payments"):
        return transactions(text, category, today)
    if has(text, "余额", "多少钱", "还有多少", "还剩", "剩多少", "剩下多少", "几个钱", "存款", "balance", "how much money",
           "how much do i have", "account"):
        return one("balance")
    if has(text, "收款人", "联系人", "payees", "contacts"):
        return one("payees")
    if has(text, "提醒", "通知", "notifications", "reminders", "alerts"):
        return one("notifications")

    # a bare answer to an open question
    if pending_field == "amount_yuan" and money:
        return PlanOut()
    if re.fullmatch(r"(?:你好|您好|嗨|哈喽|在吗|hi|hello|hey)[呀啊，,！!。.\s]*", lowered):
        return ask("您好！" + HELP[0], "Hello! " + HELP[1])
    return ask(HELP[0], HELP[1])
