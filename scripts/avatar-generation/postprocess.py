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
# 被写体の縦占有（残りは上の余白になる）。下端に接地するので下余白は常に0。
SUBJECT_HEIGHT_RATIO = 0.92


def postprocess(src: str, dst: str) -> None:
    gray = Image.open(src).convert("L")
    alpha = gray.point(lambda value: 255 - value)  # 黒=不透明, 白=透明
    alpha = alpha.point(lambda a: a if a >= SHADOW_CUTOFF else 0)  # 薄い影/にじみを除去

    # 被写体のバウンディングボックスにクロップ
    box = alpha.getbbox()
    if box:
        alpha = alpha.crop(box)

    # 被写体のサイズは変えず（縦占有 SUBJECT_HEIGHT_RATIO）、下端に接地する。
    # 余白は上だけに残り、下余白は0。横幅が広い大柄は左右にブリードさせる（切れてよい）。
    width, height = alpha.size
    target_height = round(256 * SUBJECT_HEIGHT_RATIO)
    scale = target_height / height
    scaled = alpha.resize((max(1, round(width * scale)), target_height), Image.LANCZOS)

    canvas = Image.new("L", (256, 256), 0)
    offset_x = (256 - scaled.width) // 2  # 横は中央。広ければ左右にはみ出して切れる
    offset_y = 256 - scaled.height  # 下端に接地（下余白0・余白は上のみ）
    canvas.paste(scaled, (offset_x, offset_y))

    asset = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    asset.putalpha(canvas)  # RGB=黒のまま、色は保持しない
    asset.save(dst, optimize=True)


if __name__ == "__main__":
    postprocess(sys.argv[1], sys.argv[2])
