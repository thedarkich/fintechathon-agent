"""Paying a shop by scanning its QR code (扫码付).

A shop shows one of two codes: a static code printed at the till, where the customer types the amount, or a
code the till makes for one sale, which carries the amount and an order number. The code holds only
`BAQR1:<shop>:<amount in fen or empty>:<order>`; everything else (the shop's registered name, its city) comes
from the bank's own merchant records, so a code cannot rename a shop. A code can also be a link to the
bank's pay screen (…/#/qr?p=BAQR1:…), so a phone camera opens the app straight on the payment.
"""

import re
from urllib.parse import parse_qs, unquote, urlparse

# code: registered name, English name, city, spending category
MERCHANTS = {
    "M1001": ("瑞幸咖啡（光谷广场店）", "Luckin Coffee, Guanggu Square", "武汉", "dining"),
    "M1002": ("罗森便利店（关山大道店）", "Lawson, Guanshan Avenue", "武汉", "groceries"),
    "M1003": ("蔡林记热干面（光谷店）", "Cai Lin Ji noodles, Guanggu", "武汉", "dining"),
    "M1004": ("盒马鲜生（光谷店）", "Freshippo, Guanggu", "武汉", "groceries"),
    "M1005": ("光谷书城", "Guanggu Book City", "武汉", "shopping"),
    "M1006": ("滴滴出行", "DiDi rides", "武汉", "transport"),
}
PAYLOAD = re.compile(r"^BAQR1:(M\d{4}):(\d{0,9}):([A-Za-z0-9-]{0,24})$")
MAX_FEN = 5_000_000  # a till never asks for more than ¥50,000 in one sale


def payload(code: str, fen: int | None = None, order: str = "") -> str:
    return f"BAQR1:{code}:{fen or ''}:{order}"


def read(text: str) -> dict | None:
    """What a scanned code says, or None if it is not one of this bank's payment codes."""
    text = (text or "").strip()
    if text.startswith(("http://", "https://")):
        fragment = urlparse(text).fragment  # '/qr?p=BAQR1:…'
        query = fragment.split("?", 1)[1] if "?" in fragment else ""
        text = unquote((parse_qs(query).get("p") or [""])[0])
    match = PAYLOAD.match(text)
    if not match or match.group(1) not in MERCHANTS:
        return None
    fen = int(match.group(2)) if match.group(2) else None
    if fen is not None and not 0 < fen <= MAX_FEN:
        return None
    return {"code": match.group(1), "fen": fen, "order": match.group(3) or None}


def merchant_view(code: str, lang: str) -> dict:
    name, name_en, city, category = MERCHANTS[code]
    return {"code": code, "name": name if lang == "zh" else name_en, "city": city if lang == "zh" else "Wuhan",
            "category": category}
