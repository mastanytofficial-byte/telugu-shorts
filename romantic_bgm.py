#!/usr/bin/env python3
"""Prepare a licensed YouTube Audio Library track for the romantic short.

The actual music file must be placed in music/. This script never downloads
or synthesizes music; it only trims, fades and normalizes a user-supplied
licensed track with ffmpeg.
"""
import argparse
import glob
import os
import subprocess

MOOD_KEYS = {
    "heartbreak": ["heartbreak", "sad", "melancholy", "dramatic"],
    "longing": ["longing", "sad", "nostalgia", "melancholy"],
    "nostalgia": ["nostalgia", "memory", "warm", "piano"],
    "reunion": ["hope", "hopeful", "uplifting", "romance"],
    "affection": ["romance", "romantic", "love", "soft", "piano"],
}


def choose_track(mood):
    files = sorted(glob.glob(os.path.join("music", "*.mp3")) + glob.glob(os.path.join("music", "*.wav")) + glob.glob(os.path.join("music", "*.m4a")))
    if not files:
        raise SystemExit("No licensed BGM found in music/. Download a track from YouTube Audio Library and place the MP3 in music/.")
    m = (mood or "").lower()
    for key, words in MOOD_KEYS.items():
        if key in m:
            for f in files:
                name = os.path.basename(f).lower()
                if any(w in name for w in words):
                    return f
    return files[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", required=True)
    ap.add_argument("--seconds", type=float, default=20)
    ap.add_argument("--mood", default="romance")
    args = ap.parse_args()
    src = choose_track(args.mood)
    fade_out = max(1.0, args.seconds - 1.2)
    cmd = ["ffmpeg", "-y", "-i", src, "-t", str(args.seconds), "-vn",
           "-af", f"loudnorm=I=-18:TP=-1.5:LRA=7,afade=t=in:st=0:d=1,afade=t=out:st={fade_out}:d=1.2",
           "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", args.output]
    subprocess.run(cmd, check=True)
    print(f"Selected licensed BGM: {src} | mood={args.mood}")


if __name__ == "__main__":
    main()
