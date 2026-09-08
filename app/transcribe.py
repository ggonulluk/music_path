"""Nota transkripsiyonu: izole kanaldan MIDI nota dizisi.

basic-pitch ANA venv'e giremiyor - TensorFlow cekiyor ve numpy'yi 1.26'ya
dusuruyor, bu da torch/demucs kurulumunu bozar. Bu yuzden `.venv-transcribe`
adinda ayri bir ortamda, alt surec olarak calisiyor.

Maliyet: 6:39'luk bir kanalda ~12 sn cikarim + ~30 sn TensorFlow acilisi.
Acilis her cagrida odeniyor, bu yuzden sonuc onbelleklenir.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENV_PY = ROOT / ".venv-transcribe" / "Scripts" / "python.exe"
WORKER = ROOT / "tools" / "bp_worker.py"
CACHE_VERSION = 1

# Davul perdesiz; nota cikarmak anlamsiz olurdu
TRANSCRIBABLE = ["gitar", "bas", "vokal", "piyano", "diger"]

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Standart akort gitar telleri: (isim, acik tel MIDI perdesi)
STRINGS = [("E", 40), ("A", 45), ("D", 50), ("G", 55), ("B", 59), ("e", 64)]


def available() -> bool:
    return VENV_PY.exists() and WORKER.exists()


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


def transcribe(folder: Path, stem: str, timeout: int = 900) -> dict:
    """Kanali nota dizisine cevir. Agir islem - cagiran cache'lemeli."""
    if stem not in TRANSCRIBABLE:
        raise ValueError(f"bu kanal icin nota cikarilmaz: {stem}")
    if not available():
        raise RuntimeError(
            ".venv-transcribe bulunamadi. Kurmak icin:\n"
            "  python -m venv .venv-transcribe\n"
            "  .venv-transcribe\\Scripts\\python.exe -m pip install basic-pitch")

    src = folder / f"{stem}.mp3"
    if not src.exists():
        raise FileNotFoundError(f"kanal yok: {src}")

    proc = subprocess.run(
        [str(VENV_PY), str(WORKER), str(src),
         str(json_path(folder, stem)), str(midi_path(folder, stem)), stem],
        capture_output=True, text=True, timeout=timeout,
        cwd=str(ROOT),
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-4:]
        raise RuntimeError("basic-pitch basarisiz:\n" + "\n".join(tail))

    d = load_cached(folder, stem)
    if d is None:
        raise RuntimeError("cikti dosyasi okunamadi")
    return d
