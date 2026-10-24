"""The pitch decks as PDFs, one 1920x1080 slide per page, plus a contact sheet per deck, printed by headless Chrome.
The slide files are the ones in the decks on claude.ai (Slides): deck.json and slides/*.html per deck; images.json maps
each /_blob/ image to its file here. Speaker notes (<aside>) are left out of the PDFs.

    cd backend && uv run python ../submission/build_slides.py      # writes submission/pdf/

Fonts come from Google Fonts (deck.json "faces"); the script prints which loaded. If Noto Sans SC is missing, the
Chinese decks fall back to whatever CJK font the machine has (or none): build them where the font loads.
"""
import asyncio
import base64
import io
import json
import re
import sys
from pathlib import Path

from cdp import Chrome

HERE = Path(__file__).resolve().parent
SLIDES = HERE / "slides"
OUT = HERE / "pdf"
DECKS = [("zh-submission", "中联银行-路演-提交版"), ("zh-live", "中联银行-路演-现场版"), ("en-live", "Central-Union-Bank-pitch-English")]

ICONS = {  # stroke icons in the deck's icon set, drawn the same way
    "Check": '<path d="M20 6 9 17l-5-5"/>',
    "Warning": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    "Link": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    "Chart": '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    "Chat": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    "Lock": '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
}
SHAPES = {"arrow-right": "0,30 60,30 60,0 100,50 60,100 60,70 0,70", "arrow-down": "30,0 70,0 70,60 100,60 50,100 0,60 30,60"}

CSS = """
@page { size: 1920px 1080px; margin: 0 }
html, body { margin: 0; padding: 0; background: #ffffff }
section { position: relative; width: 1920px; height: 1080px; overflow: hidden; break-after: page; }
section, section * { box-sizing: border-box; margin: 0 }
img { display: block }
table { border-collapse: collapse; width: 100%; overflow: hidden }
th, td { padding: 0.35em 0.6em; border-bottom: 1px solid #DCE3DF; vertical-align: top }
th { font-weight: 700 }
aside { display: none }
x-shape, x-icon { display: block; flex: none }
"""

SHIM = """
<script>
const ICONS = %s, SHAPES = %s;
for (const el of document.querySelectorAll('x-icon')) {
  const color = el.style.color || 'currentColor', w = el.style.width, h = el.style.height;
  el.innerHTML = `<svg viewBox="0 0 24 24" width="${parseInt(w)}" height="${parseInt(h)}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[el.getAttribute('name')] || ''}</svg>`;
}
for (const el of document.querySelectorAll('x-shape')) {
  const fill = el.style.background || el.style.backgroundColor || '#999', w = parseInt(el.style.width), h = parseInt(el.style.height);
  el.style.background = 'transparent';
  el.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" width="${w}" height="${h}"><polygon points="${SHAPES[el.getAttribute('kind')] || ''}" fill="${fill}"/></svg>`;
}
</script>
"""


def page_for(deck_dir: Path) -> tuple[Path, int]:
    deck = json.loads((deck_dir / "deck.json").read_text(encoding="utf-8"))
    images = json.loads((SLIDES / "images.json").read_text(encoding="utf-8"))
    faces = "".join(f'<link rel="stylesheet" href="{f["href"]}">' for f in deck["faces"].values())
    slides = []
    for sid in deck["order"]:
        html = (deck_dir / "slides" / f"{sid}.html").read_text(encoding="utf-8")
        html = re.sub(r"<aside>.*?</aside>", "", html, flags=re.S)
        html = re.sub(r"/_blob/([0-9a-f]{32})", lambda m: (SLIDES / images[m.group(1)]).resolve().as_uri(), html)
        slides.append(html)
    page = (f'<!doctype html><html><head><meta charset="utf-8"><title>{deck["title"]}</title>{faces}<style>{CSS}</style></head>'
            f'<body>{"".join(slides)}{SHIM % (json.dumps(ICONS), json.dumps(SHAPES))}</body></html>')
    path = OUT / f"{deck_dir.name}.html"
    path.write_text(page, encoding="utf-8")
    return path, len(slides)


async def main():
    OUT.mkdir(exist_ok=True)
    async with Chrome() as chrome:
        await chrome.send("Emulation.setDeviceMetricsOverride", width=1920, height=1080, deviceScaleFactor=1, mobile=False)
        for folder, name in DECKS:
            page, count = page_for(SLIDES / folder)
            seen = await chrome.open(page)
            pdf = await chrome.send("Page.printToPDF", printBackground=True, preferCSSPageSize=True, paperWidth=20,
                                    paperHeight=11.25, marginTop=0, marginBottom=0, marginLeft=0, marginRight=0)
            target = OUT / f"{name}.pdf"
            target.write_bytes(base64.b64decode(pdf["data"]))
            sheet = await contact_sheet(chrome, count, OUT / f"{folder}-sheet.png")
            print(f"{target.name}: {count} slides, {target.stat().st_size // 1024} KB | fonts loaded: {seen['fonts']} | "
                  f"broken images: {seen['broken']}{sheet}")


async def contact_sheet(chrome: Chrome, count: int, target: Path) -> str:
    """Every slide at a quarter size on one image, for a quick look. Needs Pillow (in the backend's environment)."""
    try:
        from PIL import Image
    except ImportError:
        return ""
    thumbs = []
    for i in range(count):
        shot = await chrome.send("Page.captureScreenshot", format="png", captureBeyondViewport=True,
                                 clip={"x": 0, "y": i * 1080, "width": 1920, "height": 1080, "scale": 0.25})
        thumbs.append(Image.open(io.BytesIO(base64.b64decode(shot["data"]))).convert("RGB"))
    cols = 4
    sheet = Image.new("RGB", (cols * 490, ((count + cols - 1) // cols) * 280), "white")
    for i, im in enumerate(thumbs):
        sheet.paste(im, ((i % cols) * 490, (i // cols) * 280))
    sheet.save(target)
    return f" | sheet: {target.name}"


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    asyncio.run(main())
