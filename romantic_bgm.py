#!/usr/bin/env python3
"""Generate a short original romantic instrumental with Python stdlib only.

No downloaded music, samples, or external audio libraries are used. The
composition is synthesized from notes, harmonics, bass, pad and a simple
melody selected from the requested emotional mood.
"""
import argparse
import math
import random
import struct
import wave

SR = 44100
TAU = 2.0 * math.pi

PRESETS = {
    "quiet affection": {"bpm": 72, "root": 261.63, "scale": [0, 2, 4, 7, 9], "brightness": 0.85},
    "tender longing": {"bpm": 66, "root": 220.00, "scale": [0, 2, 3, 7, 10], "brightness": 0.55},
    "bittersweet remembrance": {"bpm": 64, "root": 196.00, "scale": [0, 2, 3, 7, 8], "brightness": 0.48},
    "warm nostalgia": {"bpm": 70, "root": 174.61, "scale": [0, 2, 4, 7, 9], "brightness": 0.62},
    "hopeful reunion": {"bpm": 76, "root": 261.63, "scale": [0, 2, 4, 7, 11], "brightness": 0.95},
    "deep love": {"bpm": 70, "root": 233.08, "scale": [0, 2, 4, 7, 9], "brightness": 0.82},
    "heartbreak": {"bpm": 62, "root": 220.00, "scale": [0, 2, 3, 7, 8], "brightness": 0.40},
}


def preset_for(mood: str):
    m = (mood or "").lower()
    for name, p in PRESETS.items():
        if name in m or any(part in m for part in name.split()):
            return name, p
    if any(x in m for x in ("heartbreak", "sad", "loss", "pain")):
        return "heartbreak", PRESETS["heartbreak"]
    if any(x in m for x in ("longing", "missing", "distance", "yearning")):
        return "tender longing", PRESETS["tender longing"]
    if any(x in m for x in ("hope", "reunion", "together")):
        return "hopeful reunion", PRESETS["hopeful reunion"]
    if any(x in m for x in ("nostalgia", "memory", "remember")):
        return "warm nostalgia", PRESETS["warm nostalgia"]
    return "quiet affection", PRESETS["quiet affection"]


def midi_freq(root, semitones):
    return root * (2.0 ** (semitones / 12.0))


def envelope(t, dur, attack=0.035, release=0.20):
    if t < 0 or t > dur:
        return 0.0
    if t < attack:
        return t / attack
    if t > dur - release:
        return max(0.0, (dur - t) / release)
    return 1.0


def tone(t, freq, kind="piano"):
    if kind == "piano":
        # A few decaying harmonics create a warmer, less synthetic timbre.
        return (
            0.70 * math.sin(TAU * freq * t) * math.exp(-2.8 * t)
            + 0.22 * math.sin(TAU * freq * 2 * t) * math.exp(-4.2 * t)
            + 0.08 * math.sin(TAU * freq * 3 * t) * math.exp(-6.0 * t)
        )
    if kind == "pad":
        return (
            0.55 * math.sin(TAU * freq * t)
            + 0.25 * math.sin(TAU * (freq * 1.003) * t)
            + 0.20 * math.sin(TAU * (freq * 0.997) * t)
        )
    return math.sin(TAU * freq * t)


def make_wav(path: str, seconds: float, mood: str):
    name, p = preset_for(mood)
    random.seed(1000 + sum(ord(c) for c in mood))
    n = int(SR * seconds)
    samples = [0.0] * n
    beat = 60.0 / p["bpm"]
    bar = beat * 4
    root = p["root"]
    scale = p["scale"]

    # Gentle sustained chord progression: I -> vi -> IV -> V-ish.
    progressions = [
        [0, 4, 7],
        [9, 12, 16],
        [5, 9, 12],
        [7, 11, 14],
    ]

    # Pad layer.
    for i in range(n):
        t = i / SR
        bar_i = int(t / bar) % len(progressions)
        chord = progressions[bar_i]
        local = t % bar
        fade = min(1.0, t / 1.2, max(0.0, (seconds - t) / 1.4))
        s = 0.0
        for sem in chord:
            f = midi_freq(root, sem - 12)
            s += tone(local, f, "pad") * 0.030
        samples[i] += s * fade

    # Piano-like melody: sparse phrases, deliberately leaving space.
    note_len = beat * 0.75
    for phrase_start in [0.0, bar * 2, bar * 4, bar * 6]:
        for j in range(8):
            if phrase_start + j * note_len >= seconds - 0.4:
                continue
            if j in (2, 5) and random.random() < 0.55:
                continue
            degree = [0, 1, 2, 4, 2, 1, 3, 2][j]
            sem = scale[degree % len(scale)] + (12 if j >= 4 else 0)
            freq = midi_freq(root, sem)
            start = phrase_start + j * note_len
            dur = min(note_len * 0.92, seconds - start)
            if dur <= 0:
                continue
            first = int(start * SR)
            last = min(n, int((start + dur) * SR))
            for k in range(first, last):
                tt = (k / SR) - start
                e = envelope(tt, dur, 0.018, min(0.25, dur * 0.55))
                samples[k] += tone(tt, freq, "piano") * 0.095 * e

    # Low bass on bar starts.
    for bar_start in [x * bar for x in range(int(seconds / bar) + 1)]:
        if bar_start >= seconds:
            break
        bar_i = int(bar_start / bar) % len(progressions)
        bass_freq = midi_freq(root, progressions[bar_i][0] - 24)
        dur = min(bar * 0.72, seconds - bar_start)
        first = int(bar_start * SR)
        last = min(n, int((bar_start + dur) * SR))
        for k in range(first, last):
            tt = k / SR - bar_start
            e = envelope(tt, dur, 0.04, min(0.35, dur * 0.6))
            samples[k] += tone(tt, bass_freq, "sine") * 0.065 * e

    # Very subtle high shimmer every two bars.
    for start in [x * bar * 2 for x in range(int(seconds / (bar * 2)) + 1)]:
        if start >= seconds:
            break
        f = midi_freq(root, 12 + scale[(int(start / (bar * 2)) + 2) % len(scale)])
        dur = min(1.8, seconds - start)
        first, last = int(start * SR), min(n, int((start + dur) * SR))
        for k in range(first, last):
            tt = k / SR - start
            e = envelope(tt, dur, 0.25, 0.8)
            samples[k] += tone(tt, f, "pad") * 0.012 * e * p["brightness"]

    peak = max(1e-9, max(abs(x) for x in samples))
    gain = 0.78 / peak
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for x in samples:
            v = int(max(-1.0, min(1.0, x * gain)) * 32767)
            frames += struct.pack("<hh", v, v)
        w.writeframes(frames)
    print(f"Created Python BGM: {path} | mood={name} | bpm={p['bpm']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", required=True)
    ap.add_argument("--seconds", type=float, default=20.0)
    ap.add_argument("--mood", default="quiet affection")
    args = ap.parse_args()
    make_wav(args.output, args.seconds, args.mood)
