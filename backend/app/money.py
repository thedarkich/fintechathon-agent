"""Integer fen in, formatted yuan out. Floats never touch a balance."""

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

MAX_FEN = 10_000_000_00  # ¥10,000,000: far above anything the demo bank allows


def to_fen(yuan) -> int:
    try:
        value = Decimal(str(yuan))
    except (InvalidOperation, ValueError):
        raise ValueError("not an amount") from None
    if not value.is_finite():
        raise ValueError("not an amount")
    fen = int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if abs(fen) > MAX_FEN:
        raise ValueError("amount out of range")
    return fen


def yuan(fen: int) -> str:
    """'¥1,234.50' (negative amounts as '-¥1,234.50')."""
    sign = "-" if fen < 0 else ""
    whole, cents = divmod(abs(fen), 100)
    return f"{sign}¥{whole:,}.{cents:02d}"


def plain(fen: int) -> str:
    """'1234.50', for places where the currency is already stated."""
    sign = "-" if fen < 0 else ""
    whole, cents = divmod(abs(fen), 100)
    return f"{sign}{whole}.{cents:02d}"


def bp(points: int) -> str:
    return f"{points / 100:.2f}%"
