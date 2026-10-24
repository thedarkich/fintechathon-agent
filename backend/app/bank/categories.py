"""Spending categories from merchant names and transaction kinds (keyword rules, explainable)."""

import unicodedata

LABELS = {
    "income": ("收入", "Income"),
    "housing": ("住房", "Housing"),
    "utilities": ("生活缴费", "Utilities & phone"),
    "dining": ("餐饮", "Dining"),
    "groceries": ("买菜超市", "Groceries"),
    "shopping": ("购物", "Shopping"),
    "transport": ("交通", "Transport"),
    "travel": ("旅行", "Travel"),
    "entertainment": ("娱乐", "Entertainment"),
    "digital": ("会员订阅", "Digital subscriptions"),
    "health": ("医疗健康", "Health & fitness"),
    "family": ("家人", "Family"),
    "transfer": ("转账", "Transfers"),
    "gifts": ("礼物", "Gifts"),
    "wealth": ("理财", "Investments"),
    "internal": ("内部划转", "Internal moves"),
    "other": ("其他", "Other"),
}

# First match wins; more specific names come first.
RULES = [
    ("digital", ("腾讯视频", "爱奇艺", "优酷", "网易云音乐", "qq音乐", "百度网盘", "wps", "bilibili",
                 "哔哩哔哩", "icloud", "apple.com/bill", "keep会员", "京东plus", "88vip", "芒果tv")),
    ("health", ("健身", "药房", "医院", "诊所", "大药房", "体检", "fitness")),
    ("utilities", ("国家电网", "水务", "燃气", "中国移动", "中国联通", "中国电信", "物业")),
    ("dining", ("美团外卖", "饿了么", "瑞幸", "星巴克", "海底捞", "喜茶", "肯德基", "麦当劳",
                "蜜雪冰城", "茶颜悦色", "餐厅", "火锅", "luckin", "starbucks", "外卖")),
    ("groceries", ("盒马", "永辉", "超市", "中百", "钱大妈", "叮咚买菜")),
    ("travel", ("携程", "12306", "航空", "酒店", "飞猪", "去哪儿")),
    ("transport", ("滴滴", "地铁", "武汉通", "加油", "中石化", "中石油", "停车", "高德打车")),
    ("entertainment", ("猫眼", "淘票票", "ktv", "steam", "电影", "游戏")),
    ("gifts", ("鲜花", "蛋糕", "florist", "bakery", "花间", "麦香", "心意礼品")),
    ("shopping", ("淘宝", "天猫", "京东", "拼多多", "优衣库", "数码", "amzn", "amazon", "唯品会",
                  "得物", "专营店", "旗舰店")),
]


def normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text or "").casefold().replace(" ", "")


def categorize(counterparty: str, kind: str, *, relationship: str | None = None) -> str:
    if kind in {"salary", "transfer_in", "refund"}:
        return "income" if kind == "salary" else "transfer"
    if kind == "internal":
        return "internal"
    if kind == "wealth":
        return "wealth"
    if kind == "transfer_out":
        if relationship in {"mother", "father", "spouse", "child", "sibling"}:
            return "family"
        if relationship == "landlord":
            return "housing"
        return "transfer"
    name = normalize(counterparty)
    for category, words in RULES:
        if any(word in name for word in words):
            return category
    return "other"


def label(category: str, lang: str) -> str:
    zh, en = LABELS.get(category, LABELS["other"])
    return zh if lang == "zh" else en
