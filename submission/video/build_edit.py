"""Builds the demo video's Hyperframes project from the recorded scenes (see scenes.py for what each one says).

Each scene becomes a clip of its recorded frames at their real timing, except: the model's thinking time is squeezed to
about a second (and marked on screen as sped up), the rate-limit pauses are dropped, and listed stretches play faster.
Captions, the tier ladder and zooms are placed by recorded time, so they stay on their moments whatever the speed-ups.
Usage: python build_edit.py [--no-clips], reading work/raw and writing work/project ($VIDEO_WORK moves work/)
"""
import html
import json
import os
import subprocess
import sys
from pathlib import Path

from scenes import SCENES, TIERS, TIMED_ON

HERE = Path(__file__).resolve().parent
WORK = Path(os.environ.get("VIDEO_WORK", HERE / "work"))
RAW = WORK / "raw"
PROJECT = WORK / "project"
FFMPEG = os.environ.get("HYPERFRAMES_FFMPEG_PATH", "ffmpeg")
WAIT = 1.0        # seconds a model wait lasts on screen
OVERLAP = 0.35    # crossfade between scenes
INTRO, OUTRO = 5.0, 9.0
FRAME = 1 / 34    # one captured frame, used where capture was paused


def retime(cfg, meta):
    """The scene's times, measured on the take in TIMED_ON, moved onto this take.

    Between the model's waits the recorder's steps take fixed time, so a moment keeps its distance from the nearest
    wait that no rate-limit pause separates it from; inside a wait it keeps its share of the wait."""
    old = TIMED_ON.get(cfg["raw"])
    new = [(x - meta["start"], y - meta["start"]) for x, y in meta["fast"]]
    if not old or not old["fast"]:
        return cfg
    if len(old["fast"]) != len(new):
        print(f"  ! {cfg['raw']}: {len(new)} waits, timed on {len(old['fast'])}; times left as they were")
        return cfg
    cuts = old["cuts"]

    def move(t):
        options = []
        for (a, b), (na, nb) in zip(old["fast"], new):
            if a <= t <= b:
                return na + (t - a) / (b - a) * (nb - na)
            if t < a and not any(t < c < a for c in cuts):
                options.append((a - t, na + (t - a)))
            if t > b and not any(b < c < t for c in cuts):
                options.append((t - b, nb + (t - b)))
        return round(min(options)[1], 3) if options else t

    out = dict(cfg)
    out["trim"] = (move(cfg["trim"][0]), min(move(cfg["trim"][1]), meta["end"] - meta["start"]))
    out["speed"] = [(move(a), move(b), k) for a, b, k in cfg.get("speed", [])]
    out["beats"] = [(move(t), zh, en) for t, zh, en in cfg["beats"]]
    out["tier"] = [(move(t), k) for t, k in cfg.get("tier", [])]
    out["zooms"] = [(move(a), move(b), s, x, y) for a, b, s, x, y in cfg.get("zooms", [])]
    return out


def clip_timing(meta, cfg):
    """The frames kept, each with its time in the clip and how long it stays on screen."""
    s = meta["start"]
    a, b = cfg["trim"]
    frames = [(name, t - s) for name, t in meta["frames"] if a <= t - s <= b]
    fast = [(x - s, y - s) for x, y in meta["fast"]]

    def speed(t):
        for x, y in fast:
            if x <= t < y:
                return max((y - x) / WAIT, 1.0)
        for x, y, k in cfg.get("speed", []):
            if x <= t < y:
                return k
        return 1.0

    out, at = [], 0.0
    for i, (name, t) in enumerate(frames):
        if i + 1 < len(frames):
            gap = frames[i + 1][1] - t
            shown = (FRAME if gap > 0.25 else gap) / speed(t)
        else:
            shown = 0.5 + OVERLAP   # the last frame holds while the next scene fades in
        out.append((name, t, at, shown))
        at += shown
    waits = [(x, y, (y - x) / WAIT) for x, y in fast if a <= x and y <= b and y - x > WAIT]
    return out, at, waits


def to_clip(frames, t):
    """Clip time of a recorded moment: the last frame captured at or before it."""
    before = [f for f in frames if f[1] <= t]
    return before[-1][2] if before else 0.0


def encode(cfg, frames):
    listing = PROJECT / "clips" / f"{cfg['raw']}.txt"
    lines = ["ffconcat version 1.0"]
    for name, _, _, shown in frames:
        lines += [f"file '{RAW / cfg['raw'] / name}'", f"duration {shown:.5f}"]
    lines.append(f"file '{RAW / cfg['raw'] / frames[-1][0]}'")
    listing.write_text("\n".join(lines) + "\n")
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-vf", "scale=780:1688:flags=lanczos,fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow",
                    "-crf", "16", "-r", "30", "-movflags", "+faststart", "-an",
                    str(PROJECT / "clips" / f"{cfg['raw']}.mp4")], check=True)
    listing.unlink()


def esc(text):
    return html.escape(text, quote=True)


def main():
    make_clips = "--no-clips" not in sys.argv
    (PROJECT / "clips").mkdir(parents=True, exist_ok=True)
    data = {"overlap": OVERLAP, "introEnd": INTRO, "scenes": [], "tiers": []}
    videos, captions, chips = [], [], []
    cursor = INTRO
    total_scenes = len(SCENES)
    for i, cfg in enumerate(SCENES, 1):
        meta = json.loads((RAW / cfg["raw"] / "scene.json").read_text())
        cfg = retime(cfg, meta)
        frames, length, waits = clip_timing(meta, cfg)
        if make_clips:
            encode(cfg, frames)
        start = cursor - OVERLAP
        cursor = start + length
        at = lambda t: round(start + to_clip(frames, t), 3)  # noqa: E731
        scene = {"i": i, "start": round(start, 3), "end": round(cursor - OVERLAP, 3), "beats": [], "zooms": []}
        videos.append(f'<video id="v{i}" class="screen" src="clips/{cfg["raw"]}.mp4" data-start="{start:.3f}" '
                      f'data-duration="{length:.3f}" data-track-index="1" muted playsinline></video>')
        beats = []
        for k, (t, zh, en) in enumerate(cfg["beats"]):
            scene["beats"].append({"id": f"b{i}-{k}", "t": max(at(t), start + 0.25)})
            beats.append(f'<li id="b{i}-{k}" class="beat"><span class="zh">{esc(zh)}</span><span class="en">{esc(en)}</span></li>')
        for x, y, scale, ox, oy in cfg.get("zooms", []):
            scene["zooms"].append({"a": at(x), "b": at(y), "scale": scale, "ox": ox, "oy": oy})
        data["tiers"].append({"t": scene["start"], "tier": None})
        for t, tier in cfg.get("tier", []):
            data["tiers"].append({"t": max(at(t), start), "tier": tier})
        for k, (x, y, factor) in enumerate(waits):
            a, b = at(x), at(y)
            chips.append(f'<div id="ff{i}-{k}" class="ff clip" data-start="{a:.3f}" data-duration="{max(b - a, 1.4):.3f}" '
                         f'data-track-index="3"><span class="ff-zh">AI 正在规划</span><span class="ff-en">'
                         f'thinking, shown {factor:.0f}× faster</span></div>')
        scene_len = scene["end"] - scene["start"] if i < total_scenes else length
        captions.append(
            f'<section id="c{i}" class="cap clip" data-start="{start:.3f}" data-duration="{scene_len:.3f}" data-track-index="2">'
            f'<p class="count">{i:02d} / {total_scenes:02d}</p><h2 class="title">{esc(cfg["title"])}</h2>'
            f'<p class="title-en">{esc(cfg["title_en"])}</p><ol class="beats">{"".join(beats)}</ol></section>')
        data["scenes"].append(scene)
    outro_start = cursor - OVERLAP
    data["outroStart"] = round(outro_start, 3)
    data["duration"] = round(outro_start + OUTRO, 3)

    chapters = "".join(f'<span id="ch{i}" class="chap">{esc(c["chapter"])}<i></i></span>' for i, c in enumerate(SCENES, 1))
    tiers = "".join(f'<div id="tier{k}" class="tier tier-{k}"><span class="hl"></span><span class="pill">{esc(name)}</span>'
                    f'<span class="tier-text"><span class="zh">{esc(zh)}</span><span class="en">{esc(en)}</span></span></div>'
                    for k, (name, zh, en) in enumerate(TIERS))
    page = (HERE / "template.html").read_text()
    for key, value in {
        "__DURATION__": f"{data['duration']:.3f}",
        "__INTRO_DURATION__": f"{INTRO + 0.1:.3f}",
        "__OUTRO_START__": f"{outro_start:.3f}",
        "__OUTRO_DURATION__": f"{OUTRO:.3f}",
        "__VIDEOS__": "\n      ".join(videos),
        "__CAPTIONS__": "\n    ".join(captions),
        "__CHIPS__": "\n    ".join(chips),
        "__CHAPTERS__": chapters,
        "__TIERS__": tiers,
        "__DATA__": json.dumps(data, ensure_ascii=False),
    }.items():
        page = page.replace(key, value)
    (PROJECT / "index.html").write_text(page)
    print(f"{len(SCENES)} scenes, {data['duration']:.1f} s in all; outro at {outro_start:.1f} s")
    for s, cfg in zip(data["scenes"], SCENES):
        print(f"  {cfg['raw']:<13} {s['start']:6.1f} – {s['end']:6.1f}  ({s['end'] - s['start']:.1f} s)")


if __name__ == "__main__":
    main()
