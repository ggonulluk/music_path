"""Mikserde duyulan miksi tek bir mp3'e indirger.

Acik kanallari fader seviyeleriyle carpip toplar. Ayirma ile ayni kod
yolunu kullanir - sphn cozer, lameenc yazar (ikisi de demucs.audio
uzerinden) - yani pakete tek bir yeni bagimlilik girmiyor.

Kanallar orijinale toplaniyor: Dylan sarkisinda 6 stem'in toplami
orijinalle 0.9905 korelasyon, artik fark -16.7 dB (mp3 kodlayicinin
1105 orneklik gecikmesi hizalandiktan sonra). Yani toplamak, mikserde
duyulanin sadik bir kopyasini veriyor.
"""
from __future__ import annotations

import math
import time
from pathlib import Path

import torch
from demucs.audio import AudioFile, save_audio

from .separator import BITRATE

# Bunun altindaki kazanci sifir say: fader 0.00 ile 0.005 arasindayken
# dosyayi okumanin anlami yok, -46 dB zaten duyulmuyor.
EPS = 0.005


def mix(stem_dir: Path, gains: dict[str, float], dest: Path) -> dict:
    """Kazanci sifir olmayan kanallari toplayip dest'e mp3 yazar.

    gains: kanal adi -> kazanc. Sifir olanlar hic okunmaz, o yuzden
    tek kanal kisildiginda maliyet de bir kanal kadar azaliyor.
    """
    t0 = time.time()
    used = [(n, g) for n, g in gains.items() if g > EPS]
    acc: torch.Tensor | None = None
    samplerate = 44100

    for name, gain in used:
        path = stem_dir / f"{name}.mp3"
        if not path.exists():
            continue
        handle = AudioFile(path)
        if acc is None:
            samplerate = int(handle.samplerate())
        wav = handle.read(streams=0, samplerate=samplerate, channels=2)
        wav *= gain
        if acc is None:
            acc = wav
            continue
        # Stem'ler ayni ayirmadan cikiyor, uzunluklari esit olmali. Yine de
        # bir kare kayma cikarsa kisa olani sifirla uzat; kirpmak sonu keser.
        if wav.shape[-1] > acc.shape[-1]:
            acc = torch.nn.functional.pad(acc, (0, wav.shape[-1] - acc.shape[-1]))
        elif wav.shape[-1] < acc.shape[-1]:
            wav = torch.nn.functional.pad(wav, (0, acc.shape[-1] - wav.shape[-1]))
        acc += wav
        del wav

    if acc is None:
        raise ValueError("okunabilir kanal yok")

    # save_audio varsayilan clip="rescale" ile 1'i asani zaten geri
    # olcekliyor. Biz sadece ne kadar indigini kullaniciya soyleyebilmek
    # icin olcuyoruz - fader'lar 1.3'e kadar cikabildigi icin mumkun.
    peak = float(acc.abs().max())
    atten = -20 * math.log10(peak) if peak > 1.0 else 0.0

    dest.parent.mkdir(parents=True, exist_ok=True)
    save_audio(acc, dest, samplerate=samplerate, bitrate=BITRATE)

    return {
        "stems": [n for n, _ in used],
        "peak": round(peak, 4),
        "atten_db": round(atten, 2),
        "seconds": round(time.time() - t0, 2),
    }
