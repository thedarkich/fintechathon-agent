"""The review-credibility rules, and the assistant answering '推荐理由' with them instead of a fund."""

from sqlmodel import Session, select

from app.agent import offline
from app.models import PlaceSeen, UserAccount, new_id
from app.trust import ReviewTrust, reviews_for


def review(i, text, stamp):
    return {"review_id": f"r{i}", "rating": 5, "content": text, "timestamp": stamp}


CLONE = "绝绝子，这家真的是天花板，强烈推荐，下次还来！"
HONEST = ["排队等了20分钟，酸菜鱼很新鲜，人均80左右，座位舒服。", "毛血旺味道正宗，辣度适中，包间干净，停车方便。",
          "上菜快，宫保鸡丁分量足，服务员热情，人均60性价比可以。", "食材新鲜，牛肉面汤底偏咸，空调太冷，下次还来吃。",
          "老板实在，麻婆豆腐下饭，等位半小时，人均70左右还行。"]


def burst(n, text=CLONE, start=0):
    """n clones published inside the same hour."""
    return [review(i, text, f"2026-10-20T14:{i % 60:02d}:00") for i in range(start, start + n)]


def spread(n):
    return [review(i, HONEST[i % len(HONEST)], f"2026-09-{(i % 27) + 1:02d}T12:30:00") for i in range(n)]


# --- the rules themselves ---

def test_cloned_reviews_in_one_burst_are_intercepted():
    result = ReviewTrust(burst(6)).analyze()
    assert result["flagged"] and result["hits"]["duplicate"] >= 4 and result["hits"]["burst"] == 6
    assert result["recommend"] is False and result["trust_score"] < 70


def test_honest_reviews_pass_and_keep_their_score():
    result = ReviewTrust(spread(5)).analyze()
    assert result["flagged"] == [] and result["recommend"] is True and result["trust_score"] == 100


def test_a_trusted_flag_inside_the_data_does_not_excuse_it():
    """A ring can set is_saijie_rank in its own JSON. Only our fetch layer's provenance counts."""
    dirty = [dict(r, is_saijie_rank=True, is_verified_visit=True) for r in burst(6)]
    assert ReviewTrust(dirty).analyze()["flagged"], "an outside flag must not buy an exemption"
    clean = [dict(r, trust_provenance="amap_saijie_verified") for r in burst(6)]
    assert not ReviewTrust(clean).analyze()["flagged"]


def test_unreadable_rows_are_never_reported_as_safe():
    broken = [{"reviewid": f"x{i}", "star": 5, "time": "not-a-date"} for i in range(6)]
    result = ReviewTrust(broken).analyze()
    assert result["status"] == "unusable_data" and result["trust_score"] is None
    assert result["recommend"] is None, "data we cannot read is not evidence that a place is fine"


def test_no_reviews_is_not_the_same_as_guilty():
    result = ReviewTrust([]).analyze()
    assert result["status"] == "no_data" and result["trust_score"] is None and result["recommend"] is None


def test_a_whole_shop_of_clones_is_vetoed_even_when_the_score_looks_fine():
    """Caps keep the score honest but blunt: interception share has the last word."""
    clones = [review(i, f"菜好吃环境不错服务好{i}", f"2026-09-{(i % 28) + 1:02d}T{12 + (i % 6):02d}:00")
              for i in range(400)]
    result = ReviewTrust(clones).analyze()
    assert result["trust_score"] >= 70, "the capped score alone would let this through"
    assert result["flagged_share"] > 0.30 and result["recommend"] is False


def test_the_simulated_reviews_are_the_same_on_every_machine():
    place = {"id": "amap:B0FFH8XXXX01", "name": "蜀香居", "rating": 4.9}
    assert reviews_for(place) == reviews_for(place) and len(reviews_for(place)) >= 8


def test_the_rules_run_on_a_place_the_map_shown_us(bank):
    """'推荐理由' is answered by the rules, in the chat, about the places on the screen."""
    with Session(bank.runtime.engine) as session:
        user = session.exec(select(UserAccount)).first()
        search = new_id()
        for rank, (name, rating) in enumerate([("蜀香居", 4.9), ("阿婆私房菜", 4.2), ("巷子口火锅", 4.7)], start=1):
            session.add(PlaceSeen(user_id=user.id, search_id=search, rank=rank, place_id=f"amap:{name}",
                                  data={"id": f"amap:{name}", "name": name, "rating": rating,
                                        "address": "体育西路 12 号", "lat": 22.54, "lon": 114.06}))
        session.commit()
    body = bank.chat("推荐理由")
    text = " ".join(m.get("text", "") for m in body["messages"])
    assert "我核对了 3 家" in text, text
    assert "理财" not in text and "风险等级" not in text, "this is not a wealth question"
    assert body["plan"] is None or all(s["tier"] == "green" for s in body["plan"]["steps"])


def test_the_offline_planner_stops_reading_推荐_as_理财():
    from datetime import date

    today = date(2026, 10, 30)
    assert offline.plan("推荐理由", today).steps[0].action == "place_reviews_check"
    assert offline.plan("刚才那几家哪家评价是真的", today).steps[0].action == "place_reviews_check"
    assert offline.plan("推荐一个稳健的理财", today).steps[0].action != "place_reviews_check"


def test_a_low_rated_place_is_not_recommended_even_if_its_reviews_are_clean():
    """Believable reviews are necessary, not sufficient — the map's own rating is the floor."""
    from app.trust import MIN_RATING, ReviewTrust, gate, reviews_for
    place = {"id": "amap:LOW1", "name": "重庆鲜烫鲜牛肉火锅米线面", "category": "火锅店",
             "rating": 1.4, "cost_yuan": 17}
    result = gate(place, ReviewTrust(reviews_for(place)).analyze())
    assert result["recommend"] is False and result["low_rating"] is True
    assert f"地图评分只有 1.4，低于 {MIN_RATING}" in result["reason_zh"]


def test_a_place_with_no_rating_is_not_blocked_by_the_floor():
    from app.trust import ReviewTrust, gate, reviews_for
    place = {"id": "amap:NORATING", "name": "没评分的店"}
    result = gate(place, ReviewTrust(reviews_for(place)).analyze())
    assert result.get("low_rating") is not True
