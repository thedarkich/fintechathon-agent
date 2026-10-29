"""Real places (app/places.py) and table bookings, with Amap, Tencent and OpenStreetMap stood in for: no test reaches
the network."""

import asyncio
import hashlib
import logging
from datetime import date, timedelta

import httpx
from sqlmodel import Session, select

from app.agent import offline
from app.channels import wechat
from app.config import Settings
from app.models import Message, Reservation, Txn
from app.places import Places, gcj_to_wgs, metres, qq_signed, terms, view, wgs_to_gcj

HERE = (22.5431, 114.0579)  # Futian, Shenzhen
HAIDILAO = (22.5440, 114.0585)


def keys(**overrides):
    return Settings(_env_file=None, amap_key="a" * 32, qqmap_key="q" * 35, **overrides)


def maps(request: httpx.Request) -> httpx.Response:
    """What the three services answer, in their own coordinates: the same restaurant comes back from all three."""
    host, path = request.url.host, request.url.path
    if host == "store.is.autonavi.com" and path == "/showpic/hdl1.jpg":
        return httpx.Response(200, content=b"\xff\xd8\xff\xe0 a photo", headers={"content-type": "image/jpeg"})
    if host == "restapi.amap.com" and path == "/v5/place/around" and request.url.params.get("keywords") == "花店":
        glat, glon = wgs_to_gcj(22.5437, 114.0575)
        return httpx.Response(200, json={"status": "1", "pois": [
            {"id": "B0FLOWER01", "name": "大阪熊花店", "location": f"{glon:.6f},{glat:.6f}", "type": "购物服务;花鸟鱼虫市场;花卉",
             "address": "福华三路88号", "business": {"tel": "0755-22223333"}}]})
    if host == "restapi.amap.com" and path == "/v5/place/around":
        glat, glon = wgs_to_gcj(*HAIDILAO)
        return httpx.Response(200, json={"status": "1", "info": "OK", "pois": [
            {"id": "B0FFTEST01", "name": "海底捞火锅(中航天虹店)", "location": f"{glon:.6f},{glat:.6f}", "type": "餐饮服务;中餐厅;火锅店",
             "address": "华强北路1002号", "business": {"tel": "0755-12345678", "rating": "4.6", "cost": "126.00",
                                                     "opentime_today": "10:00-02:00"},
             "photos": [{"title": [], "url": "http://store.is.autonavi.com/showpic/hdl1.jpg"},
                        {"title": [], "url": "http://tracker.example.com/pixel.jpg"}]},
            {"id": "B0FFTEST02", "name": "远处的火锅", "location": "114.200000,22.700000", "type": "餐饮服务;中餐厅;火锅店",
             "address": [], "business": {"tel": []}}]})
    if host == "apis.map.qq.com" and path == "/ws/place/v1/search":
        same = wgs_to_gcj(22.5441, 114.0586)  # a few metres off, as two maps disagree
        other = wgs_to_gcj(22.5420, 114.0560)
        return httpx.Response(200, json={"status": 0, "data": [
            {"id": "123456", "title": "海底捞火锅（中航天虹店）", "address": "深圳市福田区华强北路1002号", "tel": "",
             "category": "美食:火锅", "location": {"lat": same[0], "lng": same[1]}},
            {"id": "654321", "title": "渝旦旦重庆火锅", "address": "福华三路", "tel": "0755-87654321", "category": "美食:火锅",
             "location": {"lat": other[0], "lng": other[1]}}]})
    if host == "nominatim.openstreetmap.org" and path == "/search":
        if request.url.params.get("limit") == "1":  # where a named place is
            return httpx.Response(200, json=[{"lat": "30.5383", "lon": "114.3600", "name": "武汉大学"}])
        return httpx.Response(200, json=[
            {"osm_type": "node", "osm_id": 1, "lat": str(HAIDILAO[0]), "lon": str(HAIDILAO[1]), "category": "amenity",
             "type": "restaurant", "namedetails": {"name": "海底捞火锅", "name:en": "Haidilao Hot Pot"},
             "extratags": {"opening_hours": "Mo-Su 10:00-02:00"}, "address": {"road": "华强北路", "city_district": "福田区"}},
            {"osm_type": "node", "osm_id": 2, "lat": "22.5450", "lon": "114.0600", "category": "amenity", "type": "restaurant",
             "namedetails": {"name": "孔亮火锅"}, "extratags": {"phone": "+86 755 1111 2222"}, "address": {}}])
    return httpx.Response(404)


def search(places, query="火锅", where=HERE):
    return asyncio.run(places.search(query, *where))


def test_china_coordinates_convert_both_ways():
    for lat, lon in (HERE, (39.9087, 116.3975), (30.5383, 114.3600)):
        glat, glon = wgs_to_gcj(lat, lon)
        assert 100 < metres(lat, lon, glat, glon) < 1000  # the published offset is a few hundred metres
        back = gcj_to_wgs(glat, glon)
        assert metres(lat, lon, *back) < 0.5
    assert wgs_to_gcj(51.5007, -0.1246) == (51.5007, -0.1246)  # outside China nothing moves


def test_plain_words_become_each_source_s_own():
    assert terms("restaurant") == ("餐厅", "restaurant")
    assert terms("咖啡") == ("咖啡", "cafe")
    assert terms("海底捞") == ("海底捞", "海底捞")


def test_tencent_requests_are_signed_when_the_key_needs_it():
    signed = qq_signed("/ws/place/v1/search", {"keyword": "火锅", "key": "K"}, "S")
    assert signed["sig"] == hashlib.md5("/ws/place/v1/search?key=K&keyword=火锅S".encode()).hexdigest()
    assert "sig" not in qq_signed("/ws/place/v1/search", {"key": "K"}, "")


def test_one_place_from_three_sources_becomes_one_entry():
    places, status = search(Places(keys(), transport=httpx.MockTransport(maps)))
    assert status == {"amap": "ok", "qq": "ok", "osm": "ok"}
    names = [p.name for p in places]
    assert names[0] == "海底捞火锅(中航天虹店)" and "远处的火锅" not in names  # 17 km away is not nearby
    assert sorted(names) == sorted(["海底捞火锅(中航天虹店)", "渝旦旦重庆火锅", "孔亮火锅"])
    first = places[0]
    assert first.sources == ["amap", "qq", "osm"]
    assert (first.rating, first.cost_yuan, first.phone, first.name_en) == (4.6, 126.0, "0755-12345678", "Haidilao Hot Pot")
    assert metres(*HAIDILAO, first.lat, first.lon) < 1  # back in GPS coordinates
    # Amap's categories are Chinese only: the English screen gets the common ones in English
    assert (view(first, 1, "zh")["category"], view(first, 1, "en")["category"]) == ("火锅店", "Hot pot")
    assert [p.distance_m for p in places] == sorted(p.distance_m for p in places)


def test_a_source_that_fails_is_left_out():
    def flaky(request):
        return httpx.Response(500) if request.url.host == "apis.map.qq.com" else maps(request)
    places, status = search(Places(keys(), transport=httpx.MockTransport(flaky)))
    assert status == {"amap": "ok", "qq": "failed", "osm": "ok"}
    assert "渝旦旦重庆火锅" not in [p.name for p in places]


def test_without_keys_only_openstreetmap_answers():
    seen = []

    def record(request):
        seen.append(request.url.host)
        return maps(request)
    places, status = search(Places(Settings(_env_file=None), transport=httpx.MockTransport(record)))
    assert status == {"amap": "off", "qq": "off", "osm": "ok"} and set(seen) == {"nominatim.openstreetmap.org"}
    assert [p.name for p in places] == ["海底捞火锅", "孔亮火锅"]


def test_the_offline_planner_reads_places_said_many_ways():
    # with no AI model the offline planner answers; the last request is about the account, not a café
    today = date(2026, 10, 29)
    for text, what, near in (("Any good hot pot near Huaqiangbei?", "hot pot", "Huaqiangbei"),
                             ("华强北有什么好吃的火锅", "火锅", "华强北"), ("万象城有没有好吃的日料", "日料", "万象城"),
                             ("where to eat near Futian", "restaurant", "Futian"), ("晚上去哪吃", "餐厅", None)):
        step = offline.plan(text, today).steps[0]
        assert (step.action, step.args["what"], step.args.get("near")) == ("places_search", what, near), text
    assert offline.plan("coffee spending near the end of the month", today).steps[0].action != "places_search"


def test_only_places_to_eat_offer_a_table(bank):
    flowers = bank.chat("附近的花店")["messages"][-1]["text"]
    hot_pot = bank.chat("附近有什么好吃的火锅")["messages"][-1]["text"]
    assert "订座" not in flowers and "订座" in hot_pot


def test_a_named_place_is_found_across_china_or_near_the_customer():
    asked = []

    def amap_only(request):
        path, params = request.url.path, request.url.params
        asked.append((path, params.get("location")))
        if path == "/v5/place/text" and params["keywords"] == "武汉大学":
            return httpx.Response(200, json={"status": "1", "pois": [{"name": "武汉大学", "location": "114.364514,30.536243"}]})
        if path == "/v5/place/text":  # a chain's name: no one place in China
            return httpx.Response(200, json={"status": "1", "count": "0", "pois": []})
        if path == "/v5/place/around" and params["keywords"] == "万象城":
            return httpx.Response(200, json={"status": "1", "pois": [{"name": "深圳万象城", "location": "114.111755,22.539083"}]})
        return httpx.Response(404)
    places = Places(Settings(_env_file=None, amap_key="a" * 32, places_osm=False), transport=httpx.MockTransport(amap_only))
    lat, lon = asyncio.run(places.locate("武汉大学"))
    assert 30.5 < lat < 30.6 and 114.3 < lon < 114.4 and asked == [("/v5/place/text", None)]
    mixc = asyncio.run(places.locate("万象城", centre=HERE))
    assert metres(*mixc, *gcj_to_wgs(22.539083, 114.111755)) < 1
    glat, glon = wgs_to_gcj(*HERE)  # looked for around the customer, in Amap's coordinates
    assert asked[-1] == ("/v5/place/around", f"{glon:.6f},{glat:.6f}")


def test_a_failed_answer_is_asked_again_and_logged_without_the_key(caplog):
    tries = []

    def busy_once(request):
        if request.url.host == "restapi.amap.com":
            tries.append(request.url.path)
            if len(tries) == 1:
                return httpx.Response(200, json={"status": "0", "info": "BUSY", "infocode": "12345"})
        return maps(request)
    places, status = search(Places(keys(), transport=httpx.MockTransport(busy_once)))
    assert status["amap"] == "ok" and len(tries) == 2 and places[0].sources[0] == "amap"

    def down(request):
        if request.url.host == "restapi.amap.com":
            return httpx.Response(200, json={"status": "0", "info": "BUSY", "infocode": "12345"})
        return maps(request)
    with caplog.at_level(logging.WARNING, logger="app.places"):
        places, status = search(Places(keys(), transport=httpx.MockTransport(down)))
    assert status["amap"] == "failed" and places
    assert "amap failed (12345)" in caplog.text and "a" * 32 not in caplog.text


def test_a_search_stays_in_the_customer_s_region():
    # Futian is a river away from Hong Kong: a florist there can't take a mainland order, nor the other way round
    asked = []

    def osm(request):
        if request.url.path == "/reverse":
            asked.append(request.url.params["lat"])
            south = float(request.url.params["lat"]) < 22.53
            return httpx.Response(200, json={"address": {"ISO3166-2-lvl3": "CN-HK", "country_code": "cn"} if south
                                              else {"ISO3166-2-lvl4": "CN-GD", "country_code": "cn"}})
        return httpx.Response(200, json=[
            {"osm_type": "node", "osm_id": 1, "lat": "22.5420", "lon": "114.0610", "category": "shop", "type": "florist",
             "namedetails": {"name": "福田花店"}, "address": {"ISO3166-2-lvl4": "CN-GD", "country_code": "cn"}},
            {"osm_type": "node", "osm_id": 2, "lat": "22.5150", "lon": "114.0600", "category": "shop", "type": "florist",
             "namedetails": {"name": "落马洲花店"}, "address": {"ISO3166-2-lvl3": "CN-HK", "country_code": "cn"}}])

    async def no_wait():
        pass
    places = Places(Settings(_env_file=None), transport=httpx.MockTransport(osm))
    places._osm_turn = no_wait

    def names(where):
        return [p.name for p in search(places, "花店", where)[0]]
    assert names((22.5400, 114.0600)) == ["福田花店"]
    assert names((22.5250, 114.0600)) == ["落马洲花店"]
    assert names(HERE) == ["福田花店"]  # the usual centre is known to be in Shenzhen: nothing to ask
    assert asked == ["22.54000", "22.52500"]


def bank_today(bank) -> date:
    return date.fromisoformat(bank.get("/api/demo/clock").json()["now"][:10])


def test_find_and_book_a_table(bank):
    bank.runtime.places = Places(keys(), transport=httpx.MockTransport(maps))
    tomorrow = (bank_today(bank) + timedelta(days=1)).isoformat()

    # booking before anything was found: nothing to point at
    early = bank.chat("订第一家，明晚7点，4位")["plan"]
    assert early["status"] == "failed" and "先让我找找" in early["steps"][0]["error"]

    # the assistant's card; the places come from the card's own request, with the location the browser shared
    body = bank.chat("附近有什么好吃的火锅")
    assert body["plan"]["status"] == "done" and body["plan"]["tier"] == "green"
    card = next(c for c in body["messages"][-1]["cards"] if c["type"] == "places")
    assert card["what"] == "火锅"
    found = bank.get("/api/places/search", q="火锅", lat=HERE[0], lon=HERE[1]).json()
    assert found["located"] == "device" and len(found["items"]) == 3
    assert found["items"][0]["map_url"].startswith("https://uri.amap.com/marker?")

    # booked from the card: a screen plan, yellow, done once confirmed
    plan = bank.post("/api/screens/plan", {"action": "book_table", "lang": "zh", "args": {
        "place": found["items"][0]["id"], "at": f"{tomorrow}T19:00", "party": 4}}).json()["plan"]
    assert plan["status"] == "awaiting_approval" and plan["tier"] == "yellow"
    assert plan["steps"][0]["rule"] == "Y_BOOKING"
    # the card says plainly that the restaurant isn't told
    assert {"label": "说明", "value": "演示：订座记在银行里，不会发给餐厅"} in plan["steps"][0]["details"]
    done = bank.approve(plan).json()
    assert done["plan"]["status"] == "done"
    assert "不会发给餐厅" in done["messages"][0]["text"]
    with Session(bank.runtime.engine) as session:
        booked = session.exec(select(Reservation)).one()
        assert (booked.name, booked.at, booked.party, booked.status) == ("海底捞火锅(中航天虹店)", f"{tomorrow}T19:00", 4, "booked")

    # in words, by its place in the list
    second = bank.chat("订第二家，明晚7点，2位")["plan"]
    assert second["status"] == "awaiting_approval"
    assert found["items"][1]["name"] in second["steps"][0]["text"]
    assert bank.chat("订第九家，明晚7点，2位")["plan"]["status"] == "failed"

    # the bank asks for what's missing, with choices, and the answers complete the booking
    asked = bank.chat("订第三家")["plan"]
    assert asked["status"] == "clarifying" and asked["ask"]["field"] == "at"
    when = asked["ask"]["options"][0]["value"]
    asked = bank.post(f"/api/plans/{asked['id']}/answer", {"value": when}).json()["plan"]
    assert asked["status"] == "clarifying" and asked["ask"]["field"] == "party"
    ready = bank.post(f"/api/plans/{asked['id']}/answer", {"value": 3}).json()["plan"]
    assert ready["status"] == "awaiting_approval" and found["items"][2]["name"] in ready["steps"][0]["text"]


def test_bookings_are_listed_and_cancelled(bank):
    bank.runtime.places = Places(keys(), transport=httpx.MockTransport(maps))
    tomorrow = (bank_today(bank) + timedelta(days=1)).isoformat()
    assert bank.chat("取消订座")["plan"]["status"] == "failed"  # nothing booked yet
    bank.get("/api/places/search", q="火锅", lat=HERE[0], lon=HERE[1])
    for text in ("订第一家，明晚7点，2位", "订第二家，后天中午，4位"):
        assert bank.approve(bank.chat(text)["plan"]).json()["plan"]["status"] == "done"

    reply = bank.chat("我的订座")["messages"][-1]
    assert reply["text"].split("\n")[0] == "你有 2 条待用餐的订座："  # the line the app shows above the card
    listed = next(c for c in reply["cards"] if c["type"] == "reservations")
    assert [x["party"] for x in listed["items"]] == [2, 4]

    # two bookings and no hint which: the bank asks
    asked = bank.chat("取消订座")["plan"]
    assert asked["status"] == "clarifying" and asked["ask"]["field"] == "booking" and len(asked["ask"]["options"]) == 2
    # by its day: yellow, confirmed like any change
    plan = bank.chat("取消明天的订座")["plan"]
    assert plan["status"] == "awaiting_approval" and plan["tier"] == "yellow" and plan["steps"][0]["rule"] == "Y_BOOKING_CANCEL"
    assert {"label": "用餐时间", "value": f"{tomorrow} 19:00"} in plan["steps"][0]["details"]
    assert bank.approve(plan).json()["plan"]["status"] == "done"
    with Session(bank.runtime.engine) as session:
        assert sorted(r.status for r in session.exec(select(Reservation))) == ["booked", "cancelled"]
    left = next(c for c in bank.chat("my bookings", lang="en")["messages"][-1]["cards"] if c["type"] == "reservations")
    assert [x["party"] for x in left["items"]] == [4]


def test_the_latest_list_is_the_newest_card_however_often_an_older_one_loads(bank):
    bank.runtime.places = Places(keys(), transport=httpx.MockTransport(maps))
    hot_pot = bank.chat("附近有什么好吃的火锅")["messages"][-1]["cards"][0]
    coffee = bank.chat("附近的咖啡")["messages"][-1]["cards"][0]
    newest = bank.get("/api/places/search", q="咖啡", lat=HERE[0], lon=HERE[1], ref=coffee["ref"]).json()
    # a reload: the older card loads after the newer one
    bank.get("/api/places/search", q="火锅", lat=HERE[0], lon=HERE[1], ref=hot_pot["ref"])
    plan = bank.chat("订第一家，明晚7点，2位")["plan"]
    assert newest["items"][0]["name"] in plan["steps"][0]["text"]


def test_photos_come_only_through_the_bank_and_only_from_the_maps(bank):
    bank.runtime.places = Places(keys(), transport=httpx.MockTransport(maps))
    first = bank.get("/api/places/search", q="火锅", lat=HERE[0], lon=HERE[1]).json()["items"][0]
    assert first["photos"] == ["/api/places/photo?id=amap%3AB0FFTEST01&n=0"]  # the tracker's address was dropped
    photo = bank.client.get(first["photos"][0])
    assert photo.status_code == 200 and photo.headers["content-type"] == "image/jpeg" and photo.content.startswith(b"\xff\xd8")
    assert bank.client.get("/api/places/photo?id=amap%3AB0FFTEST01&n=1").status_code == 404
    assert bank.client.get("/api/places/photo?id=amap%3ANEVERSEEN&n=0").status_code == 404


def test_photos_come_resized_and_are_kept_for_a_while():
    fetched = []

    def images(request):
        fetched.append(str(request.url))
        if "x-oss-process" in request.url.query.decode() and "broken" in request.url.path:
            return httpx.Response(404)  # an image the resizer can't take: the original comes instead
        return httpx.Response(200, content=b"\xff\xd8\xff\xe0 a photo", headers={"content-type": "image/jpeg"})
    places = Places(Settings(_env_file=None), transport=httpx.MockTransport(images))
    small = "https://store.is.autonavi.com/showpic/abc?type=pic"
    assert asyncio.run(places.photo(small))[1] == "image/jpeg"
    assert fetched == [small + "&x-oss-process=image/resize,w_320"]
    asyncio.run(places.photo(small))
    assert len(fetched) == 1  # the second time, from memory
    broken = "https://aos-comment.amap.com/B0/comment/broken.jpg"
    assert asyncio.run(places.photo(broken)) is not None and fetched[-1] == broken


def test_the_birthday_plan_can_order_from_a_real_shop(bank):
    bank.runtime.places = Places(keys(), transport=httpx.MockTransport(maps))
    plan = bank.chat("下个月老婆生日，帮我预留1000元，提前两天订花和蛋糕")["plan"]
    florist = next(s for s in plan["steps"] if s.get("shop_kind") == "florist")
    assert florist["shop_place"] is None  # the bank's partner shop until the customer picks one
    shop = next(p for p in bank.get("/api/places/search", q="花店", lat=HERE[0], lon=HERE[1]).json()["items"]
                if p["name"] == "大阪熊花店")
    before = len(bank.get("/api/conversation", conversation_id=bank.conversation).json()["messages"])
    body = bank.post(f"/api/plans/{plan['id']}/edit", {"step_id": florist["id"], "args": {"shop": shop["id"]}}).json()
    edited = body["plan"]
    # the card on screen changes; the chat doesn't get a second copy of it
    assert body["messages"] == [] and len(bank.get("/api/conversation", conversation_id=bank.conversation).json()["messages"]) == before
    step = next(s for s in edited["steps"] if s["id"] == florist["id"])
    assert edited["status"] == "awaiting_approval" and edited["approval_hash"] != plan["approval_hash"]
    assert "大阪熊花店" in step["text"] and "参考价" in step["text"] and step["shop_place"]["address"] == "福华三路88号"
    assert bank.approve(edited).json()["plan"]["status"] == "scheduled"
    bank.post("/api/demo/advance", {"days": 34})
    assert bank.get(f"/api/plans/{plan['id']}").json()["status"] == "done"
    with Session(bank.runtime.engine) as session:
        paid = session.exec(select(Txn).where(Txn.counterparty == "大阪熊花店")).one()
        assert paid.amount_fen == -19_900


def test_a_thin_search_looks_further_out(bank):
    def one_florist_5km_away(request):
        return httpx.Response(200, json=[{"osm_type": "node", "osm_id": 9, "lat": "22.5880", "lon": "114.0579", "category": "shop",
                                          "type": "florist", "namedetails": {"name": "大阪熊花店"}, "extratags": {}, "address": {}}])
    bank.runtime.places = Places(Settings(_env_file=None), transport=httpx.MockTransport(one_florist_5km_away))
    found = bank.get("/api/places/search", q="花店", lat=HERE[0], lon=HERE[1]).json()
    assert found["radius_m"] == 8000 and [p["name"] for p in found["items"]] == ["大阪熊花店"]
    # nothing even further out: the card says how far it looked
    bank.runtime.places = Places(Settings(_env_file=None), transport=httpx.MockTransport(lambda request: httpx.Response(200, json=[])))
    none = bank.get("/api/places/search", q="花店", lat=HERE[0], lon=HERE[1]).json()
    assert (none["items"], none["radius_m"]) == ([], 8000)


def test_where_a_search_looks(bank):
    bank.runtime.places = Places(keys(places_osm=True), transport=httpx.MockTransport(maps))
    named = bank.get("/api/places/search", q="咖啡", near="武汉大学").json()
    assert (named["located"], named["label"]) == ("named", "武汉大学")
    fallback = bank.get("/api/places/search", q="咖啡").json()
    assert (fallback["located"], fallback["label"]) == ("fallback", "深圳福田中心区")


def test_wechat_sends_the_places_to_the_app():
    message = Message(conversation_id="c", role="assistant", text="我来找找你附近的火锅：", lang="zh",
                      cards=[{"type": "places", "what": "火锅", "near": None, "party": 4, "date": None, "time": None}])
    link = wechat.replies([message], "zh")[-1]
    assert link["kind"] == "link" and link["url"] == "/#/places?q=%E7%81%AB%E9%94%85&party=4"
