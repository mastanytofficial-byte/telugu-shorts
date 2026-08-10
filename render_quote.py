#!/usr/bin/env python3
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
MAX_TEXT_W = 860
MAX_TEXT_H = 720


def load_font(size):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            return ImageFont.truetype(p, size=size)
    raise FileNotFoundError("No suitable font found")


def wrap_words(draw, text, font):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = word if not current else current + " " + word
        box = draw.textbbox((0, 0), candidate, font=font, stroke_width=0)
        if box[2] <= MAX_TEXT_W:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    text = Path(args.text).read_text(encoding="utf-8").strip()
    if not text:
        raise SystemExit("Quote text is empty")

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    chosen = None
    chosen_lines = None
    for size in range(58, 27, -2):
        font = load_font(size)
        lines = wrap_words(draw, text, font)
        line_gap = max(10, int(size * 0.30))
        line_h = size + line_gap
        total_h = len(lines) * line_h - line_gap
        if total_h <= MAX_TEXT_H and all(draw.textbbox((0, 0), line, font=font)[2] <= MAX_TEXT_W for line in lines):
            chosen = (font, line_gap, total_h)
            chosen_lines = lines
            break

    if chosen is None:
        raise SystemExit("Quote cannot fit safely on screen")

    font, line_gap, total_h = chosen
    box_pad_x, box_pad_y = 34, 34
    box_w = MAX_TEXT_W + box_pad_x * 2
    box_h = total_h + box_pad_y * 2
    box_x = (W - box_w) // 2
    box_y = (H - box_h) // 2

    draw.rounded_rectangle(
        (box_x, box_y, box_x + box_w, box_y + box_h),
        radius=28,
        fill=(0, 0, 0, 105),
        outline=(255, 255, 255, 30),
        width=2,
    )

    y = box_y + box_pad_y
    for line in chosen_lines:
        bbox = draw.textbbox((0, 0), line, font=font, stroke_width=1)
        line_w = bbox[2] - bbox[0]
        x = (W - line_w) // 2
        draw.text(
            (x, y), line, font=font, fill=(255, 255, 255, 255),
            stroke_width=2, stroke_fill=(0, 0, 0, 230)
        )
        y += font.size + line_gap

    overlay.save(args.output)
    print(f"Quote overlay ready: {len(chosen_lines)} lines, font={font.size}px, box={box_w}x{box_h}")


if __name__ == "__main__":
    main()
