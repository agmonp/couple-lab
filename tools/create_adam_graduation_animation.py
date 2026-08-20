from __future__ import annotations

import math
import random
from pathlib import Path

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "adam-porat-grade-6-graduation-manga.png"
OUT_MP4 = ROOT / "public" / "adam-porat-grade-6-graduation-animation.mp4"
OUT_WEBP = ROOT / "public" / "adam-porat-grade-6-graduation-animation.webp"

WIDTH = 720
HEIGHT = 1080
WEBP_SIZE = (480, 720)
FPS = 24
DURATION = 6
FRAME_COUNT = FPS * DURATION

GOLD = (242, 185, 55, 230)
LEAF = (31, 111, 58, 220)
SKY = (143, 211, 255, 190)
WHITE = (255, 255, 255, 210)


def ease_in_out(x: float) -> float:
    return 0.5 - 0.5 * math.cos(math.pi * x)


def make_vignette() -> Image.Image:
    mask = Image.new("L", (WIDTH, HEIGHT), 0)
    draw = ImageDraw.Draw(mask)
    for y in range(HEIGHT):
        edge = max(0, 1 - min(y, HEIGHT - 1 - y) / 260)
        alpha = int(120 * (edge**1.8))
        if alpha:
            draw.line([(0, y), (WIDTH, y)], fill=alpha)
    for x in range(WIDTH):
        edge = max(0, 1 - min(x, WIDTH - 1 - x) / 180)
        alpha = int(70 * (edge**1.7))
        if alpha:
            draw.line([(x, 0), (x, HEIGHT)], fill=alpha)
    return Image.merge("RGBA", [
        Image.new("L", (WIDTH, HEIGHT), 10),
        Image.new("L", (WIDTH, HEIGHT), 25),
        Image.new("L", (WIDTH, HEIGHT), 18),
        mask,
    ])


def confetti_specs() -> list[dict[str, float | tuple[int, int, int, int]]]:
    rng = random.Random(613)
    colors = [GOLD, LEAF, SKY, WHITE, (247, 212, 106, 230), (47, 138, 77, 220)]
    specs = []
    for _ in range(54):
        specs.append(
            {
                "x": rng.uniform(-20, WIDTH + 20),
                "y": rng.uniform(-HEIGHT * 0.25, HEIGHT * 1.05),
                "speed": rng.uniform(190, 430),
                "sway": rng.uniform(8, 46),
                "phase": rng.uniform(0, math.tau),
                "w": rng.uniform(8, 18),
                "h": rng.uniform(12, 28),
                "rot": rng.uniform(-180, 180),
                "spin": rng.uniform(90, 330),
                "color": rng.choice(colors),
            }
        )
    return specs


def paste_confetti(frame: Image.Image, specs: list[dict[str, float]], seconds: float) -> None:
    for item in specs:
        y = ((float(item["y"]) + seconds * float(item["speed"])) % (HEIGHT + 180)) - 90
        x = float(item["x"]) + math.sin(seconds * 2.2 + float(item["phase"])) * float(item["sway"])
        w = int(float(item["w"]))
        h = int(float(item["h"]))
        piece = Image.new("RGBA", (w, h), item["color"])  # type: ignore[arg-type]
        angle = float(item["rot"]) + seconds * float(item["spin"])
        piece = piece.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
        frame.alpha_composite(piece, (int(x), int(y)))


def draw_sparkle(draw: ImageDraw.ImageDraw, x: int, y: int, size: int, alpha: int) -> None:
    color = (255, 232, 128, alpha)
    glow = (242, 185, 55, max(20, alpha // 3))
    draw.ellipse((x - size, y - size, x + size, y + size), fill=glow)
    draw.line((x - size, y, x + size, y), fill=color, width=max(2, size // 6))
    draw.line((x, y - size, x, y + size), fill=color, width=max(2, size // 6))
    diag = int(size * 0.58)
    draw.line((x - diag, y - diag, x + diag, y + diag), fill=color, width=max(1, size // 9))
    draw.line((x - diag, y + diag, x + diag, y - diag), fill=color, width=max(1, size // 9))


def add_light_sweep(frame: Image.Image, progress: float) -> None:
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    x = int(-WIDTH * 0.7 + progress * WIDTH * 2.35)
    band = 36
    polygon = [
        (x - band, -140),
        (x + band, -140),
        (x + band + 320, HEIGHT + 140),
        (x - band + 320, HEIGHT + 140),
    ]
    draw.polygon(polygon, fill=(255, 255, 255, 44))
    overlay = overlay.filter(ImageFilter.GaussianBlur(10))
    frame.alpha_composite(overlay)


def render_frame(base: Image.Image, vignette: Image.Image, specs: list[dict[str, float]], i: int) -> Image.Image:
    t = i / (FRAME_COUNT - 1)
    seconds = i / FPS
    eased = ease_in_out(t)

    scale = 1.025 + 0.072 * eased
    sw = int(WIDTH * scale)
    sh = int(HEIGHT * scale)
    poster = base.resize((sw, sh), Image.Resampling.LANCZOS)

    x = (WIDTH - sw) // 2 + int(math.sin(t * math.tau) * 8)
    y = (HEIGHT - sh) // 2 + int(-18 * eased + math.sin(t * math.pi) * 6)
    frame = Image.new("RGBA", (WIDTH, HEIGHT), (255, 244, 220, 255))
    frame.alpha_composite(poster.convert("RGBA"), (x, y))

    if 0.38 <= t <= 0.72:
        add_light_sweep(frame, (t - 0.38) / 0.34)

    paste_confetti(frame, specs, seconds)

    spark_layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    spark_draw = ImageDraw.Draw(spark_layer)
    spark_points = [(88, 190, 15, 0.0), (622, 228, 18, 0.2), (112, 766, 13, 0.45), (648, 900, 16, 0.68)]
    for sx, sy, size, phase in spark_points:
        pulse = 0.5 + 0.5 * math.sin((seconds * 2.4 + phase) * math.tau)
        draw_sparkle(spark_draw, sx, sy, size, int(80 + 150 * pulse))
    frame.alpha_composite(spark_layer)
    frame.alpha_composite(vignette)

    if t < 0.1:
        alpha = int(255 * (1 - t / 0.1))
        frame.alpha_composite(Image.new("RGBA", (WIDTH, HEIGHT), (16, 38, 26, alpha)))
    if t > 0.91:
        alpha = int(235 * ((t - 0.91) / 0.09))
        frame.alpha_composite(Image.new("RGBA", (WIDTH, HEIGHT), (16, 38, 26, alpha)))

    return frame.convert("RGB")


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Missing source image: {SOURCE}")

    base = Image.open(SOURCE).convert("RGB")
    base = ImageOps.fit(base, (WIDTH, HEIGHT), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    vignette = make_vignette()
    specs = confetti_specs()

    frames: list[Image.Image] = []
    with imageio.get_writer(
        OUT_MP4,
        fps=FPS,
        codec="libx264",
        quality=8,
        macro_block_size=1,
        ffmpeg_params=["-pix_fmt", "yuv420p", "-movflags", "+faststart"],
    ) as writer:
        for i in range(FRAME_COUNT):
            frame = render_frame(base, vignette, specs, i)
            writer.append_data(np.asarray(frame))
            if i % 4 == 0:
                frames.append(frame.resize(WEBP_SIZE, Image.Resampling.LANCZOS))

    frames[0].save(
        OUT_WEBP,
        save_all=True,
        append_images=frames[1:],
        duration=int(1000 / (FPS / 4)),
        loop=0,
        quality=64,
        method=0,
    )

    print(f"Wrote {OUT_MP4} ({OUT_MP4.stat().st_size:,} bytes)")
    print(f"Wrote {OUT_WEBP} ({OUT_WEBP.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
