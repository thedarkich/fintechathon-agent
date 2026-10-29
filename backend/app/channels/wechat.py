"""The WeChat assistant channel (simulated): the assistant's answers as a chat app shows them.

"IM 里说，App 里确认": in the chat the customer can ask and plan, but anything that needs a yes is a link that opens the
confirmation card in the bank's own app, where the approval hash, the PIN and the SMS code apply. Chat messages sit on
the chat app's servers, so account and phone numbers are masked and long lists are cut short with a link to the app.
"""

import re
from urllib.parse import urlencode

from app.models import Message

MAX_LINES = 12

# where the app shows the whole of an answer the chat cuts short
PAGES = {"transactions": "/bills", "spending": "/bills", "report": "/bills", "anomalies": "/bills", "analysis": "/bills",
         "balances": "/home", "notifications": "/home", "cards": "/controls", "subscriptions": "/subscriptions",
         "holdings": "/wealth", "products": "/wealth", "compare": "/wealth", "scheduled": "/send", "payees": "/send",
         "collections": "/send"}


def mask(text: str) -> str:
    """'13971230418' → '139****0418', '6222021203457801' → '****7801'."""
    text = re.sub(r"(?<!\d)(1\d{2})\d{4}(\d{4})(?!\d)", r"\1****\2", text)
    return re.sub(r"(?<!\d)\d{8,19}(?!\d)", lambda m: "****" + m.group(0)[-4:], text)


def for_chat(text: str) -> str:
    """The app's wording where it points at a card the chat doesn't have."""
    return text.replace("，可在卡片里翻页", "，可在 App 里查看").replace(" pages in the card.", " pages in the app.")


def shorten(text: str, lang: str) -> tuple[str, bool]:
    lines = text.splitlines()
    if len(lines) <= MAX_LINES:
        return text, False
    rest = len(lines) - MAX_LINES
    return "\n".join(lines[:MAX_LINES] + [f"……还有 {rest} 行" if lang == "zh" else f"… {rest} more lines"]), True


def t(lang: str, zh: str, en: str) -> str:
    return zh if lang == "zh" else en


def replies(messages: list[Message], lang: str) -> list[dict]:
    """What the chat shows for the assistant's messages of one turn."""
    out: list[dict] = []
    for m in messages:
        if m.role == "user":
            continue
        text, cut = shorten(for_chat(mask(m.text)), lang) if m.text else ("", False)
        page = None
        confirm = None
        places = None
        for card in m.cards or []:
            if card.get("type") == "approval":
                confirm = card
            elif card.get("type") == "places":
                # the places are found by the app's own page, with the location the phone shares there
                places = "/places?" + urlencode({k: v for k, v in (("q", card.get("what")), ("near", card.get("near")),
                                                                   ("party", card.get("party")), ("date", card.get("date")),
                                                                   ("time", card.get("time"))) if v})
            elif card.get("type") == "question" and card.get("options"):
                labels = [o.get("label_zh" if lang == "zh" else "label_en") or str(o.get("value")) for o in card["options"]]
                text += "\n" + t(lang, "回复数字选择：", "Reply with a number:") + "".join(
                    f"\n{i + 1}. {mask(label)}" for i, label in enumerate(labels))
            elif card.get("type") in PAGES:
                page = PAGES[card["type"]]
        if confirm is not None:
            # the card's own text ('请核对：') is for the app; the chat says where the yes happens
            out.append({"kind": "confirm", "plan_id": confirm["plan_id"], "tier": confirm["tier"],
                        "lines": [mask(s["text"]) for s in confirm["steps"]],
                        "text": t(lang, "需要你在中联银行 App 里确认：", "This needs your OK in the Central Union Bank app:"),
                        "needs": t(lang, "交易密码 + 短信验证码", "your PIN and an SMS code") if confirm["tier"] == "red"
                        else t(lang, "点一下确认", "one tap to confirm"),
                        "url": f"/#/confirm/{confirm['plan_id']}"})
            continue
        if text:
            out.append({"kind": "text", "text": text})
        if places:
            out.append({"kind": "link", "text": t(lang, "在 App 里看附近的地方、订座 →", "See the places and book in the app →"),
                        "url": f"/#{places}"})
        if page and (cut or m.cards):
            out.append({"kind": "link", "text": t(lang, "在 App 里查看全部 →", "See it all in the app →"), "url": f"/#{page}"})
    return out
