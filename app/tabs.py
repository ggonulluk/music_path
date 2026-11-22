"""Tab ekrani icin sunucu tarafi: vurus izgarasi ve orijinal ses.

Tab ekrani (static/tab.html) ana oynaticidan BILEREK ayri. Ana programa
dokunmadan deneyebilmek icin kendi uclari burada; main.py yalnizca bu
router'i ekliyor.

VURUS IZGARASI NEDEN AYRI
  analysis.py vurus takibini akor ciktisi icin yapiyor ama vurus
  zamanlarini saklamiyor. Tab ekrani olcu cizgilerini, MusicXML disa
  aktarimi da notalari bu izgaraya oturtmak (kuantizasyon) icin bu
  zamanlara ihtiyac duyuyor. Analiz onbellegini (CACHE_VERSION)
  degistirmemek icin ayri dosyaya (beats.json) yaziliyor.

OLCU BASI
  librosa olcu basini bulmuyor, yalnizca vuruslari. Kick ve basin
  vurgusu olcu basinda guclu oldugu icin dusuk frekansli vurgu en
  yuksek olan faz olcu basi kabul ediliyor. Bu bir tahmin; tab ekrani
  kullanicinin bir vurus ileri/geri kaydirmasina izin veriyor.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

SR = 22050
HOP = 512
BEATS_VERSION = 1


def _extend(beats: list[float], duration: float) -> list[float]:
    """Izgarayi sarkinin basina ve sonuna uzat.

    beat_track ilk ve son birkac saniyede vurus vermiyor; oradaki
    notalarin da bir yere oturmasi gerekiyor.
    """
    if len(beats) < 2:
        step = 0.5
        beats = [0.0] if not beats else beats
    else:
        diffs = sorted(b - a for a, b in zip(beats, beats[1:]))
        step = diffs[len(diffs) // 2]
    out = list(beats)
    while out[0] > 0:
        out.insert(0, out[0] - step)
    while out[-1] < duration:
        out.append(out[-1] + step)
    return out


def compute_beats(audio: Path, per_bar: int = 4) -> dict:
    import librosa
    import numpy as np

    t0 = time.time()
    y, _ = librosa.load(str(audio), sr=SR, mono=True)
    duration = len(y) / SR
    tempo, frames = librosa.beat.beat_track(y=y, sr=SR, hop_length=HOP)
    beats = librosa.frames_to_time(frames, sr=SR, hop_length=HOP).tolist()

    # Olcu basi tahmini: dusuk frekans (kick, bas) vurgusu
    low = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP, fmax=200, n_mels=32)
    accent = [float(low[min(f, len(low) - 1)]) for f in frames]
    phase = 0
    if accent:
        sums = [sum(accent[i::per_bar]) / max(1, len(accent[i::per_bar]))
                for i in range(per_bar)]
        phase = int(np.argmax(sums))

    grid = _extend([round(b, 3) for b in beats], duration)
    added = 0
    while added < len(grid) and beats and grid[added] < beats[0] - 1e-6:
        added += 1
    return {
        "version": BEATS_VERSION,
        "beats": [round(b, 3) for b in grid],
        # izgaradaki ilk olcu basinin indeksi (0..per_bar-1)
        "downbeat": (phase + added) % per_bar,
        "tempo": round(float(np.atleast_1d(tempo)[0]), 1),
        "duration": round(duration, 3),
        "took": round(time.time() - t0, 1),
    }


def make_router(scan: Callable[[], dict[str, Path]], stems_root: Path) -> APIRouter:
    router = APIRouter(prefix="/api/tab")

    def lookup(sid: str) -> tuple[Path, Path]:
        lib = scan()
        if sid not in lib:
            raise HTTPException(404, "sarki bulunamadi")
        return lib[sid], stems_root / lib[sid].stem

    @router.get("/{sid}/source")
    def source(sid: str):
        """Orijinal sarki dosyasi - tab ekraninda 'tam sarki' dinlemek icin."""
        song, _ = lookup(sid)
        return FileResponse(song)

    @router.get("/{sid}/beats")
    def beats(sid: str):
        """Vurus izgarasi. Ilk istekte hesaplanir (~10-20 sn), sonra onbellekten."""
        song, folder = lookup(sid)
        cache = folder / "beats.json"
        if cache.exists():
            try:
                d = json.loads(cache.read_text(encoding="utf-8"))
                if d.get("version") == BEATS_VERSION:
                    return d
            except (OSError, ValueError):
                pass
        d = compute_beats(song)
        folder.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(d), encoding="utf-8")
        return d

    return router
