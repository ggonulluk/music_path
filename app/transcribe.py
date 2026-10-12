"""Nota transkripsiyonu: izole kanaldan MIDI nota dizisi.

basic-pitch'in ONNX modeli ana surecte calisiyor. Eskiden TensorFlow ile
ayri bir `.venv-transcribe` ortaminda alt surec olarak kosuyordu (1.8 GB,
pakete giremiyordu, her makinede elle kurulmasi gerekiyordu). ONNX ciktisi
TF ile birebir ayni - Whitesnake gitar kanalinda 1713/1713 nota, ayni
baslangic ve perde (olculdu) - ve onnxruntime ~40 MB.

basic-pitch `--no-deps` ile kurulu: paket meta verisi Windows/py3.11'de
tensorflow istiyor ve numpy'yi 1.26'ya dusurup torch'u bozuyor. Kodun
ihtiyac duydugu bagimliliklar requirements.txt'te ayrica sabitli.

Maliyet: 6:39'luk bir kanalda ~40 sn (ses cozme dahil). Sonuc onbelleklenir.
"""
from __future__ import annotations

import functools
import json
import logging
import time
from pathlib import Path

CACHE_VERSION = 1

# Davul perdesiz; nota cikarmak anlamsiz olurdu
TRANSCRIBABLE = ["gitar", "bas", "vokal", "piyano", "diger"]

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Standart akort gitar telleri: (isim, acik tel MIDI perdesi)
STRINGS = [("E", 40), ("A", 45), ("D", 50), ("G", 55), ("B", 59), ("e", 64)]


# Kanal basina frekans siniri. Aralik daraltmak, ayirmadan sizan
# bilesenleri (gitar kanalindaki bas dibi, zil tepesi gibi) eliyor.
BOUNDS = {
    "gitar":  (80.0, 1350.0),    # E2 - ~E6
    "bas":    (30.0, 400.0),     # B0 - ~G4
    "vokal":  (80.0, 1200.0),
    "piyano": (27.5, 4200.0),    # A0 - C8
    "diger":  (55.0, 2100.0),
}

# General MIDI program numaralari. basic-pitch her seye varsayilan olarak
# 4 (Electric Piano 1) yaziyor; gitar partisini piyanoyla dinlemek notalari
# takip etmeyi zorlastiriyor. Gitar icin bilerek TEMIZ ton secildi -
# distortion'li sesler MIDI sentezinde notalari birbirine karistiriyor.
PROGRAMS = {
    "gitar":  27,   # Electric Guitar (clean)
    "bas":    33,   # Electric Bass (finger)
    "vokal":  53,   # Voice Oohs
    "piyano":  0,   # Acoustic Grand Piano
    "diger":   4,   # Electric Piano 1
}


def _model():
    """ONNX model yolu. basic-pitch yuklu ama onnxruntime yoksa TF/CoreML
    yoluna dusmesin diye acikca .onnx istiyoruz."""
    # basic-pitch import aninda kurulu olmayan her arka uc (TF, CoreML,
    # TFLite) icin uyari basiyor; ONNX kullandigimiz icin hepsi gurultu
    root = logging.getLogger()
    level = root.level
    root.setLevel(logging.ERROR)
    try:
        from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    finally:
        root.setLevel(level)
    return build_icassp_2022_model_path(FilenameSuffix.onnx)


@functools.lru_cache(maxsize=1)
def available() -> bool:
    try:
        import onnxruntime  # noqa: F401
        return _model().exists()
    except Exception:
        return False


def note_name(p: int) -> str:
    return f"{NOTES[p % 12]}{p // 12 - 1}"


def fret_hint(p: int):
    """Notayi calmak icin en makul tel/perde.

    En dusuk perdeyi tercih ediyor. Kaba bir tahmin - gercek parmak
    pozisyonu cevredeki notalara gore degisir, ama baslangic noktasi verir.
    """
    best = None
    for name, open_p in STRINGS:
        f = p - open_p
        if 0 <= f <= 22 and (best is None or f < best[1]):
            best = (name, f)
    return {"string": best[0], "fret": best[1]} if best else None


def json_path(folder: Path, stem: str) -> Path:
    return folder / f"notes_{stem}.json"


def midi_path(folder: Path, stem: str) -> Path:
    return folder / f"notes_{stem}.mid"


def load_cached(folder: Path, stem: str):
    p = json_path(folder, stem)
    if not p.exists():
        return None
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return d if d.get("version") == CACHE_VERSION else None


def enrich(d: dict) -> dict:
    """Ham MIDI perdelerine nota adi ve tel/perde tahmini ekle."""
    pitches = [n[2] for n in d["notes"]]
    d = dict(d)
    if pitches:
        d["low"] = note_name(min(pitches))
        d["high"] = note_name(max(pitches))
        d["low_midi"] = min(pitches)
        d["high_midi"] = max(pitches)
    d["names"] = {str(p): note_name(p) for p in sorted(set(pitches))}
    d["frets"] = {str(p): fret_hint(p) for p in sorted(set(pitches))}
    return d


def transcribe(folder: Path, stem: str) -> dict:
    """Kanali nota dizisine cevir. Agir islem - cagiran cache'lemeli."""
    if stem not in TRANSCRIBABLE:
        raise ValueError(f"bu kanal icin nota cikarilmaz: {stem}")
    if not available():
        raise RuntimeError("nota cikarma modeli (onnxruntime) bulunamadi")

    src = folder / f"{stem}.mp3"
    if not src.exists():
        raise FileNotFoundError(f"kanal yok: {src}")

    from basic_pitch.inference import predict

    lo, hi = BOUNDS.get(stem, (55.0, 2100.0))
    t0 = time.time()
    _, midi, notes = predict(
        str(src),
        _model(),
        onset_threshold=0.6,
        frame_threshold=0.4,
        minimum_note_length=70,     # ms - kisa hayalet notalari at
        minimum_frequency=lo,
        maximum_frequency=hi,
    )
    for inst in midi.instruments:
        inst.program = PROGRAMS.get(stem, 0)
        inst.name = stem
    midi.write(str(midi_path(folder, stem)))

    rows = [
        [round(float(s), 3), round(float(e), 3), int(p), round(float(a), 3)]
        for s, e, p, a, _ in sorted(notes, key=lambda n: n[0])
    ]
    json_path(folder, stem).write_text(json.dumps({
        "version": CACHE_VERSION,
        "stem": stem,
        "count": len(rows),
        "range_hz": [lo, hi],
        "took": round(time.time() - t0, 1),
        "notes": rows,
    }), encoding="utf-8")

    d = load_cached(folder, stem)
    if d is None:
        raise RuntimeError("cikti dosyasi okunamadi")
    return d
