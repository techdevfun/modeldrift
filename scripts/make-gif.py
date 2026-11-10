#!/usr/bin/env python3
"""Render demo/transcript.txt as a terminal-typing GIF (PIL, DejaVuSansMono).
The transcript is generated from real CLI runs (scripts/capture-demo.sh);
this script only renders it, never edits the content."""
from PIL import Image, ImageDraw, ImageFont
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

W = 1240
BG = (18, 18, 24)
FG = (220, 220, 220)
DIM = (150, 150, 160)
GREEN = (120, 220, 130)
YELLOW = (235, 200, 100)
RED = (240, 110, 110)
CYAN = (120, 200, 230)

font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 12)
bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 12)
LINE_H = 16

lines = open(os.path.join(ROOT, "demo", "transcript.txt")).read().splitlines()
H = 14 + len(lines) * LINE_H + 44

def color_for(line: str):
    if line.startswith("$"):
        return GREEN
    if line.startswith("#"):
        return DIM
    if "DRIFT DETECTED" in line:
        return RED
    if "REFUSAL-FLIP" in line:
        return YELLOW
    if line.startswith("exit: 1"):
        return RED
    if line.startswith("exit: 0"):
        return GREEN
    if "FAIL:" in line or "model changed silently" in line:
        return RED
    if line.startswith("pin OK"):
        return GREEN
    if "verdict: STABLE" in line:
        return GREEN
    return FG

frames = []
canvas: list[tuple[str, tuple]] = []

# Title card (3s): what the demo shows
title = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(title)
d.text((14, 200), "modeldrift - did the model change its behavior?", font=bold, fill=GREEN)
d.text((14, 250), "1. init a 12-prompt suite, pin model claude-fable-5.1", font=font, fill=FG)
d.text((14, 280), "2. diff baseline vs current: 2 refusal flips, 1 length drift", font=font, fill=FG)
d.text((14, 310), "3. check fails fast: the run is fable-5.2, the pin says 5.1", font=font, fill=FG)
d.text((14, 380), "zero-dep CLI - no provider calls, no API key", font=font, fill=DIM)
d.text((14, 410), "demo fixtures are synthetic seeded runs, not real vendor runs", font=font, fill=DIM)
for _ in range(50):
    frames.append(title.copy())

def render(canvas_tmp):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = 14
    for text, color in canvas_tmp:
        f = bold if text.startswith("$") else font
        d.text((14, y), text, font=f, fill=color)
        y += LINE_H
        if y > H - 30:
            break
    d.rectangle([14, H - 24, 22, H - 12], fill=GREEN)
    return img

for line in lines:
    color = color_for(line)
    step = max(1, len(line) // 12)
    for i in range(0, len(line) + 1, step):
        frames.append(render(canvas + [(line[:i], color)]))
    canvas.append((line, color))
    if line.startswith("exit:"):
        for _ in range(14):
            frames.append(frames[-1].copy())

for _ in range(30):
    frames.append(frames[-1].copy())

out = os.path.join(ROOT, "demo", "modeldrift-demo.gif")
frames[0].save(
    out,
    save_all=True,
    append_images=frames[1:],
    duration=50,
    loop=0,
)
print(f"frames={len(frames)} size={os.path.getsize(out)} duration~{len(frames)*50/1000:.1f}s")
