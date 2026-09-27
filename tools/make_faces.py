# -*- coding: utf-8 -*-
"""登場人物の顔アイコンを作る。

「街と、その白い壁」（white-squid）の立ち絵から顔のまわりを切り抜き、
ゲーム本体に埋め込む app/js/faces.js（data URI）と、紹介ページ用の assets/faces/*.webp を書き出す。
1 ファイル版（standalone.html）でも画像が出るように、ゲーム本体は画像ファイルを参照しない。

    py tools/make_faces.py ../white-squid/app/images/story

同じスクリプトを Reach on SANMA・All in TEXAS でも使う。書き出し先の名前空間（DM / MJ / PK）は
リポジトリのフォルダ名から決める。
"""
import base64
import io
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', 'white-squid', 'app', 'images', 'story')
NS = {'line-on-domino': 'DM', 'reach-on-sanma': 'MJ', 'all-in-texas': 'PK'}.get(os.path.basename(ROOT), 'DM')

# 使う表情: normal（席）・win（勝ったとき）・lose（負けたとき）
CAST = {
    'nao':   dict(box=(96, 20, 416, 340), normal='normal', win='happy', lose='surprised'),
    'fumi':  dict(box=(96, 20, 416, 340), normal='normal', win='happy', lose='surprised'),
    'maki':  dict(box=(96, 20, 416, 340), normal='normal', win='happy', lose='surprised'),
    'chika': dict(box=(96, 30, 416, 350), normal='normal', win='happy', lose='surprised'),
    'daiou': dict(box=(66, 10, 446, 390), normal='normal', win='normal', lose='down'),
    'queen': dict(box=(86, 0, 426, 340), normal='normal', win='normal', lose='surprised'),
}
SIZE = 128        # ゲーム本体に埋め込む大きさ（表示は最大 88px、高精細画面向けに 2 倍弱）
PAGE_SIZE = 192   # 紹介ページ用


def crop(name, face, size):
    im = Image.open(os.path.join(SRC, '%s-%s.png' % (name, face))).convert('RGBA')
    return im.crop(CAST[name]['box']).resize((size, size), Image.LANCZOS)


def webp(im, quality):
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=quality, method=6)
    return buf.getvalue()


lines = []
os.makedirs(os.path.join(ROOT, 'assets', 'faces'), exist_ok=True)
total = 0
for name, c in CAST.items():
    entry = []
    for kind in ('normal', 'win', 'lose'):
        data = webp(crop(name, c[kind], SIZE), 72)
        total += len(data)
        entry.append("%s: 'data:image/webp;base64,%s'" % (kind, base64.b64encode(data).decode()))
    lines.append('    %s: { %s }' % (name, ', '.join(entry)))
    with open(os.path.join(ROOT, 'assets', 'faces', name + '.webp'), 'wb') as f:
        f.write(webp(crop(name, c['win'], PAGE_SIZE), 80))

js = '''/*
 * faces.js - 登場人物の顔アイコン（tools/make_faces.py が生成。手で編集しない）
 *
 * 「街と、その白い壁」の立ち絵から顔のまわりを切り抜いたもの。
 * 1 ファイル版でも表示できるよう、画像は data URI で埋め込んである。
 */
(function (global) {
  'use strict';
  var NS = global.%s || (global.%s = {});
  NS.FACES = {
%s
  };
})(typeof window !== 'undefined' ? window : globalThis);
''' % (NS, NS, ',\n'.join(lines))
with open(os.path.join(ROOT, 'app', 'js', 'faces.js'), 'w', encoding='utf-8') as f:
    f.write(js)
print('書き出し: app/js/faces.js（画像 %d KB）' % (total // 1024))

# 確認用の一覧
sheet = Image.new('RGBA', (SIZE * 3, SIZE * len(CAST)), (58, 42, 30, 255))
for i, name in enumerate(CAST):
    for j, kind in enumerate(('normal', 'win', 'lose')):
        sheet.alpha_composite(crop(name, CAST[name][kind], SIZE), (j * SIZE, i * SIZE))
sheet.save(os.path.join(ROOT, 'faces_preview.png'))
print('確認用: faces_preview.png')
