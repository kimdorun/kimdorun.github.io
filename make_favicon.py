#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""생활금융 계산기 허브 — 파비콘 생성 (SVG + PNG + ICO).

파란 라운드 사각형 위에 흰색 ₩ 마크. 16px에서도 형태가 남도록 획을 굵게 잡는다.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)))
BLUE = (34, 87, 224, 255)
WHITE = (255, 255, 255, 255)


def draw_icon(size):
    s = size * 4  # 4배로 그린 뒤 축소해 계단을 줄인다
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=BLUE)

    stroke = max(2, int(s * 0.085))
    # W
    pts = [(int(s * 0.26), int(s * 0.31)), (int(s * 0.375), int(s * 0.70)),
           (int(s * 0.50), int(s * 0.49)), (int(s * 0.625), int(s * 0.70)),
           (int(s * 0.74), int(s * 0.31))]
    d.line(pts, fill=WHITE, width=stroke, joint="curve")
    # 두 개의 가로획 (₩)
    for y in (int(s * 0.455), int(s * 0.565)):
        d.line([(int(s * 0.21), y), (int(s * 0.79), y)], fill=WHITE, width=max(2, int(s * 0.05)))

    return img.resize((size, size), Image.LANCZOS)


def main():
    for size in (16, 32, 48, 180, 512):
        draw_icon(size).save(os.path.join(HERE, "favicon-%d.png" % size), "PNG", optimize=True)
    icons = [draw_icon(n) for n in (16, 32, 48)]
    icons[0].save(os.path.join(HERE, "favicon.ico"), format="ICO",
                  sizes=[(16, 16), (32, 32), (48, 48)])
    print("favicon.ico, favicon-{16,32,48,180,512}.png 생성")


if __name__ == "__main__":
    main()
