"""A quiet music bed for the demo video, made here from sine waves so it has no rights to clear: soft chords, a light
arpeggio and a low bass in C major at 84 bpm, fading in and out. build_edit.py adds a little room to it and sets it well
under the voice. Usage: python music.py <seconds> <out.wav>   (mono, 24 kHz)
"""
import math
import sys
import wave
from array import array
from operator import add

RATE = 24000
BEAT = 60 / 84
BAR = 4 * BEAT
# a bar each, in turn: the bass note and the chord above it (MIDI note numbers), Cmaj9, Am7, Fmaj7 and G6
CHORDS = [(36, (52, 55, 59, 62)), (33, (55, 57, 60, 64)), (29, (53, 57, 60, 64)), (31, (55, 59, 62, 64))]
ARPEGGIO = (0, 1, 2, 3, 2, 1, 2, 3)  # the order eighth notes walk the chord, an octave up

# each sound as partials, (multiple of the note's frequency, level): a pair slightly apart beats slowly, like a chorus
PAD = ((1.0, 1.0), (1.0035, 0.7), (2.001, 0.1))
BASS = ((1.0, 1.0), (2.0, 0.15))
PLUCK = ((1.0, 1.0), (2.0, 0.22), (3.0, 0.05))
RELEASE = 1.4  # a chord fades out over the next one's swell


def pad_shape(t, length):
    if t < 0.9:
        return math.sin(t / 0.9 * math.pi / 2) ** 2
    if t > length - RELEASE:
        return math.cos((t - length + RELEASE) / RELEASE * math.pi / 2) ** 2
    return 1.0


def bass_shape(t, length):
    if t < 0.04:
        return t / 0.04
    fade = min(1.0, (length - t) / 0.35)
    return (0.55 + 0.45 * math.exp(-(t - 0.04) / 0.5)) * fade


def pluck_shape(t, length):
    if t < 0.006:
        return t / 0.006
    return math.exp(-t / 0.32) * min(1.0, (length - t) / 0.1)


def tone(note, seconds, partials, shape, level):
    """One note as samples."""
    step = 2 * math.pi * 440 * 2 ** ((note - 69) / 12) / RATE
    waves = [(step * m, a * level) for m, a in partials]
    out = array("f", bytes(4 * int(seconds * RATE)))
    for i in range(len(out)):
        out[i] = shape(i / RATE, seconds) * sum(a * math.sin(w * i) for w, a in waves)
    return out


def mix_in(out, at, sound, level=1.0):
    end = min(len(out), at + len(sound))
    if end <= at:
        return
    part = sound if level == 1.0 else array("f", (x * level for x in sound))
    out[at:end] = array("f", map(add, out[at:end], part[:end - at]))


def main():
    seconds, path = float(sys.argv[1]), sys.argv[2]
    bars = math.ceil(seconds / BAR) + 1
    out = array("f", bytes(4 * int((bars * BAR + RELEASE + 1) * RATE)))
    pads = [[tone(n, BAR + RELEASE, PAD, pad_shape, 0.06) for n in notes] for _, notes in CHORDS]
    basses = [tone(root, BAR, BASS, bass_shape, 0.16) for root, _ in CHORDS]
    plucks = {}
    last = bars - 1
    for bar in range(bars):
        chord = 0 if bar == last else bar % len(CHORDS)  # it ends where it began
        at = int(bar * BAR * RATE)
        for sound in pads[chord]:
            mix_in(out, at, sound)
        if 1 <= bar < last:
            mix_in(out, at, basses[chord])
        if 3 <= bar < last - 1:
            level = min(1.0, (bar - 2) / 3)  # the arpeggio comes in over three bars
            for n, step in enumerate(ARPEGGIO):
                note = CHORDS[chord][1][step] + 12
                if note not in plucks:
                    plucks[note] = tone(note, 1.2, PLUCK, pluck_shape, 0.09)
                mix_in(out, at + int(n * BEAT / 2 * RATE), plucks[note], level)

    n = int(seconds * RATE)
    del out[n:]
    gain = 0.8 / (max(map(abs, out)) or 1.0)
    pcm = array("h", bytes(2 * n))
    for i in range(n):
        pcm[i] = int(out[i] * gain * min(1.0, i / (2.5 * RATE), (n - i) / (4.0 * RATE)) * 32767)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    main()
