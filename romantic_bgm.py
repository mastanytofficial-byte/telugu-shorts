#!/usr/bin/env python3
"""Download and prepare a licensed cinematic BGM for the romantic short.

Music source: Mixkit Free Music. The selected tracks are published under the
Mixkit License. The workflow downloads the preview MP3 endpoint, because the
legacy /music/download/ endpoint can return HTTP 403 from GitHub Actions.
"""
import argparse
import os
import subprocess
import urllib.error
import urllib.request

TRACKS = [
    {
        "name": "Silent Descent",
        "url": "https://assets.mixkit.co/music/preview/mixkit-silent-descent-614.mp3",
        "keywords": ("longing", "melancholic", "bittersweet", "sad", "heartbreak", "missing", "mournful"),
    },
    {
        "name": "Beautiful Dream",
        "url": "https://assets.mixkit.co/music/preview/mixkit-beautiful-dream-493.mp3",
        "keywords": ("nostalgia", "nostalgic", "warm", "tender", "affection", "affectionate", "romantic", "love"),
    },
    {
        "name": "Love in the Air",
        "url": "https://assets.mixkit.co/music/preview/mixkit-love-in-the-air-41.mp3",
        "keywords": ("hope", "hopeful", "reunion", "uplifting", "positive", "dreamy", "affection"),
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
            "Referer": "https://mixkit.co/",
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

    # Try the mood-selected track first. If one CDN asset is blocked, try the
    # other verified Mixkit romantic tracks instead of failing the whole run.
    ordered = [selected] + [t for t in TRACKS if t is not selected]
    last_error = None
    for track in ordered:
        try:
            print(f"Downloading licensed Mixkit BGM: {track['name']} | mood={args.mood}")
            download(track, source)
            if os.path.getsize(source) < 50000:
                raise RuntimeError("downloaded file is too small")
            selected = track
            break
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, RuntimeError) as exc:
            last_error = exc
            print(f"BGM download failed for {track['name']}: {exc}; trying next licensed track.")
    else:
        raise SystemExit(f"All licensed Mixkit BGM downloads failed: {last_error}")

    fade_out = max(1.0, args.seconds - 1.5)
    cmd = [
        "ffmpeg", "-y", "-i", source, "-t", str(args.seconds), "-vn",
        "-af",
        f"loudnorm=I=-18:TP=-2:LRA=8,afade=t=in:st=0:d=1,afade=t=out:st={fade_out}:d=1.5",
        "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", args.output,
    ]
    subprocess.run(cmd, check=True)

    print(f"BGM ready: {selected['name']} | {args.seconds:.0f}s | source=Mixkit Free License")


if __name__ == "__main__":
    main()
