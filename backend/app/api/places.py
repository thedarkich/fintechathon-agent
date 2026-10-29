"""Real places near the customer (app/places.py), for the card the assistant shows when asked to find somewhere.

The browser sends its location only here, only when the customer allows it, and it goes on to the map services and
nowhere else: it is not stored or audited. What a search showed is kept (PlaceSeen) so that a booking can point at
it, and only the latest few searches are.
"""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import desc, func
from sqlmodel import Session, col, delete, select

from app.agent import audit
from app.api.accounts import throttle
from app.api.security import problem, require_user
from app.models import PlaceSeen, Plan, new_id, now_iso
from app.places import FALLBACK, FALLBACK_LABEL, RADIUS, view

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
KEEP_SEARCHES = 5
WIDER = 8000  # metres, when the usual radius finds little


@router.get("/places/search")
async def places_search(request: Request, q: str = Query(min_length=1, max_length=30),
                        lat: float | None = Query(default=None, ge=-90, le=90),
                        lon: float | None = Query(default=None, ge=-180, le=180),
                        near: str | None = Query(default=None, max_length=40),
                        ref: str | None = Query(default=None, max_length=40, pattern=r"^[0-9a-f-]{36}$"),
                        lang: Literal["zh", "en"] = "zh", user_id: str = Depends(require_user)):
    # each search reaches up to three outside services, one of which allows a request a second
    throttle(request, [("places", user_id, 600, 40)])
    places = request.app.state.runtime.places
    centre, located, label = None, "fallback", None
    device = (lat, lon) if lat is not None and lon is not None else None
    if near and (named := await places.locate(near, lang, centre=device or FALLBACK)):
        centre, located, label = named, "named", near
    elif device:
        centre, located = device, "device"
    if centre is None:
        centre, label = FALLBACK, FALLBACK_LABEL[0] if lang == "zh" else FALLBACK_LABEL[1]
    found, sources = await places.search(q, centre[0], centre[1], lang=lang)
    radius = RADIUS
    if len(found) < 3:  # thin coverage (OpenStreetMap's florists, say): look once more, further out
        wider, wider_sources = await places.search(q, centre[0], centre[1], radius=WIDER, lang=lang)
        if len(wider) >= len(found):  # including none at all: the card then says how far it looked
            found, sources, radius = wider, wider_sources, WIDER
    search_id = new_id()
    with Session(request.app.state.runtime.engine) as session:
        # a card loading again (a reload, a reopened chat) refreshes its own search, keeping when it was asked
        asked = session.get(Plan, ref) if ref else None
        if asked is None or asked.user_id != user_id:
            asked, ref = None, None
        else:
            session.exec(delete(PlaceSeen).where(PlaceSeen.user_id == user_id, PlaceSeen.ref == ref))
        asked_at = asked.created_at if asked else now_iso()
        latest = func.max(func.coalesce(PlaceSeen.asked_at, PlaceSeen.seen_at)).label("latest")
        older = [row[0] for row in session.exec(select(PlaceSeen.search_id, latest).where(PlaceSeen.user_id == user_id)
                                                .group_by(PlaceSeen.search_id).order_by(desc("latest"))).all()]
        if len(older) >= KEEP_SEARCHES:
            session.exec(delete(PlaceSeen).where(PlaceSeen.user_id == user_id,
                                                 col(PlaceSeen.search_id).in_(older[KEEP_SEARCHES - 1:])))
        for rank, place in enumerate(found, 1):
            session.add(PlaceSeen(user_id=user_id, search_id=search_id, rank=rank, place_id=place.id, ref=ref, asked_at=asked_at,
                                  data=view(place, rank, "zh") | {"lat": place.lat, "lon": place.lon,
                                                                  "photo_urls": place.photos}))
        audit.append(session, user_id, "places_search", {"query": q, "near": near, "located": located,
                                                          "sources": sources, "found": len(found)})
        session.commit()
    return {"search_id": search_id, "items": [view(p, rank, lang) for rank, p in enumerate(found, 1)],
            "sources": sources, "located": located, "label": label, "near_missed": bool(near) and located != "named",
            "radius_m": radius}


@router.get("/places/photo")
async def place_photo(request: Request, id: str = Query(min_length=3, max_length=120), n: int = Query(ge=0, le=4),
                      user_id: str = Depends(require_user)):
    """A photo of a place a search showed this customer: its address comes from the map service's answer, never from
    the request, so this fetches nothing else."""
    throttle(request, [("place-photos", user_id, 600, 300)])
    with Session(request.app.state.runtime.engine) as session:
        seen = session.exec(select(PlaceSeen).where(PlaceSeen.user_id == user_id, PlaceSeen.place_id == id)
                            .order_by(col(PlaceSeen.seen_at).desc())).first()
    urls = (seen.data.get("photo_urls") or []) if seen else []
    got = await request.app.state.runtime.places.photo(urls[n]) if n < len(urls) else None
    if got is None:
        raise problem(404, "No such photo.", "没有这张照片。")
    return Response(content=got[0], media_type=got[1],
                    headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"})
