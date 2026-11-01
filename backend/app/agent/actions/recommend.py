"""Which of the places just shown can you actually trust?

A map hands out a star rating, and a star rating is the one number a review-farming ring knows how to buy.
This action
runs the rule engine in app/trust.py over the places the last search showed (PlaceSeen, written by the map
services and never by the model), and answers with a reason instead of a score: what was intercepted, and
why. It is green — it reads, it moves no money — so the customer is never asked to approve a check.

Honesty note the reply repeats every time: the review text is simulated, seeded from the place id so it is
the same on every machine; the rules, thresholds and verdicts are real code.
"""

from pydantic import Field
from sqlmodel import select

from app import trust
from app.agent.core import Action, Args, Ctx, Refuse, register
from app.agent.actions.places import find_place
from app.models import PlaceSeen


class CheckArgs(Args):
    place: str | None = Field(default=None, max_length=120)


def _latest(ctx: Ctx) -> list[dict]:
    """The places the last search put on the customer's screen, in the order shown."""
    rows = sorted(ctx.session.exec(select(PlaceSeen).where(PlaceSeen.user_id == ctx.user.id).limit(200)),
                  key=lambda r: (r.asked_at or r.seen_at, -r.rank), reverse=True)
    if not rows:
        raise Refuse("NO_PLACES", "先让我找找附近有什么，我才知道要核对哪几家。",
                     "Let me find places near you first, so there is something to check.")
    return [row.data for row in sorted((r for r in rows if r.search_id == rows[0].search_id), key=lambda r: r.rank)]


def check_resolve(ctx: Ctx, args: CheckArgs) -> dict:
    places = [find_place(ctx, args.place).data] if args.place else _latest(ctx)
    return {"places": [{"id": p.get("id"), "name": p.get("name"), "rating": p.get("rating"),
                        "cost_yuan": p.get("cost_yuan"), "distance_m": p.get("distance_m")} for p in places],
            "single": bool(args.place)}


def _view(entry) -> dict:
    result = entry["trust"]
    return {"name": entry["place"]["name"], "rating": entry["place"].get("rating"),
            "status": result["status"], "trust_score": result.get("trust_score"),
            "flagged_share": result.get("flagged_share"),
            "reason_zh": result.get("reason_zh"), "reason_en": result.get("reason_en"),
            "summary_zh": result.get("summary_zh"), "summary_en": result.get("summary_en")}


def check_run(ctx: Ctx, r: dict) -> dict:
    scored = trust.check_places(r["places"])
    return {"checked": scored["checked"],
            "pick": _view(scored["pick"]) if scored["pick"] else None,
            "blocked": [_view(s) for s in scored["blocked"]],
            "unreadable": [_view(s) for s in scored["unreadable"]]}


def check_describe(ctx: Ctx, r: dict) -> str:
    if r["single"]:
        return ctx.t(f"核对「{r['places'][0]['name']}」的评价真实性", f"Check the reviews of {r['places'][0]['name']}")
    return ctx.t(f"核对刚才那 {len(r['places'])} 家的评价真实性",
                 f"Check the reviews of the {len(r['places'])} places just shown")


def check_reply(ctx: Ctx, r: dict, res: dict) -> str:
    """Every fact in this sentence was computed by code, and the simulation is named out loud."""
    blocked, pick, unreadable = res["blocked"], res["pick"], res["unreadable"]
    if not pick and not blocked and unreadable:
        return ctx.t(f"我试着核对 {res['checked']} 家，但评价数据读不出可用的字段，"
                     "数据不可信时我不替它们背书。",
                     f"I tried to check {res['checked']} places, but the review data had no usable fields; "
                     "I don't vouch for data I can't read.")
    head = ctx.t(f"我核对了 {res['checked']} 家的评价（评价文本是按店铺编号生成的模拟数据，"
                 f"规则和判定是真代码）。",
                 f"I checked the reviews of {res['checked']} places (the review text is simulated from each "
                 f"place's id; the rules and the verdicts are real code).")
    if pick:
        line = ctx.t(f"推荐「{pick['name']}」：{pick['summary_zh']}",
                     f"I'd go with {pick['name']}: {pick['summary_en']}")
    else:
        line = ctx.t("这几家我一家都不替它们背书：", "I can't vouch for any of these:")
    tail = "".join(ctx.t(f"「{b['name']}」我没有选：{b['reason_zh']}。", f" {b['name']} is out: {b['reason_en']}.")
                   for b in blocked[:2])
    if not pick:
        line = line + tail
        tail = ""
    return " ".join(x for x in (head, line, tail) if x)


register(Action(
    name="place_reviews_check", args=CheckArgs,
    help="Check whether the reviews of the places just found by places_search are believable, and pick one to "
         "trust: it reports what it intercepted and why (reviews published in one burst, cloned wording, emotion "
         "with no verifiable detail). place: one name or number from that list, or leave it out to check the "
         "whole batch. Read-only, no money. Needs places_search first.",
    resolve=check_resolve, run=check_run, describe=check_describe, reply=check_reply,
    examples=["刚才那几家哪家评价是真的", "帮我挑一家靠谱的，理由", "which of these can I trust"],
))
