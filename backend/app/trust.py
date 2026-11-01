"""Merchant review credibility: rules decide, the model never touches this.

The map services hand us a rating and an average spend, but no review text, so the reviews read here are
generated deterministically from the place id — the same place gives the same reviews on every machine, and
the reply says plainly that they are simulated. What is not simulated is the engine: the three rules, the
thresholds, the fail-closed trusted-source check, the aggregate veto and the verdict are ordinary code, and
every step of it goes into the audit log like any other action.

Why a rule engine and not the model: a model can be talked into trusting a review; this cannot, because the
customer never sees a number the code did not compute, and the model never sees a review at all.
"""

import hashlib
import random
import re
from collections import defaultdict
from datetime import datetime, timedelta
from difflib import SequenceMatcher

# --- the vocabulary the rules explain themselves with -----------------------------------------------

EXAGGERATION = ["绝绝子", "yyds", "永远的神", "天花板", "封神", "无敌", "爆赞", "吹爆", "宝藏店", "不吃后悔", "巨好吃",
                "好吃到哭", "王炸", "逆天", "顶级"]
GENERIC = ["强烈推荐", "太好吃了", "下次还来", "下次再来", "必须来", "五星好评", "值得一试", "必吃", "超好吃", "好吃不贵"]
DETAILS = ["排队", "等位", "分量", "人均", "停车", "地铁", "空调", "包间", "辣度", "上菜", "食材", "新鲜", "服务员", "老板"]
# 从店名和类别里认菜：在牛肉火锅店底下写"铜炉鸡"就是假数据露馅的地方
DISH_BY_WORD = [
    ("鸡公煲", ("鸡公煲的鸡肉很嫩", "煲里的土豆吸满汤汁", "配菜比肉还好吃")),
    ("鸡锅", ("鸡肉是先炒后焖的", "锅底的酱香偏重", "配菜吸味，记得别煮太久")),
    ("铜炉", ("鸡肉是先炒后焖的", "锅底的酱香偏重", "配菜吸味，记得别煮太久")),
    ("牛蛙", ("牛蛙现杀，肉是散的", "蛙腿肉厚", "锅底偏咸，要加汤")),
    ("小龙虾", ("小龙虾是活的", "蒜蓉比十三香好吃", "给的汤汁能拌面")),
    ("涮肉", ("羊肉是手切的", "麻酱是现调的", "糖蒜解腻")),
    ("寿司", ("寿司米偏酸", "刺身给得厚", "套餐分量小")),
    ("奶茶", ("茶底不齁", "三分糖刚好", "晚上去要等单")),
    ("粤菜", ("烧鹅皮脆", "白切鸡有姜葱", "点心现蒸")),
    ("烤肉", ("肉是自己烤的", "生菜包着吃不腻", "排烟一般，出来一身味")),
    ("椰子鸡", ("椰子鸡锅底清甜", "鸡肉紧实不柴", "配的海底椰很香")),
    ("海鲜", ("海鲜是活的现称", "虾贝处理得干净", "加工费提前说清楚了", "冰台看着新鲜")),
    ("潮汕", ("牛肉是现切的", "吊龙涮八秒", "沙茶酱是自家调的")),
    ("牛肉火锅", ("牛肉是现切的", "吊龙涮八秒刚好", "牛骨清汤锅底越煮越鲜")),
    ("酸汤", ("酸汤锅底开胃", "牛肉蘸糊辣椒", "送的冰浆解辣")),
    ("火锅", ("锅底越煮越香", "毛肚脆", "虾滑Q弹", "涮鸭肠要快")),
    ("烤鱼", ("烤鱼皮焦肉嫩", "配菜吸味", "辣度可以选")),
    ("干锅", ("干锅越吃越入味", "配菜给得多", "吃到后面有点糊底")),
    ("米线", ("米线现煮不糊", "加辣子好吃", "分量足")),
    ("蛋糕", ("奶油是动物奶油", "胚体不噎人", "定做的字写得很清楚")),
    ("面包", ("可颂层次多", "吐司软", "下午去热门款容易售罄")),
    ("烧烤", ("肉串火气足", "烤茄子一般", "啤酒是冰的")),
    ("咖啡", ("豆子偏酸", "出杯快", "座位不多")),
    ("日料", ("刺身新鲜", "寿司偏甜", "上菜慢")),
    ("茶餐厅", ("菠萝油酥脆", "丝袜奶茶偏甜", "饭点要等位")),
]
FALLBACK_DISHES = ("东西本身没问题", "给的量实在", "比想象中细致", "该带的都带齐了")
CAKE = ("奶油是动物奶油", "胚体不噎人", "定做的字写得很清楚", "点了三分甜刚好", "冰袋拎回家没化", "切块不空心")
FLOWER = ("花很新鲜，第三天还开着", "包花纸搭得好看", "花苞多，开得久", "开业花篮做得规整", "枝叶没有烂的")
COFFEE = ("豆子偏酸", "出杯快", "座位不多", "外带杯盖没漏", "拉花好看")
# 店型：先看店名，再看地图给的类别；认不出就退回中性词，绝不硬安菜品
SHOP_TYPES = [
    ("烘焙", ("蛋糕", "糕饼", "饼店", "面包", "烘焙", "甜品", "甜点", "cake", "bakery", "dessert", "pastry"), CAKE),
    ("花店", ("花店", "花行", "花卉", "鲜花", "花市", "花艺", "flower", "florist"), FLOWER),
    ("咖啡", ("咖啡", "coffee", "cafe", "咖啡馆"), COFFEE),
]
# 真实评论的骨架：一条通常说 2-4 件事，带具体数字
FACETS = {
    "等位": ("饭点等了{n}分钟才坐上", "取号取了将近1小时", "不排队，直接进"),
    "服务": ("老板会问要不要加辣", "服务员主动添水", "上菜慢，催了两次", "店员推荐很实在，没让多点"),
    "环境": ("店里装修有氛围，座位宽敞", "老店环境一般但干净", "靠窗位置舒服", "包间隔音还行"),
    "人均": ("人均{p}左右", "两个人吃了{p2}，还行", "比同价位几家划算"),
    "交通": ("地铁直达，出站就是", "门口不好停车，停在隔壁商场", "走路十分钟到"),
    "分量": ("分量足，两个人点三个菜够了", "肉给得不手软", "后半程配菜有点咸"),
}
FACETS_BY_TYPE = {
    "烘焙": {"取货": ("节假日得提前一天订", "取货排了{n}分钟", "预约的时间点刚好处处有货"),
             "服务": ("老板按人数给建议，没让多买", "包装系了蝴蝶结，还给了冰袋"),
             "口味": ("甜度刚好，不齁", "奶油不腻", "胚体偏干，配茶刚好"),
             "价格": ("一个{p}，比连锁店实在", "两个人吃一个刚够"),
             "环境": ("冷柜看着干净", "店里能坐下吃"),
             "交通": ("地铁直达，出站就是", "门口不好停车，停在隔壁商场")},
    "花店": {"时效": ("约的九点送到，八点四十就到了", "开业时间赶上了", "急单也接了"),
             "服务": ("老板问了我预算和场合", "帮我换了两枝打蔫的", "留了养护说明"),
             "品质": ("第三天花还开着", "剪了枝插水里又开了半个月", "花苞多，开得久"),
             "价格": ("一束{p}，比线上靠谱", "开业花篮这个价合理"),
             "环境": ("店面不大但花新鲜", "样品摆得整齐"),
             "交通": ("离学校近，走过去十分钟", "送过来停在门口，没影响营业")},
    "咖啡": {"出杯": ("出杯快，没等", "点了要等{n}分钟"),
             "口味": ("豆子偏酸", "拿铁奶泡细", "特调不齁"),
             "环境": ("座位不多但能坐一下午", "有插座，适合带电脑"),
             "价格": ("一杯{p}，在这个地段合理"),
             "交通": ("顺路，地铁站出来就是", "不好停车")},
}
USERS = ("wx_5h2VZP", "匿名用户", "海朋友互点赞", "小富婆", "赤良图", "wx_KH_z81", "TZeef", "咖喱海鲜", "文同学",
         "匿名用户", "wx_9fQ2", "深夜食堂常客")
FACETS_NEUTRAL = {
    "服务": ("老板人实在，问什么都是", "店员没推销", "说好的时间做到了"),
    "环境": ("店面干净", "去的时候人不多", "东西摆得整齐"),
    "价格": ("花的钱和值不值，心里有数", "比隔壁标得清楚，{p}"),
    "交通": ("位置好找", "门口能临时停一下车", "走路十分钟到"),
    "时间": ("去了等了一会儿", "提前打过电话，去了就直接办"),
}
THEMES = (("等位", ("等", "排队", "取号", "号")), ("口味", ("嫩", "香", "鲜", "入味", "辣", "汤", "锅", "好吃", "甜")),
          ("环境", ("环境", "装修", "座位", "干净", "氛围", "包间")), ("服务", ("服务员", "老板", "态度", "加辣", "添水", "店员")),
          ("分量", ("分量", "够了", "不手软", "点三个菜")), ("交通", ("地铁", "停车", "走路", "出站")))

# Text that tries to instruct an agent through data. Reviews are untrusted input, like a receipt is.
INJECTION = [r"忽略(之前|以上|所有).{0,6}(规则|指令|提示)", r"(转账|付款|打款)\s*(给|至)\s*\S{1,20}",
             r"(system|SYSTEM|系统提示|管理员|开发者模式|越权)", r"(不需要|跳过|关闭).{0,4}(确认|验证|密码|验证码)",
             r"(验证码|交易密码|api[_ ]?key|密钥)"]

# A review only counts as trusted when our own fetch layer signed its source; a flag inside the data never does.
TRUSTED_PROVENANCE = {"amap_saijie_verified", "in_app_verified_visit"}


def _norm(text):
    return re.sub(r"[^一-鿿a-zA-Z0-9]", "", str(text or "")).lower()


def _similarity(a, b):
    return SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def profile_for(place):
    """What a review of this place may talk about — its own dishes (or flowers) and its own kind of facets.

    Read off the place's own name and category, so a cake shop never gets 凉菜 and a florist never gets
    上菜慢. Unrecognised places fall back to neutral wording, never to food.
    """
    words = f"{place.get('name') or ''}{place.get('category') or ''}".lower()
    raw = f"{place.get('name') or ''}{place.get('category') or ''}"
    for kind, keys, options in SHOP_TYPES:
        if any(k.lower() in words for k in keys):
            return options, FACETS_BY_TYPE[kind]
    for key, options in DISH_BY_WORD:        # 餐饮：先按具体品类认菜
        if key in raw:
            return options, FACETS
    if any(w in raw for w in ("餐", "饭", "菜", "店", "馆", "厅", "厨", "粉", "面", "restaurant")):
        return FALLBACK_DISHES, FACETS       # 是吃饭的地方，但认不出菜系
    return FALLBACK_DISHES, FACETS_NEUTRAL


def reviews_for(place):
    """Deterministic simulated reviews for one place: same id in, same reviews out, on any machine.

    Shaped like the real thing on purpose (long and short, star rating, days ago, 到店 or not, photo count),
    because a rule that only catches one obvious pattern is not worth demonstrating. The dishes named come
    from the place itself, so a beef-hotpot shop never gets a chicken-pot review.
    """
    seed = int(hashlib.sha256(str(place.get("id", "")).encode()).hexdigest()[:12], 16)
    rng = random.Random(seed)
    rating = place.get("rating")
    # A ring is planted only where a ring would be believed: a very high public rating. Which places those are
    # is fixed by the id, not by chance at run time, so a demo never changes under the speaker.
    ring = rating is not None and rating >= 4.6 and seed % 2 == 0
    count = rng.choice((10, 12, 14))
    day = datetime(2026, 10, 20) + timedelta(days=seed % 7)
    dishes, facets = profile_for(place)
    cost = place.get("cost_yuan")
    base = int(cost) if isinstance(cost, (int, float)) and cost else rng.randint(4, 15) * 10
    used = set()
    used_clauses = set()
    spam = (f"{rng.choice(EXAGGERATION)}！这家真的是{rng.choice(EXAGGERATION)}，"
            f"{rng.choice(GENERIC)}，{rng.choice(GENERIC)}！")
    out = []
    for i in range(count):
        fake = ring and i < max(4, count // 2)
        if fake:
            # a batch lands inside minutes of each other, on the same template, with no visit behind it
            stamp = day + timedelta(minutes=i // 2, seconds=10 * i)
            text = spam if i % 3 else spam + "！"
            stars, visited, photos = 5, False, 0
            user = rng.choice(("匿名用户", "wx_5h2VZP", "新用户"))
        else:
            days = rng.randint(1, 90)
            stamp = day - timedelta(days=days, hours=rng.randint(0, 9))
            for _ in range(6):  # 别在一家店里造出两条几乎一样的真话，那会被自己的 R2 误伤
                picks = rng.sample(list(facets), rng.choice((2, 3, 3, 4)))
                dish = rng.choice(dishes)
                clauses = []
                for k in picks:
                    pool = [c for c in facets[k] if c not in used_clauses] or list(facets[k])
                    pick = rng.choice(pool)
                    used_clauses.add(pick)
                    clauses.append(pick)
                if (dish, tuple(sorted(clauses))) not in used:
                    used.add((dish, tuple(sorted(clauses))))
                    break
            parts = [dish] + clauses
            text = "，".join(parts[:2]) + "。" + "，".join(parts[2:]) + "。" if len(parts) > 2 else "，".join(parts) + "。"
            price = max(10, int(base * rng.uniform(0.85, 1.25)) // 5 * 5)
            text = (text.replace("{n}", str(rng.choice((20, 30, 40, 50))))
                        .replace("{p2}", str(price * 2)).replace("{p}", str(price)))
            stars, visited, photos = rng.choice((4, 5, 5, 3, 4)), rng.random() < 0.7, rng.choice((0, 0, 2, 3, 4))
            user = USERS[(seed + i * 7) % len(USERS)]
        out.append({"review_id": f"{seed % 9999}-{i}", "rating": stars, "content": text,
                    "timestamp": stamp.isoformat(), "user": user, "visited": visited, "photos": photos,
                    "days_ago": (day - stamp).days or 1, "trust_provenance": None})
    return out


def _themes(rows):
    """What the surviving reviews actually talk about, counted by code."""
    counts = {}
    for label, words in THEMES:
        n = sum(1 for r in rows if any(w in str(r.get("content") or "") for w in words))
        if n:
            counts[label] = n
    return counts


def _excerpt(text, limit=96):
    text = str(text or "")
    return text if len(text) <= limit else text[:limit] + "…"


def _card(row, why=None):
    out = {"excerpt": _excerpt(row.get("content")), "stars": row.get("rating"), "user": row.get("user"),
           "days_ago": row.get("days_ago"), "visited": bool(row.get("visited")), "photos": row.get("photos") or 0}
    if why is not None:
        out["why"] = why
    return out


class ReviewTrust:
    """The rule engine. Every threshold is one line, so a judge can ask you to change it live."""

    BURST_RATIO, BURST_MIN = 0.40, 3          # one hour holds this share of the untrusted pool
    SIMILARITY, MIN_TEXT = 0.85, 5            # near-duplicate after punctuation is stripped
    EXAG_MIN, GENERIC_MIN, SHORT = 2, 2, 30    # emotion without detail
    FLAG_SCORE, RECOMMEND_AT = 50, 70         # a single review's suspicion, and a place's trust score
    AGGREGATE_RATIO, AGGREGATE_BONUS = 0.50, 20
    VETO_RATIO = 0.30                         # this share intercepted is enough on its own
    CAPS = ((4, 25), (5, 25), (3, 15), (5, 15))   # per rule: points each, points at most
    REQUIRED = ("review_id", "content", "timestamp", "rating")

    def __init__(self, reviews):
        self.raw = list(reviews or [])
        self.usable, self.rejected = self._validate(self.raw)

    # --- guards ---

    def _validate(self, reviews):
        usable, rejected = [], []
        for r in reviews:
            missing = [k for k in self.REQUIRED if k not in r]
            bad_time = not missing and self._ts(r.get("timestamp")) is None
            (rejected if (missing or bad_time) else usable).append(
                r if not (missing or bad_time) else {"review_id": r.get("review_id", "?"), "missing": missing,
                                                     "bad_timestamp": bool(bad_time)})
        return usable, rejected

    @staticmethod
    def _ts(value):
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _trusted(review):
        return review.get("trust_provenance") in TRUSTED_PROVENANCE

    @staticmethod
    def _injected(text):
        return any(re.search(p, str(text or ""), re.I) for p in INJECTION)

    # --- the three rules, run on the untrusted pool only ---

    def _bursts(self, pool):
        hits = {}
        if len(pool) < self.BURST_MIN:
            return hits
        buckets = defaultdict(list)
        for r in pool:
            stamp = self._ts(r.get("timestamp"))
            if stamp:
                buckets[stamp.replace(minute=0, second=0, microsecond=0)].append(r)
        for stamp, items in buckets.items():
            share = len(items) / len(pool)
            if len(items) >= self.BURST_MIN and share >= self.BURST_RATIO:
                hour = f"{stamp.month}月{stamp.day}日 {stamp.hour:02d}–{(stamp.hour + 1) % 24:02d} 时"
                for r in items:
                    hits[r["review_id"]] = (f"{hour}这一小时集中发布了 {len(items)} 条"
                                            f"（占未验证评论 {share:.0%}）")
        return hits

    def _duplicates(self, pool):
        hits = {}
        pairs = [(r, _norm(r.get("content"))) for r in pool]
        groups = defaultdict(list)
        for r, text in pairs:
            if len(text) >= self.MIN_TEXT:
                groups[text].append(r)
        for text, items in groups.items():
            if len(items) >= 2:
                ids = [x["review_id"] for x in items]
                for r in items:
                    others = [i for i in ids if i != r["review_id"]]
                    hits[r["review_id"]] = f"与另外 {len(others)} 条评价去掉标点后一字不差"
        left = [(r, t) for r, t in pairs if r["review_id"] not in hits and len(t) >= 8][:300]
        for i in range(len(left)):
            for j in range(i + 1, len(left)):
                (ra, ta), (rb, tb) = left[i], left[j]
                if ra["review_id"] in hits and rb["review_id"] in hits:
                    continue
                score = SequenceMatcher(None, ta, tb).ratio()
                if score >= self.SIMILARITY:
                    line = f"与另一条评价相似度 {score:.0%}（只改了几个字）"
                    hits.setdefault(ra["review_id"], line)
                    hits.setdefault(rb["review_id"], line)
        return hits

    def _emotion(self, review):
        text = str(review.get("content") or "").strip()
        if not text:
            return None
        exag = [w for w in EXAGGERATION if w in text]
        generic = [w for w in GENERIC if w in text]
        detail = [w for w in DETAILS if w in text]
        signals = []
        if len(exag) >= self.EXAG_MIN:
            signals.append(f"{len(exag)} 个夸张词（{'、'.join(exag[:3])}）")
        if len(generic) >= self.GENERIC_MIN and len(text) < self.SHORT:
            signals.append(f"短句堆了 {len(generic)} 个套话（{'、'.join(generic[:3])}）")
        if not signals:
            return None
        if detail and len(text) >= 25:      # a real meal has details; don't fine an honest fan
            return None
        return "、".join(signals) + "，没有可核对的消费细节"

    # --- the verdict ---

    def analyze(self):
        if not self.raw:
            return {"status": "no_data", "trust_score": None, "recommend": None, "flagged": [],
                    "hits": {}, "reason_zh": "这家店还没有可核对的评价，我不替它编一个分数。",
                    "reason_en": "There are no reviews to check, so I won't invent a score."}
        if self.usable and len(self.usable) < max(3, int(len(self.raw) * 0.5)) and len(self.raw) >= 3:
            return {"status": "unusable_data", "trust_score": None, "recommend": None, "flagged": [],
                    "hits": {}, "reason_zh": f"{len(self.raw)} 条评价里只有 {len(self.usable)} 条字段完整，"
                                             f"数据不可信时我不按「可信」放行。",
                    "reason_en": f"Only {len(self.usable)} of {len(self.raw)} rows parsed; I don't treat "
                                 f"unreadable data as trustworthy."}
        if not self.usable:
            return {"status": "unusable_data", "trust_score": None, "recommend": None, "flagged": [], "hits": {},
                    "reason_zh": "评价数据无法解析，先不推荐。", "reason_en": "The reviews could not be read; not recommending."}

        pool = [r for r in self.usable if not self._trusted(r)]
        bursts, dups = self._bursts(pool), self._duplicates(pool)
        # One rule alone is 40 points, under the flag line. When a rule covers most of the pool that is itself
        # the evidence, so those reviews get the group bonus too — otherwise a whole shop of clones slips through.
        group = {}
        for ids, label in ((set(bursts), "同一时段批量发布"), (set(dups), "模板化重复")):
            if len(ids) >= 3 and pool and len(ids) / len(pool) >= self.AGGREGATE_RATIO:
                for rid in ids:
                    group.setdefault(rid, []).append(label)

        flagged, counts = [], {"burst": 0, "duplicate": 0, "emotion": 0, "injection": 0}
        by_id = {r["review_id"]: r for r in self.usable}
        for r in self.usable:
            rid = r["review_id"]
            reasons, tags, score = [], [], 0
            if rid in bursts:
                reasons.append(bursts[rid]); tags.append("TIME_BURST"); score += 40; counts["burst"] += 1
            if rid in dups:
                reasons.append(dups[rid]); tags.append("DUPLICATE"); score += 40; counts["duplicate"] += 1
            emo = self._emotion(r)
            if emo:
                reasons.append(emo); tags.append("EXTREME_EMOTION"); score += 20; counts["emotion"] += 1
            if self._injected(r.get("content")):
                reasons.append("评价里出现了像是给系统的指令，按不可信输入处理"); tags.append("INJECTION_LIKE")
                score += 20; counts["injection"] += 1
            if rid in group:
                reasons.append("属于成批出现的模式：" + "、".join(group[rid]))
                tags.append("AGGREGATE_PATTERN"); score += self.AGGREGATE_BONUS
            if score >= self.FLAG_SCORE:
                text = str(r.get("content") or "")
                flagged.append({"review_id": rid, "excerpt": text[:60] + ("…" if len(text) > 60 else ""),
                                "score": score, "tags": tags, "reasons": reasons})
        flagged.sort(key=lambda x: -x["score"])

        penalty = 0
        for (ids_key, (each, cap)) in zip(("burst", "duplicate", "emotion", "injection"), self.CAPS):
            penalty += min(cap, counts[ids_key] * each)
        floor = sum(cap for _, cap in self.CAPS)
        trust = max(100 - floor, 100 - penalty)

        kept = {f["review_id"] for f in flagged}
        share = len(flagged) / len(self.usable)
        recommend = trust >= self.RECOMMEND_AT and share < self.VETO_RATIO

        why = []
        if counts["burst"]:
            why.append(f"{counts['burst']} 条集中在同一小时发布")
        if counts["duplicate"]:
            why.append(f"{counts['duplicate']} 条内容重复或高度相似")
        if counts["emotion"]:
            why.append(f"{counts['emotion']} 条只有情绪没有细节")
        if counts["injection"]:
            why.append(f"{counts['injection']} 条夹着疑似指令")
        if flagged:
            reason_zh = (f"有 {len(flagged)} 条评价像是刷出来的（占 {share:.0%}）：" + "；".join(why)
                         + "。这家我没有算进推荐。")
            reason_en = (f"{len(flagged)} of {len(self.usable)} reviews look farmed ({share:.0%}): "
                         + "; ".join(why) + ". I left this one out of the recommendation.")
        else:
            reason_zh = ""
            reason_en = ""

        # 一句简介：只说筛选之后剩下的评价在讲什么，条数与话题都由代码数出来
        kept_rows = [r for r in self.usable if r["review_id"] not in kept]
        themes = _themes(kept_rows)
        top = sorted(themes.items(), key=lambda kv: -kv[1])[:3]
        EN = {"等位": "waiting", "口味": "taste", "环境": "the room", "服务": "service",
              "分量": "portions", "交通": "getting there"}
        if top:
            summary_zh = (f"{len(kept_rows)} 条可信评价主要在说："
                          + "、".join(f"{k}（{v} 条）" for k, v in top) + "。")
            summary_en = (f"The {len(kept_rows)} reviews that held up talk mostly about "
                          + ", ".join(f"{EN.get(k, k)} ({v})" for k, v in top) + ".")
        else:
            summary_zh = f"{len(kept_rows)} 条可信评价，没有特别集中的话题。"
            summary_en = f"{len(kept_rows)} reviews held up, with no dominant theme."

        def why_real(row):
            bits = [f"提到{'、'.join(k for k in _themes([row]))}"] if _themes([row]) else []
            if row.get("visited"):
                bits.append("到店评价")
            if row.get("photos"):
                bits.append(f"配 {row['photos']} 张图")
            bits.append(f"{row.get('days_ago', '')}天前发布".lstrip("0"))
            return "有可核对的细节：" + "、".join(bits) if bits else "有具体细节"

        samples = {
            "real": [_card(row, why_real(row)) for row in
                     sorted(kept_rows, key=lambda r: -len(str(r.get("content") or "")))[:3]],
            "fake": [_card(by_id[f["review_id"]], why="；".join(f["reasons"])) for f in flagged[:3]],
        }
        return {"status": "ok", "trust_score": trust, "recommend": recommend, "flagged": flagged,
                "flagged_share": round(share, 2), "checked": len(self.usable), "kept": len(kept_rows),
                "hits": counts, "reason_zh": reason_zh, "reason_en": reason_en,
                "summary_zh": summary_zh, "summary_en": summary_en, "samples": samples}


MIN_RATING = 3.5   # 地图自己的评分低于这个数，评价再可信也不推荐


def gate(place, result):
    """Believable reviews are necessary, not sufficient: a 1.4-star shop is a bad recommendation whatever
    its reviews look like. The floor is the map's own rating, read by code, never by the model."""
    if result.get("status") != "ok":
        return result
    rating = place.get("rating")
    if rating is None or rating >= MIN_RATING:
        return result
    out = dict(result)
    out["recommend"] = False
    out["low_rating"] = True
    zh = (f"地图评分只有 {rating}，低于 {MIN_RATING} 的门槛。" if not out.get("reason_zh")
          else out["reason_zh"].replace("这家我没有算进推荐。", "") + f"另外地图评分只有 {rating}，低于 {MIN_RATING}。")
    out["reason_zh"] = zh + "这家我没有算进推荐。"
    out["reason_en"] = (f"The map rates it {rating}, under the {MIN_RATING} floor. I left it out of the recommendation."
                        if not out.get("reason_en") else out["reason_en"])
    return out


def check_places(places):
    """Score a list of places and pick one, or say honestly that none of them can be vouched for."""
    scored = []
    for place in places:
        result = gate(place, ReviewTrust(reviews_for(place)).analyze())
        scored.append({"place": place, "trust": result})
    ok = [s for s in scored if s["trust"]["status"] == "ok"]
    kept = [s for s in ok if s["trust"]["recommend"]]
    kept.sort(key=lambda s: (-s["trust"]["trust_score"], -(s["place"].get("rating") or 0)))
    blocked = [s for s in ok if not s["trust"]["recommend"]]
    return {"checked": len(scored), "pick": kept[0] if kept else None,
            "kept": kept, "blocked": blocked, "unreadable": [s for s in scored if s["trust"]["status"] != "ok"]}
