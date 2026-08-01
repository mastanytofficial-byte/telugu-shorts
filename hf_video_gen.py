#!/usr/bin/env python3
"""
Calls a Hugging Face Gradio Space to generate a short video from a text
prompt, using gradio_client (documented, sanctioned way to call Spaces as
an API — see https://huggingface.co/docs/hub/spaces-api-endpoints).

This is a BEST-EFFORT fallback tier: community/vendor-hosted Spaces have no
SLA, can be slow (queueing on shared ZeroGPU hardware), or can change their
API signature without notice. Every failure mode here should result in a
non-zero exit code so the calling Node process can fall back gracefully to
the existing AI-image pipeline — this script is never the only path to a
usable clip.

Usage: python3 hf_video_gen.py "<prompt>" <output_path>
Prints the output path to stdout on success. Exits non-zero on any failure.
"""
import sys
import shutil


def extract_video_path(result):
    """Gradio endpoints return wildly different shapes depending on how the
    Space author wired their outputs — a bare file path string, a dict with
    a 'video' key, or a tuple/list of either. Try the common shapes."""
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        for key in ('video', 'name', 'path'):
            if key in result and result[key]:
                return result[key]
    if isinstance(result, (list, tuple)) and len(result) > 0:
        return extract_video_path(result[0])
    return None


def main():
    if len(sys.argv) < 3:
        print("ERROR: usage: hf_video_gen.py <prompt> <output_path>", file=sys.stderr)
        sys.exit(1)

    prompt = sys.argv[1]
    output_path = sys.argv[2]

    try:
        from gradio_client import Client
    except ImportError:
        print("ERROR: gradio_client not installed", file=sys.stderr)
        sys.exit(1)

    space_id = "Lightricks/ltx-video-distilled"

    try:
        client = Client(space_id)
    except Exception as e:
        print(f"ERROR: could not connect to Space {space_id}: {e}", file=sys.stderr)
        sys.exit(1)

    # Each Gradio Space defines its own parameter names for its predict
    # function — we can't know this specific Space's exact signature without
    # live testing, so try the most common patterns in order.
    attempts = [
        lambda: client.predict(prompt, api_name="/predict"),
        lambda: client.predict(prompt=prompt, api_name="/predict"),
        lambda: client.predict(prompt, api_name="/generate"),
        lambda: client.predict(prompt=prompt),
        lambda: client.predict(prompt),
    ]

    result = None
    last_error = None
    for attempt in attempts:
        try:
            result = attempt()
            break
        except Exception as e:
            last_error = e
            continue

    if result is None:
        print(f"ERROR: all invocation attempts failed, last error: {last_error}", file=sys.stderr)
        sys.exit(1)

    video_path = extract_video_path(result)
    if not video_path:
        print(f"ERROR: could not extract a video path from result: {result}", file=sys.stderr)
        sys.exit(1)

    try:
        shutil.copy(video_path, output_path)
    except Exception as e:
        print(f"ERROR: could not copy result file ({video_path}) to {output_path}: {e}", file=sys.stderr)
        sys.exit(1)

    print(output_path)


if __name__ == '__main__':
    main()
