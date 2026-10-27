"""Frames of the rendered video just after each caption appears and mid-zoom, as labelled sheets for review.

Usage: python check_frames.py <video> <out dir>   (reads the timings from the project's index.html)
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

video, out = sys.argv[1], Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
work = Path(os.environ.get("VIDEO_WORK", Path(__file__).resolve().parent / "work"))
if os.environ.get("DEMO") == "pc":
    work = work / "pc"
page = (work / "project" / "index.html").read_text()
data = json.loads(re.search(r"const D = (\{.*?\});\n", page).group(1))
ffmpeg = os.environ.get("HYPERFRAMES_FFMPEG_PATH", "ffmpeg")

checks = [(2.5, "intro")]
for s in data["scenes"]:
    for b in s["beats"]:
        checks.append((b["t"] + 1.1, f"scene {s['i']} {b['id']}"))
    for z in s["zooms"]:
        checks.append(((z["a"] + z["b"]) / 2 + 0.3, f"scene {s['i']} zoom"))
checks.append((data["outroStart"] + 3.0, "outro"))
checks.sort()

w, h, cols, per = 960, 540, 3, 6
shots = []
for t, label in checks:
    path = out / f"f{t:07.2f}.jpg"
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1",
                    "-vf", f"scale={w}:{h}", str(path)], check=True)
    shots.append((path, t, label))
for n in range(0, len(shots), per):
    group = shots[n:n + per]
    rows = (len(group) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (w + 8) + 8, rows * (h + 30) + 8), "white")
    draw = ImageDraw.Draw(sheet)
    for i, (path, t, label) in enumerate(group):
        x, y = 8 + (i % cols) * (w + 8), 8 + (i // cols) * (h + 30)
        sheet.paste(Image.open(path), (x, y + 24))
        draw.text((x, y + 6), f"{t:.1f}s  {label}", fill="black")
    sheet.save(out / f"sheet{n // per + 1:02d}.jpg", quality=84)
print(f"{len(shots)} frames, {(len(shots) + per - 1) // per} sheets in {out}")
