"""Builds a demo video's Hyperframes project from the recorded scenes and the narration (scenes.py has both for the
phone demo, scenes_pc.py for the PC one, which DEMO=pc picks along with template-pc.html and work/pc).

Each scene becomes a clip of its recorded frames at their real timing, except: the model's thinking time is squeezed to
about a second (and marked on screen as sped up), the rate-limit pauses are dropped, listed stretches play faster, and
where a narration line needs longer than its stretch of the recording, the screen holds at that stretch's stillest
moment until the line has been said. Captions, the tier ladder and zooms are placed by recorded time, so they stay on
their moments whatever the timing. The narration (spoken by voice.py) and a quiet music bed (music.py) are mixed into
one track, the music stepping down whenever the voice speaks.

Usage: python build_edit.py [--no-clips | --silent], reading work/raw and writing work/project
  --no-clips  write the page and the sound without encoding the clips again (only when no timing has changed)
  --silent    no narration or music
$VIDEO_WORK moves work/.
"""
import hashlib
import html
import importlib
import json
import math
import os
import re
import subprocess
import sys
import wave
from pathlib import Path

PC = os.environ.get("DEMO") == "pc"
_script = importlib.import_module("scenes_pc" if PC else "scenes")
INTRO_VOICE, OUTRO_VOICE, SCENES, TIERS, TIMED_ON, VOICE = (getattr(_script, name) for name in
                                                            ("INTRO_VOICE", "OUTRO_VOICE", "SCENES", "TIERS", "TIMED_ON", "VOICE"))

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / ("template-pc.html" if PC else "template.html")
CLIP = "1320:836" if PC else "780:1688"   # the clips' size: the page at 1:1 in the browser, or the phone screen at 1.875x
WORK = Path(os.environ.get("VIDEO_WORK", HERE / "work")) / ("pc" if PC else "")
RAW = WORK / "raw"
PROJECT = WORK / "project"
VOICES = WORK / "voice"
FFMPEG = os.environ.get("HYPERFRAMES_FFMPEG_PATH", "ffmpeg")
WAIT = 1.0        # seconds a model wait lasts on screen
OVERLAP = 0.35    # crossfade between scenes
INTRO, OUTRO = 5.0, 9.0   # at least: longer when their narration needs it
FRAME = 1 / 34    # one captured frame, used where capture was paused
LEAD, GAP, TAIL = 0.2, 0.35, 0.4   # a line starts this long after its moment; lines this far apart; a scene's last line
                                   # ends this long before the next scene comes in
VOICE_LUFS, MUSIC_UNDER = -16.0, 15.0   # how loud the voice is, and how far under it the music sits before ducking
ROOM = "aecho=0.8:0.55:47|79|113|149:0.3|0.22|0.16|0.11,lowpass=f=7000"   # the music's bit of room


def narration():
    """Every line of narration as (id, words), in the order spoken."""
    lines = [("intro", INTRO_VOICE)]
    for cfg in SCENES:
        lines += [(f"{cfg['raw']}-{k}", words) for k, (_, words) in enumerate(cfg.get("voice", []))]
    return lines + [("outro", OUTRO_VOICE)]


def write_lines():
    """The lines to speak, also kept in lines.json; a line's file name changes with its words, the voice and its pace."""
    VOICES.mkdir(parents=True, exist_ok=True)
    lines = []
    for key, words in narration():
        digest = hashlib.sha1(f"{VOICE['name']}|{VOICE['rate']}|{words}".encode()).hexdigest()[:8]
        lines.append({"id": key, "file": f"{key}-{digest}.wav", "text": words})
    (VOICES / "lines.json").write_text(json.dumps({"voice": VOICE["name"], "rate": VOICE["rate"], "lines": lines},
                                                  ensure_ascii=False, indent=1))
    return lines


def seconds(path):
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


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
    out["voice"] = [(move(t), words) for t, words in cfg.get("voice", [])]
    out["tier"] = [(move(t), k) for t, k in cfg.get("tier", [])]
    out["zooms"] = [(move(a), move(b), s, x, y) for a, b, s, x, y in cfg.get("zooms", [])]
    return out


def clip_timing(meta, cfg, said=()):
    """The frames kept, each with its time in the clip and how long it stays on screen; the clip's length; the model's
    waits; when each narration line in said, (moment, seconds), starts; and how long the screen holds for them."""
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

    shown = []
    for i, (_, t) in enumerate(frames):
        if i + 1 < len(frames):
            gap = frames[i + 1][1] - t
            shown.append((FRAME if gap > 0.25 else gap) / speed(t))
        else:
            shown.append(0.5 + OVERLAP)   # the last frame holds while the next scene fades in
    sizes = [(RAW / cfg["raw"] / name).stat().st_size for name, _ in frames]

    def clock():
        times, at = [], 0.0
        for d in shown:
            times.append(at)
            at += d
        return times, at

    def index(t):
        """The last frame captured at or before t."""
        return max((i for i, (_, ft) in enumerate(frames) if ft <= t), default=0)

    def stillest(first, last):
        """Where to hold: the middle of the longest run of frames that look alike (a still screen encodes to the same
        size), outside the model's waits; the last of them when nothing is still."""
        options = [i for i in range(first, last + 1) if not any(x <= frames[i][1] < y for x, y in fast)] or [last]
        best, run, pick = 0, 0, options[-1]
        for n, i in enumerate(options):
            run = run + 1 if i > 0 and abs(sizes[i] - sizes[i - 1]) <= 0.002 * sizes[i] else 0
            if run > best:
                best, pick = run, options[n - run // 2]
        return pick

    _, plain = clock()
    starts, done = [], -math.inf
    for k, (t, length) in enumerate(said):
        times, total = clock()
        i = index(t)
        begin = max(times[i] + LEAD, done + GAP)
        done = begin + length
        if k + 1 < len(said):   # finished before the next line's moment
            j = index(said[k + 1][0])
            short, last = done + GAP - (times[j] + LEAD), max(i, j - 1)
        else:                   # finished before the next scene comes in
            short, last = done + TAIL - (total - OVERLAP), len(frames) - 1
        if short > 0:
            shown[stillest(i, last)] += short
        starts.append(begin)

    times, total = clock()
    out = [(name, t, times[n], shown[n]) for n, (name, t) in enumerate(frames)]
    waits = [(x, y, (y - x) / WAIT) for x, y in fast if a <= x and y <= b and y - x > WAIT]
    return out, total, waits, starts, total - plain


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
                    "-vf", f"scale={CLIP}:flags=lanczos,fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow",
                    "-crf", "16", "-r", "30", "-movflags", "+faststart", "-an",
                    str(PROJECT / "clips" / f"{cfg['raw']}.mp4")], check=True)
    listing.unlink()


def loudness(path, chain="", peak=False):
    """Integrated loudness in LUFS after an optional filter chain; with peak, the true peak in dBTP too."""
    meter = f"ebur128=framelog=quiet{':peak=true' if peak else ''}"
    err = subprocess.run([FFMPEG, "-nostats", "-i", str(path), "-af", f"{chain}{',' if chain else ''}{meter}",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    level = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])
    return (level, float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", err)[-1])) if peak else level


def sound(parts, duration):
    """The narration, each line at its time, over the music bed, as audio/sound.wav; the music sits MUSIC_UNDER below
    the voice and steps further down while the voice speaks. Returns what was measured."""
    audio = PROJECT / "audio"
    audio.mkdir(exist_ok=True)
    music, voice, bed, out = (audio / f"{n}.wav" for n in ("music", "voice", "bed", "sound"))
    subprocess.run([sys.executable, str(HERE / "music.py"), f"{duration:.2f}", str(music)], check=True)

    inputs, chains = [], []
    for n, (path, at) in enumerate(parts):
        inputs += ["-i", str(path)]
        chains.append(f"[{n}:a]aresample=48000,adelay={round(at * 1000)}[v{n}]")
    graph = ";".join(chains) + ";" + "".join(f"[v{n}]" for n in range(len(parts))) + \
        f"amix=inputs={len(parts)}:normalize=0,highpass=f=80,apad=whole_dur={duration:.3f},atrim=0:{duration:.3f}"
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", *inputs, "-filter_complex", graph, "-ac", "1",
                    "-c:a", "pcm_s16le", str(voice)], check=True)

    mono = VOICE_LUFS - 3.01   # the mix goes out the same on both channels, which a loudness meter counts 3 dB louder
    lift = mono - loudness(voice)
    drop = mono - MUSIC_UNDER - loudness(music, f"aresample=48000,{ROOM}")
    duck = (f"[0:a]volume={lift:.2f}dB,asplit=2[v][key];[1:a]aresample=48000,{ROOM},volume={drop:.2f}dB[m];"
            "[m][key]sidechaincompress=threshold=0.05:ratio=3:attack=60:release=600[bed]")
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(voice), "-i", str(music), "-filter_complex",
                    duck + ";[v][bed]amix=inputs=2:normalize=0,alimiter=limit=0.85:level=0,pan=stereo|c0=c0|c1=c0[out]",
                    "-map", "[out]", "-c:a", "pcm_s16le", str(out)], check=True)
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(voice), "-i", str(music), "-filter_complex",
                    duck + ";[v]anullsink", "-map", "[bed]", "-c:a", "pcm_s16le", str(bed)], check=True)
    mix, peak = loudness(out, peak=True)
    return {"mix": mix, "peak": peak, "under": loudness(voice, f"volume={lift:.2f}dB") - loudness(bed)}


def esc(text):
    return html.escape(text, quote=True)


def main():
    args = sys.argv[1:]
    silent = "--silent" in args
    if not silent:
        lines = write_lines()
        missing = [line["file"] for line in lines if not (VOICES / line["file"]).exists()]
        if missing:
            sys.exit(f"{len(missing)} of {len(lines)} lines not spoken yet: run ./video.sh voice, or build --silent")
        file = {line["id"]: VOICES / line["file"] for line in lines}
        durations = {key: seconds(path) for key, path in file.items()}
    make_clips = "--no-clips" not in args
    (PROJECT / "clips").mkdir(parents=True, exist_ok=True)

    intro = INTRO if silent else max(INTRO, 0.5 + durations["intro"] + 0.8)
    spoken = [] if silent else [(file["intro"], 0.5)]
    data = {"overlap": OVERLAP, "introEnd": intro, "scenes": [], "tiers": []}
    videos, captions, chips, held = [], [], [], []
    cursor = intro
    total_scenes = len(SCENES)
    for i, cfg in enumerate(SCENES, 1):
        meta = json.loads((RAW / cfg["raw"] / "scene.json").read_text())
        cfg = retime(cfg, meta)
        said = [] if silent else [(t, durations[f"{cfg['raw']}-{k}"]) for k, (t, _) in enumerate(cfg.get("voice", []))]
        frames, length, waits, starts, hold = clip_timing(meta, cfg, said)
        if make_clips:
            encode(cfg, frames)
        start = cursor - OVERLAP
        cursor = start + length
        held.append(hold)
        spoken += [(file[f"{cfg['raw']}-{k}"], start + b) for k, b in enumerate(starts)]
        at = lambda t: round(start + to_clip(frames, t), 3)  # noqa: E731
        scene = {"i": i, "start": round(start, 3), "end": round(cursor - OVERLAP, 3), "beats": [], "zooms": []}
        videos.append(f'<video id="v{i}" class="screen" src="clips/{cfg["raw"]}.mp4" data-start="{start:.3f}" '
                      f'data-duration="{length:.3f}" data-track-index="1" muted playsinline></video>')
        beats = []
        for k, (t, zh, en) in enumerate(cfg["beats"]):
            scene["beats"].append({"id": f"b{i}-{k}", "t": max(at(t), start + 0.25)})
            english = f'<span class="en">{esc(en)}</span>' if en else ""  # the Chinese videos have none
            beats.append(f'<li id="b{i}-{k}" class="beat"><span class="zh">{esc(zh)}</span>{english}</li>')
        for x, y, scale, ox, oy in cfg.get("zooms", []):
            scene["zooms"].append({"a": at(x), "b": at(y), "scale": scale, "ox": ox, "oy": oy})
        data["tiers"].append({"t": scene["start"], "tier": None})
        for t, tier in cfg.get("tier", []):
            data["tiers"].append({"t": max(at(t), start), "tier": tier})
        for k, (x, y, factor) in enumerate(waits):
            a, b = at(x), at(y)
            chips.append(f'<div id="ff{i}-{k}" class="ff clip" data-start="{a:.3f}" data-duration="{max(b - a, 1.4):.3f}" '
                         f'data-track-index="3"><span class="ff-zh">AI 正在规划</span><span class="ff-en">'
                         f'等待时间已加快 {factor:.0f} 倍</span></div>')
        scene_len = scene["end"] - scene["start"] if i < total_scenes else length
        captions.append(
            f'<section id="c{i}" class="cap clip" data-start="{start:.3f}" data-duration="{scene_len:.3f}" data-track-index="2">'
            f'<p class="count">{i:02d} / {total_scenes:02d}</p><h2 class="title">{esc(cfg["title"])}</h2>'
            + (f'<p class="title-en">{esc(cfg["title_en"])}</p>' if cfg.get("title_en") else "")
            + f'<ol class="beats">{"".join(beats)}</ol></section>')
        data["scenes"].append(scene)
    outro_start = cursor - OVERLAP
    outro = OUTRO if silent else max(OUTRO, 0.8 + durations["outro"] + 2.5)
    data["outroStart"] = round(outro_start, 3)
    data["duration"] = round(outro_start + outro, 3)

    audio, levels = "", None
    if not silent:
        spoken.append((file["outro"], outro_start + 0.8))
        levels = sound(spoken, data["duration"])
        audio = (f'<audio id="sound" class="clip" src="audio/sound.wav" data-start="0" data-duration="{data["duration"]:.3f}" '
                 f'data-track-index="5" data-volume="1"></audio>')

    chapters = "".join(f'<span id="ch{i}" class="chap">{esc(c["chapter"])}<i></i></span>' for i, c in enumerate(SCENES, 1))
    tiers = "".join(f'<div id="tier{k}" class="tier tier-{k}"><span class="hl"></span><span class="pill">{esc(name)}</span>'
                    f'<span class="tier-text"><span class="zh">{esc(zh)}</span>'
                    + (f'<span class="en">{esc(en)}</span>' if en else "") + '</span></div>'
                    for k, (name, zh, en) in enumerate(TIERS))
    page = TEMPLATE.read_text()
    for key, value in {
        "__DURATION__": f"{data['duration']:.3f}",
        "__INTRO_DURATION__": f"{intro + 0.1:.3f}",
        "__OUTRO_START__": f"{outro_start:.3f}",
        "__OUTRO_DURATION__": f"{outro:.3f}",
        "__VIDEOS__": "\n      ".join(videos),
        "__CAPTIONS__": "\n    ".join(captions),
        "__CHIPS__": "\n    ".join(chips),
        "__AUDIO__": audio,
        "__CHAPTERS__": chapters,
        "__TIERS__": tiers,
        "__DATA__": json.dumps(data, ensure_ascii=False),
    }.items():
        page = page.replace(key, value)
    (PROJECT / "index.html").write_text(page)
    print(f"{len(SCENES)} scenes, {data['duration']:.1f} s in all; intro {intro:.1f} s, outro at {outro_start:.1f} s for {outro:.1f} s")
    for s, cfg, hold in zip(data["scenes"], SCENES, held):
        print(f"  {cfg['raw']:<13} {s['start']:6.1f} – {s['end']:6.1f}  ({s['end'] - s['start']:.1f} s"
              f"{f', held {hold:.1f} s for the voice' if hold > 0.05 else ''})")
    if levels:
        print(f"  sound: {levels['mix']:.1f} LUFS, true peak {levels['peak']:.1f} dBTP; "
              f"the music sits {levels['under']:.1f} dB under the voice")


if __name__ == "__main__":
    main()
