"""Review credibility for the places a search just showed: the card asks, the rules answer.

The map services hand us a star rating, and a rating is the one number a review ring knows how to buy. This reads
back the places that search put on the customer's screen (PlaceSeen, written from the map services' data, never
from the model), runs app/trust.py over reviews simulated from each place's id, and answers with what it
intercepted and why. No model sits in this path: the numbers and the sentences are code.

The result is appended to the customer's audit chain, so a reason shown on screen can be checked afterwards.
"""

from fastapi import APIRouter, Depends, Request
from sqlmodel import Session, select

from app import trust
from app.agent import audit
from app.api.accounts import throttle
from app.api.security import require_user
from app.models import PlaceSeen

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


@router.get("/places/trust")
def places_trust(request: Request, search: str, user_id: str = Depends(require_user)):
    """Each place the card showed, with the rules' verdict on its reviews. Unknown or another customer's
    search id returns nothing: the rows are read with the signed-in user as the filter."""
    throttle(request, [("trust", user_id, 600, 40)])
    with Session(request.app.state.runtime.engine) as session:
        rows = sorted(session.exec(select(PlaceSeen).where(PlaceSeen.user_id == user_id)
                                   .where(PlaceSeen.search_id == search)), key=lambda r: r.rank)
        if not rows:
            return {"items": []}
        items = []
        for row in rows:
            result = trust.gate(row.data, trust.ReviewTrust(trust.reviews_for(row.data)).analyze())
            items.append({"id": row.place_id, "rank": row.rank, "name": row.data.get("name"),
                          "status": result["status"], "trust_score": result.get("trust_score"),
                          "recommend": result.get("recommend"), "flagged_share": result.get("flagged_share"),
                          "reason_zh": result.get("reason_zh"), "reason_en": result.get("reason_en"),
                          "low_rating": bool(result.get("low_rating")), "rating": row.data.get("rating"),
                          "summary_zh": result.get("summary_zh"), "summary_en": result.get("summary_en"),
                          "samples": result.get("samples") or {"real": [], "fake": []}})
        audit.append(session, user_id, "trust_checked",
                     {"search": search, "checked": len(items),
                      "intercepted": [i["name"] for i in items if i["recommend"] is False]})
        session.commit()
    return {"items": items}
