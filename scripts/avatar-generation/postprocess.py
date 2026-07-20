"""白背景の候補画像を正規アセット（アルファ透過PNG・256×256px）へ確定変換する後処理。

変換: 輝度→アルファ（黒=不透明・白=透明・中間=半透明）＋薄い影/にじみの除去
＋被写体のバウンディングボックスへクロップ（フレーム占有を全アバターで正規化）
＋正方パディング＋256×256リサイズ。色は持たない（RGB=黒, A のみ）。決定的。

使い方: python3 postprocess.py <input.png> <output.png>
"""

import sys

from PIL import Image

# これ未満のアルファ（＝薄いドロップシャドウ・背景のにじみ）は透明に落とす。
SHADOW_CUTOFF = 36
# 正方化後に付ける余白の割合（被写体が縁に張り付かないように）。
MARGIN_RATIO = 0.06


def postprocess(src: str, dst: str) -> None:
    gray = Image.open(src).convert("L")
    alpha = gray.point(lambda value: 255 - value)  # 黒=不透明, 白=透明
    alpha = alpha.point(lambda a: a if a >= SHADOW_CUTOFF else 0)  # 薄い影/にじみを除去

    # 被写体のバウンディングボックスにクロップ
    box = alpha.getbbox()
    if box:
        alpha = alpha.crop(box)

    # 高さ（頭〜肩の縦）基準で正規化する。横幅が広い大柄でも全体を縮めず、
    # 頭のサイズ・位置を一定に保ち、はみ出す肩は左右にブリードさせる（切れてよい）。
    width, height = alpha.size
    target_height = round(256 * (1 - MARGIN_RATIO * 2))
    scale = target_height / height
    scaled = alpha.resize((max(1, round(width * scale)), target_height), Image.LANCZOS)

    canvas = Image.new("L", (256, 256), 0)
    offset_x = (256 - scaled.width) // 2  # 中央寄せ。広ければ左右にはみ出して切れる
    offset_y = round(256 * MARGIN_RATIO)  # 頭を上端側に一定マージンで置く
    canvas.paste(scaled, (offset_x, offset_y))

    asset = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    asset.putalpha(canvas)  # RGB=黒のまま、色は保持しない
    asset.save(dst, optimize=True)


if __name__ == "__main__":
    postprocess(sys.argv[1], sys.argv[2])
