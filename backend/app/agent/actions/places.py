"""Real places and table bookings.

Finding places is a question (green). Its card asks the browser where the customer is and fetches the places itself
(POST /api/places/search), so neither the location nor the places pass through the model: a restaurant's name can't
instruct anything. Booking picks one of the places just shown, by its id, its number in the list or its name, and
waits for the customer's confirmation. It is a demonstration: the restaurant is not told, and the reply says so.
"""

import re
import secrets
from datetime import datetime, timedelta

from pydantic import Field
from sqlmodel import col, select

from app import clock
from app.agent.core import Action, Args, Ask, Ctx, Refuse, register
from app.clock import CST
from app.models import PlaceSeen, Reservation

CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ORDINALS = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
            "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8,
            "ninth": 9, "tenth": 10, "last": -1, "最后": -1}


def _slot(at: str | None) -> tuple[str, str] | None:
    """'2026-10-29T19:00' → ('2026-10-29', '19:00'); None for anything else."""
    if not at:
        return None
    try:
        moment = clock.parse(at.replace(" ", "T"))
    except ValueError:
        return None
    local = moment.astimezone(CST)
    return local.date().isoformat(), f"{local.hour:02d}:{local.minute:02d}"


# --- finding places ---


class SearchArgs(Args):
    what: str = Field(default="餐厅", min_length=1, max_length=30)
    near: str | None = Field(default=None, max_length=40)
    party: int | None = Field(default=None, ge=1, le=20)
    when: str | None = Field(default=None, max_length=25)


def search_resolve(ctx: Ctx, args: SearchArgs) -> dict:
    slot = _slot(args.when) if args.when and "T" in args.when else None
    day = slot[0] if slot else (clock.to_date(args.when).isoformat() if args.when and re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.when)
                                else None)
    return {"what": args.what, "near": args.near, "party": args.party, "date": day, "time": slot[1] if slot else None}


# where nobody books a table (the card in frontend/src/components/Places.tsx keeps the same list)
NOT_DINING = ("花店", "鲜花", "花卉", "蛋糕", "面包", "礼品", "超市", "取款", "atm", "银行", "florist", "flower", "bakery",
              "cake", "gift", "supermarket", "bank")


def bookable(what: str) -> bool:
    lowered = what.lower()
    return not any(word in lowered for word in NOT_DINING)


def search_reply(ctx: Ctx, r: dict, res: dict) -> str:
    where = ctx.t(f"{r['near']}附近", f" near {r['near']}") if r["near"] else ctx.t("附近", " nearby")
    if not bookable(r["what"]):
        return ctx.t(f"我来找找{where}的{r['what']}：都是地图上真实的地方。",
                     f"Here are real places for “{r['what']}”{where}, from the maps.")
    return ctx.t(f"我来找找{where}的{r['what']}：都是地图上真实的地方，看中哪家就点“订座”。",
                 f"Here are real places for “{r['what']}”{where}, from the maps. Pick one and tap Book a table.")


register(Action(
    name="places_search", args=SearchArgs,
    help="Find real places near the customer from map services (restaurants, cafes, florists...). what: the kind of "
         "place or a name in the customer's words (火锅, 咖啡, 海底捞, restaurant); near: a place they name (武汉大学), else "
         "their own location; party and when (YYYY-MM-DD or YYYY-MM-DDTHH:MM) if they said them, to fill in a booking.",
    resolve=search_resolve, run=lambda ctx, r: dict(r),
    describe=lambda ctx, r: ctx.t(f"查找{r['near'] + '附近' if r['near'] else '附近'}的{r['what']}",
                                  f"Find {r['what']} near {r['near'] or 'you'}"),
    reply=search_reply,
    # ref: the step's plan, so the card's search counts as asked when the customer asked it, not when it loads
    card=lambda ctx, r, res: {"type": "places", **res, "ref": ctx.plan.id if ctx.plan else None},
))


# --- booking a table ---


class BookArgs(Args):
    place: str = Field(min_length=1, max_length=120)
    at: str | None = Field(default=None, max_length=25)
    party: int | None = Field(default=None, ge=1, le=20)


def _number(ref: str) -> int | None:
    """'1', '第一家', '第2个', 'the first one', 'second', '最后一家' → its place in the list (-1 for the last)."""
    folded = ref.casefold().strip()
    if m := re.fullmatch(r"(?:第|no\.?\s*|#)?\s*(\d{1,2})\s*(?:家|个|号|位)?", folded):
        return int(m.group(1))
    if m := re.fullmatch(r"第?([一二两三四五六七八九十])(?:家|个|号)?", folded):
        return ORDINALS[m.group(1)]
    if m := re.fullmatch(r"(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)(?:\s+one)?", folded):
        return ORDINALS[m.group(1)]
    if folded.startswith("最后"):
        return -1
    return None


def find_place(ctx: Ctx, ref: str) -> PlaceSeen:
    rows = sorted(ctx.session.exec(select(PlaceSeen).where(PlaceSeen.user_id == ctx.user.id).limit(200)),
                  key=lambda r: (r.asked_at or r.seen_at, -r.rank), reverse=True)
    if not rows:
        raise Refuse("NO_PLACES", "先让我找找附近的餐厅，再挑一家订座。", "Let me find places near you first, then pick one to book.")
    exact = next((r for r in rows if r.place_id == ref), None)
    if exact:
        return exact
    latest = sorted((r for r in rows if r.search_id == rows[0].search_id), key=lambda r: r.rank)
    number = _number(ref)
    if number is not None:
        if number == -1 or 1 <= number <= len(latest):
            return latest[number - 1] if number > 0 else latest[-1]
        raise Refuse("PLACE_NOT_FOUND", f"刚才只找到 {len(latest)} 家。", f"I only found {len(latest)} places just now.")
    folded = ref.casefold()
    for pool in (latest, rows):
        named = {r.place_id: r for r in pool if folded in r.data.get("name", "").casefold()}
        if len(named) == 1:
            return next(iter(named.values()))
        if len(named) > 1:
            raise Ask("place", "你想订哪一家？", "Which one should I book?", [
                {"value": r.place_id, "label_zh": f"{r.data['name']}　{r.data.get('address', '')}".strip(),
                 "label_en": f"{r.data['name']}, {r.data.get('address', '')}".strip(", ")} for r in named.values()][:6])
    raise Refuse("PLACE_NOT_FOUND", "刚才找到的地方里没有这一家。", "That place isn't among the ones I just found.")


def _slots(ctx: Ctx) -> list[dict]:
    """Times to offer when none was given: tonight while there's time, then lunch and dinner tomorrow and the day after."""
    local = ctx.now.astimezone(CST)
    today, offers = local.date(), []
    if local.hour < 17:
        offers.append((today, "19:00", "今晚", "Tonight"))
    for days, zh, en in ((1, "明天", "Tomorrow"), (2, "后天", "In two days")):
        day = today + timedelta(days=days)
        offers += [(day, "12:00", f"{zh}中午", f"{en}, noon"), (day, "19:00", f"{zh}晚上", f"{en}, evening")]
    return [{"value": f"{d.isoformat()}T{t}", "label_zh": f"{zh} {t}", "label_en": f"{en} {t}"} for d, t, zh, en in offers[:4]]


def book_resolve(ctx: Ctx, args: BookArgs) -> dict:
    seen = find_place(ctx, args.place)
    if not args.at:
        raise Ask("at", "订哪天几点？", "What day and time?", _slots(ctx))
    slot = _slot(args.at)
    if slot is None:
        raise Ask("at", "订哪天几点？", "What day and time?", _slots(ctx))
    when = datetime.fromisoformat(f"{slot[0]}T{slot[1]}").replace(tzinfo=CST)
    if when <= ctx.now:
        raise Refuse("PAST_DATE", "这个时间已经过去了。", "That time has already passed.")
    if when - ctx.now > timedelta(days=60):
        raise Refuse("TOO_FAR", "最多可以订 60 天以内的座位。", "Tables can be booked up to 60 days ahead.")
    if not 6 <= when.hour <= 23:
        raise Refuse("CLOSED_HOURS", "请选早上 6 点到晚上 11 点之间的时间。", "Choose a time between 6 am and 11 pm.")
    if not args.party:
        raise Ask("party", "几位用餐？", "How many people?",
                  [{"value": n, "label_zh": f"{n} 位", "label_en": f"{n} people"} for n in (2, 3, 4, 6)])
    data = seen.data
    return {"place_id": seen.place_id, "name": data["name"], "address": data.get("address", ""),
            "phone": data.get("phone", ""), "lat": data["lat"], "lon": data["lon"], "map_url": data.get("map_url", ""),
            "sources": data.get("sources", []), "date": slot[0], "time": slot[1], "party": args.party}


def book_run(ctx: Ctx, r: dict) -> dict:
    code = "".join(secrets.choice(CODE_LETTERS) for _ in range(6))
    row = Reservation(user_id=ctx.user.id, code=code, place_id=r["place_id"], name=r["name"], address=r["address"],
                      phone=r["phone"], lat=r["lat"], lon=r["lon"], sources=r["sources"], at=f"{r['date']}T{r['time']}",
                      party=r["party"], plan_id=ctx.plan.id if ctx.plan else None, created_at=clock.iso(ctx.now))
    ctx.session.add(row)
    ctx.session.flush()
    return {"reservation_id": row.id, "code": code}


def book_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    row = ctx.session.get(Reservation, res["reservation_id"])
    if row and row.status == "booked":
        row.status = "cancelled"
        ctx.session.add(row)
        return {"cancelled": True}
    return {"cancelled": False}


def book_reply(ctx: Ctx, r: dict, res: dict) -> str:
    return ctx.t(f"已在{r['name']}订好座：{r['date']} {r['time']}，{r['party']} 位，订座号 {res['code']}。"
                 "演示环境：这条订座不会发给餐厅，真要去请先打电话确认。",
                 f"Booked a table at {r['name']}: {r['date']} {r['time']}, {r['party']} people, booking code {res['code']}. "
                 "This is a demo: the restaurant isn't told, so call them before you go.")


register(Action(
    name="book_table", args=BookArgs,
    help="Book a table at one of the places just shown by places_search. place: its number in that list (1, 第一家, "
         "first) or its name; at: YYYY-MM-DDTHH:MM; party: how many people. No list shown yet: places_search first.",
    resolve=book_resolve, run=book_run, compensate=book_compensate,
    describe=lambda ctx, r: ctx.t(f"在{r['name']}订座：{r['date']} {r['time']}，{r['party']} 位",
                                  f"Book a table at {r['name']}: {r['date']} {r['time']}, {r['party']} people"),
    reply=book_reply,
    card=lambda ctx, r, res: {"type": "reservation", "code": res["code"], "status": "booked",
                              **{k: r[k] for k in ("name", "address", "phone", "map_url", "sources", "date", "time", "party")}},
    rule="Y_BOOKING",
))


# --- the customer's bookings ---


def upcoming(ctx: Ctx) -> list[Reservation]:
    now = ctx.now.astimezone(CST).strftime("%Y-%m-%dT%H:%M")
    return list(ctx.session.exec(select(Reservation).where(Reservation.user_id == ctx.user.id, Reservation.status == "booked",
                                                           Reservation.at >= now).order_by(col(Reservation.at))))


def reservations_reply(ctx: Ctx, r: dict, res: dict) -> str:
    """A first line the app shows above the card, then the list for where there is no card (WeChat)."""
    items = res["items"]
    if not items:
        return ctx.t("没有待用餐的订座。", "No upcoming bookings.")
    lines = [ctx.t(f"你有 {len(items)} 条待用餐的订座：", f"You have {len(items)} upcoming booking{'s' * (len(items) > 1)}:")]
    lines += [ctx.t(f"· {x['date'][5:]} {x['time']} {x['name']}，{x['party']} 位（{x['code']}）",
                    f"· {x['date'][5:]} {x['time']} {x['name']}, {x['party']} people ({x['code']})") for x in items]
    return "\n".join(lines)


def reservations_run(ctx: Ctx, r: dict) -> dict:
    return {"items": [{"code": x.code, "name": x.name, "address": x.address, "phone": x.phone,
                       "date": x.at[:10], "time": x.at[11:16], "party": x.party} for x in upcoming(ctx)]}


register(Action(
    name="reservations", args=Args, help="List the customer's upcoming table bookings.",
    resolve=lambda ctx, a: {}, run=reservations_run,
    describe=lambda ctx, r: ctx.t("查看订座", "List table bookings"),
    reply=reservations_reply,
    card=lambda ctx, r, res: {"type": "reservations", **res},
))


# --- cancelling a booking ---


class CancelBookingArgs(Args):
    booking: str | None = Field(default=None, max_length=60)


def cancel_resolve(ctx: Ctx, args: CancelBookingArgs) -> dict:
    """Which upcoming booking: its code, its day (YYYY-MM-DD) or the place's name; the only one if there is one."""
    rows = upcoming(ctx)
    if not rows:
        raise Refuse("NO_BOOKINGS", "现在没有可以取消的订座。", "There are no upcoming bookings to cancel.")
    ref = (args.booking or "").strip().casefold()
    picked = [x for x in rows if ref and (ref == x.code.casefold() or ref == x.at[:10] or ref in x.name.casefold())] \
        if ref else rows
    if not picked:
        picked = rows  # nothing matched what was said: let the customer choose from all of them
    if len(picked) > 1:
        raise Ask("booking", "取消哪一个订座？", "Which booking should I cancel?", [
            {"value": x.code, "label_zh": f"{x.at[:10]} {x.at[11:16]} {x.name}，{x.party} 位",
             "label_en": f"{x.at[:10]} {x.at[11:16]} {x.name}, {x.party} people"} for x in picked][:6])
    x = picked[0]
    return {"reservation_id": x.id, "code": x.code, "name": x.name, "address": x.address, "date": x.at[:10],
            "time": x.at[11:16], "party": x.party}


def cancel_run(ctx: Ctx, r: dict) -> dict:
    row = ctx.session.get(Reservation, r["reservation_id"])
    if row is None or row.user_id != ctx.user.id or row.status != "booked":
        raise Refuse("NOT_BOOKED", "这条订座已经取消了。", "That booking is already cancelled.")
    row.status = "cancelled"
    ctx.session.add(row)
    return {"cancelled": True}


def cancel_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    # undone with the plan: the table is booked again, if its time hasn't passed
    row = ctx.session.get(Reservation, r["reservation_id"])
    if row and row.status == "cancelled" and row.at >= ctx.now.astimezone(CST).strftime("%Y-%m-%dT%H:%M"):
        row.status = "booked"
        ctx.session.add(row)
        return {"restored": True}
    return {"restored": False}


register(Action(
    name="cancel_booking", args=CancelBookingArgs,
    help="Cancel one of the customer's upcoming table bookings. booking: its code, its day (YYYY-MM-DD) or the place's "
         "name, if they said one; the bank asks which when there are several.",
    resolve=cancel_resolve, run=cancel_run, compensate=cancel_compensate,
    describe=lambda ctx, r: ctx.t(f"取消{r['name']}的订座：{r['date']} {r['time']}，{r['party']} 位",
                                  f"Cancel the table at {r['name']}: {r['date']} {r['time']}, {r['party']} people"),
    reply=lambda ctx, r, res: ctx.t(f"已取消{r['name']} {r['date']} {r['time']} 的订座（{r['code']}）。",
                                    f"Cancelled the table at {r['name']} on {r['date']} {r['time']} ({r['code']})."),
    rule="Y_BOOKING_CANCEL",
))
