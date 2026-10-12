"""Text a person can't see in a PDF: white, tiny, off-page or zero-area spans."""

from app.pipeline.ingest import Document


def hidden_spans(document: Document) -> list[dict]:
    if document.kind != "pdf":
        return []
    found = []
    for index, page in enumerate(document.pages):
        width, height = page["width"], page["height"]
        for block in page.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    if not text.strip():
                        continue
                    x0, y0, x1, y1 = span["bbox"]
                    color = span.get("color", 0)
                    reasons = []
                    if x1 <= x0 or y1 <= y0:
                        reasons.append("zero_area")
                    if x0 < 0 or y0 < 0 or x1 > width or y1 > height:
                        reasons.append("off_page")
                    if span.get("size", 0) < 4:
                        reasons.append("tiny_font")
                    if all(((color >> shift) & 255) >= 240 for shift in (16, 8, 0)):
                        reasons.append("near_white")
                    if reasons:
                        found.append({"text": text[:200], "reasons": reasons, "page": index + 1})
    return found


def visible_text(document: Document) -> str:
    """The PDF text layer without hidden spans."""
    hidden = {s["text"] for s in hidden_spans(document)}
    lines = []
    for page in document.pages:
        for block in page.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                text = "".join(span.get("text", "") for span in line.get("spans", []) if span.get("text", "") not in hidden)
                if text.strip():
                    lines.append(text)
    return "\n".join(lines)
