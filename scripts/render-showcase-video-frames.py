#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


WIDTH = 1920
HEIGHT = 1080


def font(size: int, bold: bool = False):
    path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    return ImageFont.truetype(path, size)


def wrap_text(draw: ImageDraw.ImageDraw, text: str, text_font: ImageFont.FreeTypeFont, max_width: int):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if draw.textbbox((0, 0), candidate, font=text_font)[2] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def paste_contained_rounded(base: Image.Image, image: Image.Image, box, radius: int):
    width = box[2] - box[0]
    height = box[3] - box[1]
    scale = min(width / image.width, height / image.height)
    resized = image.resize((int(image.width * scale), int(image.height * scale)), Image.Resampling.LANCZOS)

    frame = Image.new("RGBA", (width, height), "#ffffff")
    offset = ((width - resized.width) // 2, (height - resized.height) // 2)
    frame.paste(resized, offset, resized)

    mask = Image.new("L", frame.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle((0, 0, width, height), radius=radius, fill=255)
    base.paste(frame, (box[0], box[1]), mask)


def draw_popup_capture(draw: ImageDraw.ImageDraw, canvas: Image.Image, scene: dict):
    image_path = scene.get("image")
    if not image_path:
        return

    popup = Image.open(image_path).convert("RGBA")
    shell = (1014, 178, 1828, 810)
    chrome = 72
    content = (shell[0] + 34, shell[1] + chrome + 30, shell[2] - 34, shell[3] - 50)

    shadow = Image.new("RGBA", (shell[2] - shell[0], shell[3] - shell[1]), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle((0, 0, shadow.width - 1, shadow.height - 1), radius=28, fill=(15, 23, 42, 78))
    shadow = shadow.filter(ImageFilter.GaussianBlur(20))
    canvas.paste(shadow, (shell[0] + 18, shell[1] + 20), shadow)

    draw.rounded_rectangle(shell, radius=28, fill="#ffffff", outline="#c7d2e1", width=2)
    draw.rounded_rectangle((shell[0], shell[1], shell[2], shell[1] + chrome), radius=28, fill="#eef3f8")
    draw.rectangle((shell[0], shell[1] + 48, shell[2], shell[1] + chrome), fill="#eef3f8")
    for index, color in enumerate(["#ff5f57", "#ffbd2e", "#28c840"]):
        draw.ellipse((shell[0] + 26 + index * 30, shell[1] + 24, shell[0] + 42 + index * 30, shell[1] + 40), fill=color)
    draw.rounded_rectangle((shell[0] + 132, shell[1] + 18, shell[2] - 132, shell[1] + 52), radius=12, fill="#ffffff", outline="#d7deea")
    draw.text((shell[0] + 158, shell[1] + 27), "chrome-extension://wdk-wallet/popup.html", fill="#42516a", font=font(15))

    paste_contained_rounded(canvas, popup, content, 18)
    draw.rounded_rectangle(content, radius=18, outline="#aab8cc", width=2)
    draw.text((shell[0] + 34, shell[3] + 28), "Actual extension popup capture via Chrome DevTools Protocol", fill="#64748b", font=font(22))


def render_frame(scene: dict, output: Path):
    canvas = Image.new("RGB", (WIDTH, HEIGHT), "#eef3f8")
    draw = ImageDraw.Draw(canvas)

    draw.rectangle((0, 0, WIDTH, 116), fill="#102033")
    draw.rectangle((0, 116, WIDTH, 124), fill="#00a783")
    draw.text((92, 36), "Tether WDK Browser Wallet Starter", fill="#f8fafc", font=font(34, True))
    draw.text((1488, 40), "1920x1080 showcase video", fill="#b9f5e6", font=font(24))

    draw.rounded_rectangle((92, 174, 948, 944), radius=24, fill="#ffffff", outline="#d7deea", width=2)
    draw.text((136, 218), scene["eyebrow"], fill="#007a63", font=font(25, True))

    title_font = font(50, True)
    y = 270
    for line in wrap_text(draw, scene["title"], title_font, 760):
        draw.text((136, y), line, fill="#172033", font=title_font)
        y += 58

    subtitle_font = font(27)
    y += 14
    for line in wrap_text(draw, scene["subtitle"], subtitle_font, 720):
        draw.text((136, y), line, fill="#475569", font=subtitle_font)
        y += 36

    bullet_font = font(24)
    y += 24
    for bullet in scene.get("bullets", []):
        draw.rounded_rectangle((136, y + 8, 154, y + 26), radius=5, fill="#2563eb")
        line_y = y
        wrapped = wrap_text(draw, bullet, bullet_font, 694)
        for wrapped_line in wrapped:
            draw.text((178, line_y), wrapped_line, fill="#253247", font=bullet_font)
            line_y += 32
        y = line_y + 14

    note = scene.get("note")
    if note:
        draw.rounded_rectangle((136, 846, 882, 906), radius=16, fill="#f8fafc", outline="#dbe4ef")
        draw.text((162, 864), note, fill="#475569", font=font(20))

    total = int(scene["total"])
    index = int(scene["index"])
    progress_left = 92
    progress_top = 1006
    progress_width = 1736
    draw.rounded_rectangle((progress_left, progress_top, progress_left + progress_width, progress_top + 18), radius=9, fill="#cbd5e1")
    draw.rounded_rectangle(
        (progress_left, progress_top, progress_left + int(progress_width * index / total), progress_top + 18),
        radius=9,
        fill="#00a783",
    )
    draw.text((92, 1034), f"Step {index:02d} of {total:02d} - {scene['hold_seconds']} second hold for readability", fill="#5b6b80", font=font(20))

    draw_popup_capture(draw, canvas, scene)
    canvas.save(output)


def main():
    spec_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    spec = json.loads(spec_path.read_text())
    scenes = spec["scenes"]
    total = len(scenes)
    hold_seconds = spec.get("secondsPerScene", 12)
    for index, scene in enumerate(scenes, 1):
        scene = {**scene, "index": index, "total": total, "hold_seconds": hold_seconds}
        render_frame(scene, out_dir / f"frame-{index:02d}.png")


if __name__ == "__main__":
    main()
