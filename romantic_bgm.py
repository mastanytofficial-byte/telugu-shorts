#!/usr/bin/env python3
"""Automatically download and prepare a licensed cinematic BGM for the romantic short.

Music source: Mixkit Free Music. The selected tracks are published under the
Mixkit Free License, which permits use in YouTube/social videos. The workflow
never asks the user to upload a music file.
"""
import argparse
import os
import subprocess
import urllib.request

TRACKS = [
    {
        "name": "Silent Descent",
        "url": "https://assets.mixkit.co/music/download/mixkit-silent-descent-614.mp3",
        "keywords": ("longing", "melancholic", "bittersweet", "sad", "heartbreak", "missing", "mournful"),
    },
    {
        "name": "Beautiful Dream",
        "url": "https://assets.mixkit.co/music/download/mixkit-beautiful-dream-493.mp3",
        "keywords": ("nostalgia", "nostalgic", "warm", "tender", "affection", "affectionate", "romantic", "love"),
    },
    {
        "name": "Dreaming Big",
        "url": "https://assets.mixkit.co/music/download/mixkit-dreaming-big-31.mp3",
        "keywords": ("hope", "hopeful", "reunion", "uplifting", "positive", "dreamy"),
    },
]


def choose_track(mood: str):
    m = (mood or "").lower()
    for track in TRACKS:
        if any(word in m for word in track["keywords"]):
            return track
    return TRACKS[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", required=True)
    ap.add_argument("--seconds", type=float, default=20)
    ap.add_argument("--mood", default="romantic")
    args = ap.parse_args()

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    track = choose_track(args.mood)
    source = os.path.join(os.path.dirname(args.output), "licensed_bgm_source.mp3")

    print(f"Downloading licensed Mixkit BGM: {track['name']} | mood={args.mood}")
    request = urllib.request.Request(
        track["url"],
        headers={"User-Agent": "Mozilla/5.0 (GitHub Actions romantic shorts)"},
    )
    with urllib.request.urlopen(request, timeout=60) as response, open(source, "wb") as out:
        out.write(response.read())

    if os.path.getsize(source) < 50000:
        raise SystemExit("Licensed BGM download is too small or invalid")

    fade_out = max(1.0, args.seconds - 1.5)
    cmd = [
        "ffmpeg", "-y", "-i", source, "-t", str(args.seconds), "-vn",
        "-af",
        f"loudnorm=I=-18:TP=-2:LRA=8,afade=t=in:st=0:d=1,afade=t=out:st={fade_out}:d=1.5",
        "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", args.output,
    ]
    subprocess.run(cmd, check=True)

    print(f"BGM ready: {track['name']} | {args.seconds:.0f}s | source=Mixkit Free License")


if __name__ == "__main__":
    main()
