"""Logodan Windows ikonu (.ico) uretir.

    .venv\\Scripts\\python.exe tools\\make_icon.py

Kaynak: logo.jfif (2816x1536, amblem + yazi). Sadece soldaki amblem
kirpiliyor - "GgMix" yazisi 16-32 px'de okunmaz, leke olur.

Arka plan seffaf DEGIL, yuvarlak koseli koyu kare: amblem koyu zemin
uzerine cizilmis (kaynakta alfa yok), seffaf yapinca acik renkli gorev
cubugunda kenarlari kirli gorunuyor. Koyu karo her temada temiz duruyor.

Cikti: app/static/icon.ico - exe ikonu (build.py) ve tepsi ikonu
(launcher.py) ayni dosyayi kullanir.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "logo.jfif"
OUT = ROOT / "app" / "static" / "icon.ico"

# Amblemin kaynak goruntudeki merkezi ve kare kirpma kenari (piksel).
# Olculdu: amblem ~x 407-1220, y 454-1111; dalga cizgisi solda tasiyor.
CENTER = (812, 790)
SIDE = 860

SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
BG = (17, 17, 22, 255)          # arayuzun --bg rengine yakin


def emblem(size: int) -> Image.Image:
    src = Image.open(SRC).convert("RGB")
    cx, cy = CENTER
    h = SIDE // 2
    crop = src.crop((cx - h, cy - h, cx + h, cy + h))

    # Kucuk boyutlarda amblem karoyu doldursun; buyukte biraz nefes payi
    pad = 0.04 if size <= 32 else 0.08
    inner = round(size * (1 - 2 * pad))
    art = crop.resize((inner, inner), Image.LANCZOS)

    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=round(size * 0.22), fill=255)
    tile.paste(Image.new("RGBA", (size, size), BG), (0, 0), mask)
    off = (size - inner) // 2
    tile.paste(art, (off, off))
    # Kirpilan kare koseleri karonun disina tasmasin
    tile.putalpha(mask)
    return tile


def main() -> None:
    big = emblem(256)
    # Her boyutu ayri olcekliyoruz (256'dan kuculterek degil): 16 px'de
    # dolgu orani farkli, tek kaynaktan inince amblem fazla kuculuyor.
    frames = {s: emblem(s) for s in SIZES}
    big.save(OUT, format="ICO", sizes=[(s, s) for s in SIZES],
             append_images=[frames[s] for s in SIZES if s != 256])
    print(f"{OUT}  ({OUT.stat().st_size / 1024:.0f} KB, {len(SIZES)} boyut)")


if __name__ == "__main__":
    main()
