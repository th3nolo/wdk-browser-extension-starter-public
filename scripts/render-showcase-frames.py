#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


WIDTH = 1280
HEIGHT = 720
FINAL_POPUP_X = 812
FINAL_POPUP_Y = 96
POPUP_BOX_WIDTH = 410
POPUP_BOX_HEIGHT = 600


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


def paste_rounded(base: Image.Image, image: Image.Image, x: int, y: int, radius: int):
    mask = Image.new("L", image.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle((0, 0, image.width, image.height), radius=radius, fill=255)
    base.paste(image, (x, y), mask)


def draw_header(draw: ImageDraw.ImageDraw):
    draw.rectangle((0, 0, WIDTH, 84), fill="#102033")
    draw.rectangle((0, 84, WIDTH, 90), fill="#00a783")
    draw.rounded_rectangle((54, 22, 92, 60), radius=9, fill="#006b5b")
    draw.text((66, 30), "W", fill="#ffffff", font=font(19, True))
    draw.text((112, 25), "Tether WDK Browser Wallet Starter", fill="#f8fafc", font=font(27, True))


def draw_page_content(draw: ImageDraw.ImageDraw, scene: dict):
    draw.rounded_rectangle((54, 126, 664, 636), radius=20, fill="#ffffff", outline="#d7deea", width=2)
    draw.text((94, 166), "WDK extension wallet", fill="#007a63", font=font(20, True))

    title_font = font(44, True)
    y = 212
    for line in wrap_text(draw, scene["title"], title_font, 520):
        draw.text((94, y), line, fill="#172033", font=title_font)
        y += 52

    y += 14
    for line in scene.get("lines", []):
        for wrapped in wrap_text(draw, line, font(24), 500):
            draw.text((96, y), wrapped, fill="#42516a", font=font(24))
            y += 34
        y += 2

    draw.rounded_rectangle((96, 506, 360, 562), radius=12, fill="#176b5b")
    draw.text((124, 522), scene.get("button", "Open wallet"), fill="#ffffff", font=font(21, True))
    draw.text((96, 590), "Actual extension popup captured via Chrome DevTools Protocol.", fill="#64748b", font=font(15))


def draw_intro_art(draw: ImageDraw.ImageDraw):
    panel = (742, 148, 1212, 600)
    draw.rounded_rectangle(panel, radius=24, fill="#ffffff", outline="#c7d2e1", width=2)
    draw.rounded_rectangle((782, 194, 1172, 252), radius=15, fill="#eef8f5", outline="#b7e3d7")
    draw.text((812, 212), "Encrypted vault", fill="#075e56", font=font(24, True))
    for index, (label, color) in enumerate([
        ("Bitcoin", "#f7931a"),
        ("Spark", "#2563eb"),
        ("Ethereum", "#627eea"),
        ("Solana", "#14f195"),
    ]):
        y = 300 + index * 58
        draw.rounded_rectangle((804, y, 1150, y + 42), radius=12, fill="#f8fafc", outline="#d8e0ea")
        draw.rounded_rectangle((824, y + 11, 844, y + 31), radius=6, fill=color)
        draw.text((866, y + 9), label, fill="#172033", font=font(19, True))
        draw.text((1060, y + 12), "WDK", fill="#64748b", font=font(15, True))


def draw_popup_capture(draw: ImageDraw.ImageDraw, canvas: Image.Image, scene: dict, popup_x: int):
    image_path = scene.get("image")
    if not image_path:
        draw_intro_art(draw)
        return

    source = Image.open(image_path).convert("RGBA")
    scale = min(POPUP_BOX_WIDTH / source.width, POPUP_BOX_HEIGHT / source.height, 1)
    popup = source.resize((int(source.width * scale), int(source.height * scale)), Image.Resampling.LANCZOS)
    popup_y = FINAL_POPUP_Y + (POPUP_BOX_HEIGHT - popup.height) // 2
    popup_x = popup_x + (POPUP_BOX_WIDTH - popup.width) // 2

    shadow = Image.new("RGBA", popup.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle((0, 0, popup.width - 1, popup.height - 1), radius=18, fill=(15, 23, 42, 78))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.paste(shadow, (popup_x + 18, popup_y + 18), shadow)

    paste_rounded(canvas, popup, popup_x, popup_y, 18)
    draw.rounded_rectangle(
        (popup_x, popup_y, popup_x + popup.width - 1, popup_y + popup.height - 1),
        radius=18,
        outline="#9fb0c5",
        width=2,
    )


def render_frame(scene: dict, output: Path, popup_x: int):
    canvas = Image.new("RGB", (WIDTH, HEIGHT), "#eef3f8")
    draw = ImageDraw.Draw(canvas)
    draw_header(draw)
    draw_page_content(draw, scene)
    draw_popup_capture(draw, canvas, scene, popup_x)
    canvas.save(output)


def main():
    spec_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    spec = json.loads(spec_path.read_text())
    frame_index = 1

    for scene_index, scene in enumerate(spec["scenes"]):
        if scene_index == 0:
            positions = [WIDTH + 40, WIDTH + 40, WIDTH + 40]
        else:
            positions = [WIDTH + 40, FINAL_POPUP_X + 72, FINAL_POPUP_X, FINAL_POPUP_X, FINAL_POPUP_X, FINAL_POPUP_X]
        for position in positions:
            render_frame(scene, out_dir / f"frame-{frame_index:03d}.png", position)
            frame_index += 1


if __name__ == "__main__":
    main()
