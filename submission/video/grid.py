"""A scene as a grid of thumbnails, one per step seconds, labelled with recorded time: python grid.py <scene dir> <step> <out>"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

scene, step, out = Path(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
meta = json.loads((scene / "scene.json").read_text())
frames = meta["frames"]
times, t = [], 0.0
while t <= meta["end"] - meta["start"]:
    times.append(t)
    t += step
cols, w, h = 13, 150, 325
rows = (len(times) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (w + 6) + 6, rows * (h + 26) + 6), "white")
draw = ImageDraw.Draw(sheet)
for i, t in enumerate(times):
    name, ft = min(frames, key=lambda f: abs(f[1] - meta["start"] - t))
    x, y = 6 + (i % cols) * (w + 6), 6 + (i // cols) * (h + 26)
    sheet.paste(Image.open(scene / name).convert("RGB").resize((w, h)), (x, y + 20))
    gap = abs(ft - meta["start"] - t) > step / 2
    draw.text((x, y + 4), f"{t:.1f}s" + (" (paused)" if gap else ""), fill="red" if gap else "black")
sheet.save(out, quality=82)
