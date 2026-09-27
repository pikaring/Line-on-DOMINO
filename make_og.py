# -*- coding: utf-8 -*-
"""SNSやチャットにリンクを貼ったときに出る画像（OGP、1200×630）を生成する。

    py make_og.py            → assets/og.png

アイコン（assets/icon.png）と紹介ページの見出しを、ページと同じ配色で組む。
reach-on-sanma などの紹介ページと同じ組み方。

フォントは Windows の游ゴシック／BIZ UD ゴシックを探し、無ければ Noto Sans CJK JP を探す。
どちらも無い環境では、OG_FONT_DIR にフォントのあるフォルダを指定する。
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1200, 630

S = dict(
    name='Line on DOMINO', assets='assets',
    head=['パスは、', '嘘をつかない。'],
    tag='登録もダウンロードも要らない4人ドミノ。CPUは覗き見しない。',
    url='pikaring.github.io/line-on-domino',
    paper=(250, 247, 242), ink=(42, 33, 27), muted=(141, 130, 121), accent=(178, 122, 38), glow=(241, 228, 207))

FONT_DIRS = [os.environ.get('OG_FONT_DIR', ''), r'C:\Windows\Fonts',
             '/usr/share/fonts/opentype/noto', '/usr/share/fonts/noto-cjk', '/usr/share/fonts/truetype/noto']
BOLD = ['YuGothB.ttc', 'BIZ-UDGothicB.ttc', 'meiryob.ttc', 'NotoSansCJKjp-Bold.otf', 'NotoSansCJK-Bold.ttc']
REGULAR = ['BIZ-UDGothicR.ttc', 'YuGothM.ttc', 'meiryo.ttc', 'NotoSansCJKjp-Regular.otf', 'NotoSansCJK-Regular.ttc']


def font(names, size):
    for d in FONT_DIRS:
        for n in names:
            p = os.path.join(d, n)
            if d and os.path.exists(p):
                return ImageFont.truetype(p, size)
    raise SystemExit('日本語フォントが見つかりません（OG_FONT_DIR で指定してください）')


F_NAME = font(['NotoSans-Bold.ttf'] + BOLD, 46)
F_HEAD = font(BOLD, 68)
F_URL = font(['NotoSans-Bold.ttf'] + BOLD, 24)

img = Image.new('RGB', (W, H), S['paper'])

# ヒーローと同じ、暖色の柔らかい光を右下に
glow = Image.new('RGB', (W, H), S['paper'])
gd = ImageDraw.Draw(glow)
gd.ellipse((520, 120, 1400, 900), fill=S['glow'])
glow = glow.filter(ImageFilter.GaussianBlur(120))
img = Image.blend(img, glow, 0.9)

d = ImageDraw.Draw(img)

# アイコン（左）
icon = Image.open(os.path.join(HERE, S['assets'], 'icon.png')).convert('RGBA').resize((280, 280), Image.LANCZOS)
shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle((96, 200, 376, 480), radius=62, fill=(0, 0, 0, 70))
shadow = shadow.filter(ImageFilter.GaussianBlur(28))
img.paste(shadow, (0, 0), shadow)
img.paste(icon, (90, 175), icon)

# 文字（右）
x = 440
d.text((x, 168), S['name'], font=F_NAME, fill=S['accent'])
y = 236
for line in S['head']:
    d.text((x, y), line, font=F_HEAD, fill=S['ink'])
    y += 86
# 右端に収まるまで少しずつ小さくする
size = 27
f_tag = font(REGULAR, size)
while d.textlength(S['tag'], font=f_tag) > W - x - 60 and size > 18:
    size -= 1
    f_tag = font(REGULAR, size)
d.text((x, y + 14), S['tag'], font=f_tag, fill=S['muted'])

# 下端：アクセントの帯と URL
d.rectangle((0, H - 10, W, H), fill=S['accent'])
d.text((x, H - 66), S['url'], font=F_URL, fill=S['muted'])

out = os.path.join(HERE, S['assets'], 'og.png')
img.save(out, optimize=True)
print('書き出し:', out, img.size)
