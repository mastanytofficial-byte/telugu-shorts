#!/usr/bin/env python3
"""Download and prepare a licensed cinematic BGM for the romantic short.

The previous Mixkit CDN endpoints return HTTP 403 from GitHub Actions.
This version uses direct Pixabay CDN files whose corresponding Pixabay pages
identify them as free for use under the Pixabay Content License.
"""
import argparse
import os
import subprocess
import urllib.error
import urllib.request

TRACKS = [
    {
        "name": "Dramatic Nostalgic Sad Piano and Cello",
        "url": "https://cdn.pixabay.com/download/audio/2023/01/09/audio_bb355899f8.mp3?filename=dramatic-nostalgic-sad-piano-and-cello-132706.mp3",
        "keywords": ("longing", "melancholic", "bittersweet", "sad", "heartbreak", "missing", "mournful", "nostalgic"),
    },
    {
        "name": "Always With Me, Always With You",
        "url": "https://cdn.pixabay.com/download/audio/2022/02/18/audio_b3c6f0c96f.mp3?filename=always-with-me-always-with-you-long-21256.mp3",
        "keywords": ("romantic", "love", "affection", "tender", "warm", "dreamy", "hope", "reunion", "positive"),
    },
]


def choose_track(mood: str):
    m = (mood or "").lower()
    for track in TRACKS:
        if any(word in m for word in track["keywords"]):
            return track
    return TRACKS[1]


def download(track, source):
    request = urllib.request.Request(
        track["url"],
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
            "Accept": "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response, open(source, "wb") as out:
        out.write(response.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", required=True)
    ap.add_argument("--seconds", type=float, default=20)
    ap.add_argument("--mood", default="romantic")
    args = ap.parse_args()

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    selected = choose_track(args.mood)
    source = os.path.join(os.path.dirname(args.output), "licensed_bgm_source.mp3")

    ordered = [selected] + [t for t in TRACKS if t is not selected]
    last_error = None
    for track in ordered:
        try:
            print(f"Downloading licensed Pixabay BGM: {track['name']} | mood={args.mood}")
            download(track, source)
            if os.path.getsize(source) < 50000:
                raise RuntimeError("downloaded file is too small")
            selected = track
            break
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, RuntimeError) as exc:
            last_error = exc
            print(f"BGM download failed for {track['name']}: {exc}; trying next licensed track.")
    else:
        raise SystemExit(f"All licensed Pixabay BGM downloads failed: {last_error}")

    fade_out = max(1.0, args.seconds - 1.5)
    cmd = [
        "ffmpeg", "-y", "-i", source, "-t", str(args.seconds), "-vn",
        "-af",
        f"loudnorm=I=-18:TP=-2:LRA=8,afade=t=in:st=0:d=1,afade=t=out:st={fade_out}:d=1.5",
        "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", args.output,
    ]
    subprocess.run(cmd, check=True)

    print(f"BGM ready: {selected['name']} | {args.seconds:.0f}s | source=Pixabay Content License")


if __name__ == "__main__":
    main()
