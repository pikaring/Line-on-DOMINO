# -*- coding: utf-8 -*-
"""紹介ページ用のアイコンを生成する。

名前の Line（場にのびる列）をそのまま絵にする。胡桃色の卓に、手前の 6-6 から
6-3・3-1 と端どうしをつないだ列を、右上へ斜めにのばす。
目の色はゲーム本体と同じ（目ごとに色が違う）。外部の画像素材は使わず、ここで描く。

    py make_icon.py
"""
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')
S = 1024

TABLE = (58, 42, 30)          # 下地（胡桃の卓）
TABLE_LINE = (74, 55, 40)     # 卓の木目
BONE = (251, 246, 234)        # 牌の面
BONE_EDGE = (207, 195, 168)   # 牌の縁・中央の仕切り
SHADOW = (30, 21, 15, 150)
PIP = {1: (28, 124, 140), 2: (47, 125, 50), 3: (192, 57, 43), 4: (109, 76, 47),
       5: (31, 95, 174), 6: (123, 63, 160)}
# 3×3 の格子のどこに目を打つか（app/js/ui.js と同じ）
LAYOUT = [[], [4], [2, 6], [2, 4, 6], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]]


def domino(u, top, bottom):
    """縦置きの牌（幅 u、高さ 2u）を透明レイヤーに描く。"""
    pad = int(u * 0.12)
    w, h = u, u * 2
    layer = Image.new('RGBA', (w + pad * 4, h + pad * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0 = pad * 2, pad * 2
    r = int(u * 0.14)
    # 影
    d.rounded_rectangle((x0 + pad * 0.6, y0 + pad * 1.1, x0 + w + pad * 0.6, y0 + h + pad * 1.1), radius=r, fill=SHADOW)
    # 厚み
    d.rounded_rectangle((x0, y0 + u * 0.05, x0 + w, y0 + h + u * 0.05), radius=r, fill=BONE_EDGE)
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=r, fill=BONE, outline=BONE_EDGE, width=max(2, int(u * 0.02)))
    # 仕切り
    d.line([(x0 + u * 0.14, y0 + u), (x0 + w - u * 0.14, y0 + u)], fill=BONE_EDGE, width=max(2, int(u * 0.03)))
    # 目
    for half, n in ((0, top), (1, bottom)):
        cell = u * 0.76 / 3
        gx, gy = x0 + u * 0.12, y0 + half * u + u * 0.12
        pr = cell * 0.36
        for i in LAYOUT[n]:
            cx = gx + cell * (i % 3) + cell / 2
            cy = gy + cell * (i // 3) + cell / 2
            d.ellipse((cx - pr, cy - pr, cx + pr, cy + pr), fill=PIP[n])
    return layer


def draw(img):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, S, S), radius=int(S * 0.22), fill=TABLE)
    # 木目を薄く 3 本（小さいサイズでは消える程度）
    for y in (int(S * 0.24), int(S * 0.52), int(S * 0.80)):
        d.line([(int(S * 0.08), y), (int(S * 0.92), y + int(S * 0.03))], fill=TABLE_LINE, width=int(S * 0.012))

    # 手前の 6-6 から右上へ、6-3・3-1 と端どうしをつないで列をのばす（奥ほど小さく）
    v = (0.7071, -0.7071)
    cx, cy = S * 0.31, S * 0.70
    prev_len = None
    for u, top, bottom in ((0.22, 6, 6), (0.165, 3, 6), (0.12, 1, 3)):
        tile = domino(int(S * u), top, bottom).rotate(-45, resample=Image.BICUBIC, expand=True)
        length = S * u * 2
        if prev_len is not None:
            step = (prev_len + length) / 2 + S * 0.012
            cx, cy = cx + v[0] * step, cy + v[1] * step
        prev_len = length
        img.alpha_composite(tile, (int(cx - tile.width / 2), int(cy - tile.height / 2)))


img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
draw(img)

os.makedirs(ASSETS, exist_ok=True)
img.resize((512, 512), Image.LANCZOS).save(os.path.join(ASSETS, 'icon.png'))
img.save(os.path.join(ASSETS, 'favicon.ico'), sizes=[(48, 48), (32, 32), (16, 16)])
print('書き出し:', os.path.join(ASSETS, 'icon.png'))
print('書き出し:', os.path.join(ASSETS, 'favicon.ico'))

sizes = [256, 128, 64, 48, 32, 16]
strip = Image.new('RGBA', (sum(sizes) + 20 * len(sizes), 280), (250, 250, 250, 255))
x = 10
for s in sizes:
    small = img.resize((s, s), Image.LANCZOS)
    strip.paste(small, (x, 10), small)
    x += s + 20
strip.save(os.path.join(HERE, 'icon_preview.png'))
print('確認用:', os.path.join(HERE, 'icon_preview.png'))
