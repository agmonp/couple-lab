import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT_DIR = Path(r"C:\Users\User\Desktop\Love app tamar agmon\demo-video")
SCREENS = OUT_DIR / "screens"
OUT = OUT_DIR / "couplelab-demo-he.mp4"
W, H = 1600, 900
FPS = 24

font_regular = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 40)
font_bold = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 60)
font_title = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 80)
font_small = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 30)

TEAL = (20, 126, 120)
CORAL = (191, 77, 69)
INK = (27, 29, 25)
MUTED = (82, 88, 78)
LINE = (216, 222, 211)

story = [
    ("intro", None, 4.0, "CoupleLab", ["מעבדה מקומית לתרגול זוגי", "שיחות מונחות, תיקון קונפליקט ורפלקציה"], ["ניסיוני. לא אבחוני. נבנה כדי לקבל פידבק מקצועי."]),
    ("screen", "dashboard.png", 6.0, "מסלול עבודה ברור", ["הערכה, תרגול, תובנות, יועץ ודוח", "בממשק מקומי אחד על המחשב"], []),
    ("screen", "practice.png", 7.0, "Practice Studio", ["שאלות עומק, מצלמה, תמלול ותיוג שיחה", "מי אמר מה, מתי, ולמי"], []),
    ("crop", "practice.png", 7.0, "ניתוח לא מילולי זהיר", ["רמזים הסתברותיים בלבד:", "חום, עניין, מתח, התרחקות והצפה"], []),
    ("screen", "adviser.png", 6.0, "Relationship Adviser", ["Four Horsemen, repair attempts, flooding reset", "ותרגילים קצרים להמשך השיחה"], []),
    ("screen", "report.png", 6.0, "דוח אחרי שיחה", ["חוזקות, דפוסי סיכון, timestamps", "וסיכום לאבחון עצמי זהיר"], []),
    ("screen", "export.png", 5.0, "Local-first", ["התמלול, התגים והדוחות נשארים במחשב", "אלא אם הזוג בוחר אחרת"], []),
    ("outro", None, 5.0, "מחפש פידבק", ["מה הכלי הזה צריך לשפר?", "מה חשוב שלא יטען או יסיק?"], ["לינק ציבורי: GitHub / Vercel / Loom / YouTube"]),
]


def rtl(text: str) -> str:
    return text[::-1]


def text_rtl(draw: ImageDraw.ImageDraw, right_x: int, y: int, text: str, font: ImageFont.FreeTypeFont, fill):
    # Simple visual reversal for Hebrew captions where libraqm/bidi is unavailable.
    visual = rtl(text) if any("\u0590" <= char <= "\u05ff" for char in text) else text
    box = draw.textbbox((0, 0), visual, font=font)
    draw.text((right_x - (box[2] - box[0]), y), visual, font=font, fill=fill)


def rounded(draw, xy, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def gradient_bg():
    arr = np.zeros((H, W, 3), dtype=np.uint8)
    for y in range(H):
        trow = y / H
        for x in range(W):
            t = x / W * 0.55 + trow * 0.45
            arr[y, x] = [
                int(246 * (1 - t) + 232 * t),
                int(247 * (1 - t) + 240 * t),
                int(242 * (1 - t) + 235 * t),
            ]
    return Image.fromarray(arr, "RGB")


BG = gradient_bg()


def draw_logo(draw, x, y, size=92):
    rounded(draw, (x, y, x + size, y + size), 18, TEAL)
    draw.ellipse((x + size * 0.52, y + size * 0.52, x + size * 1.13, y + size * 1.13), fill=CORAL)
    draw.text((x + size + 24, y - 6), "CoupleLab", font=font_title, fill=INK)
    draw.text((x + size + 28, y + 82), "Connection Practice", font=font_small, fill=MUTED)


def intro(_title, lines, note):
    img = BG.copy().convert("RGBA")
    draw = ImageDraw.Draw(img)
    draw_logo(draw, 150, 165, 96)
    y = 365
    for line in lines:
        text_rtl(draw, 1450, y, line, font_regular, MUTED)
        y += 52
    rounded(draw, (150, 525, 1450, 655), 22, (255, 255, 255, 236), LINE, 2)
    text_rtl(draw, 1410, 565, note[0], font_regular, INK)
    text_rtl(draw, 1450, 785, "פרטיות מקומית. מבוסס-ידע. מיועד לפידבק, לא לאבחון.", font_small, TEAL)
    return img.convert("RGB")


def outro(title, lines, note):
    img = BG.copy().convert("RGBA")
    draw = ImageDraw.Draw(img)
    draw_logo(draw, 150, 130, 84)
    text_rtl(draw, 1450, 310, title, font_title, INK)
    y = 430
    for line in lines:
        text_rtl(draw, 1450, y, line, font_regular, MUTED)
        y += 54
    rounded(draw, (150, 600, 1450, 715), 22, (255, 255, 255, 236), LINE, 2)
    text_rtl(draw, 1410, 638, note[0], font_regular, INK)
    text_rtl(draw, 1450, 800, "CoupleLab - גרסת דמו ניסיונית, מקומית ולא אבחונית.", font_small, TEAL)
    return img.convert("RGB")


def load(name, kind):
    img = Image.open(SCREENS / name).convert("RGB").resize((W, H), Image.LANCZOS)
    if kind == "crop":
        img = img.crop((540, 115, 1600, 900)).resize((W, H), Image.LANCZOS)
    return img


def overlay(img, title, lines):
    frame = img.convert("RGBA")
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    rounded(draw, (70, 650, 1530, 850), 22, (255, 255, 255, 238), LINE, 2)
    draw.rectangle((1516, 650, 1530, 850), fill=TEAL)
    text_rtl(draw, 1488, 674, title, font_bold, INK)
    y = 748
    for line in lines[:2]:
        text_rtl(draw, 1488, y, line, font_regular, MUTED)
        y += 48
    return Image.alpha_composite(frame, layer).convert("RGB")


frames = []
for kind, name, duration, title, lines, note in story:
    if kind == "intro":
        frame = intro(title, lines, note)
    elif kind == "outro":
        frame = outro(title, lines, note)
    else:
        frame = overlay(load(name, kind), title, lines)
    frames.append((frame, duration))

if OUT.exists():
    OUT.unlink()
writer = cv2.VideoWriter(str(OUT), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
if not writer.isOpened():
    raise RuntimeError("Could not open MP4 writer")
for frame, duration in frames:
    bgr = cv2.cvtColor(np.array(frame), cv2.COLOR_RGB2BGR)
    for _ in range(int(duration * FPS)):
        writer.write(bgr)
writer.release()
print(OUT)
print(OUT.stat().st_size)
