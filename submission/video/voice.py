"""Speaks the narration in scenes.py with a Microsoft neural voice through edge-tts: one WAV per line in work/voice/,
skipping lines already spoken (a line's file name changes with its words, the voice and its pace). edge-tts uses the
speech service behind Edge's Read Aloud, so the lines' words go to Microsoft.
Usage: work/edge/bin/python voice.py   (the environment `./video.sh install` makes; `./video.sh voice` runs this)
"""
import asyncio
import os
import subprocess

import edge_tts

from build_edit import VOICE, VOICES, write_lines

FFMPEG = os.environ.get("HYPERFRAMES_FFMPEG_PATH", "ffmpeg")
# the silence the service leaves at either end goes: the edit spaces the lines itself
TRIM = ("silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
        "silenceremove=start_periods=1:start_threshold=-50dB,areverse")


async def speak(words, path):
    mp3 = path.with_suffix(".mp3")
    await edge_tts.Communicate(words, VOICE["name"], rate=VOICE["rate"]).save(str(mp3))
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(mp3), "-af", TRIM, "-ac", "1", "-ar", "24000",
                    str(path)], check=True)
    mp3.unlink()


def main():
    lines = write_lines()
    todo = [line for line in lines if not (VOICES / line["file"]).exists()]
    for line in todo:
        asyncio.run(speak(line["text"], VOICES / line["file"]))
    print(f"Spoke {len(todo)} of {len(lines)} lines with {VOICE['name']} into {VOICES}")


if __name__ == "__main__":
    main()
