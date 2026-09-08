"""Ton, gam, tempo ve akor analizi.

Kaynak olarak ARMONIK KANALLAR kullaniliyor (gitar + bas + piyano + diger).
Davul chroma'yi genis bantli gurultuyle kirletir, vokal ise akorda olmayan
gecici notalar ekler. Olcumde bu ikisini atmak akor tespitini belirgin
stabillestirdi: ayni sarkida 113 bolum yerine 90.

Nota isimleri bastan sona harf notasyonu (E, F#, A) - gitaristin kullandigi
sistem bu. Solfej (Mi, Fa#) klasik teoride yaygin ama burada karisiklik
yaratirdi.
"""
from __future__ import annotations

import json
import time
from collections import Counter
from pathlib import Path

import librosa
import numpy as np

SR = 22050
HOP = 512
CACHE_VERSION = 2

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Schmuckler ton profilleri: dinleyici deneylerinden turetilmis
# agirliklar, her perdenin o tonda ne kadar "evinde" oldugunu anlatir
KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

HARMONIC_STEMS = ["gitar", "bas", "piyano", "diger"]

MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]
MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10]
MAJOR_PENT = [0, 2, 4, 7, 9]
MINOR_PENT = [0, 3, 5, 7, 10]


def _templates():
    """36 akor sablonu: 12 major + 12 minor + 12 power chord.

    Power chord (kok + besli, ucsuz) sart: rock'ta akorlarin buyuk kismi
    bu ve ucluye zorlandiginda eslestirici major/minor arasinda rastgele
    seciyor. Olcumde bolum sayisini 114'ten 90'a dusurdu.
    """
    names, temps = [], []
    for root in range(12):
        for kind, iv in (("", (0, 4, 7)), ("m", (0, 3, 7)), ("5", (0, 7))):
            v = np.zeros(12)
            for i in iv:
                v[(root + i) % 12] = 1.0
            temps.append(v / np.linalg.norm(v))
            names.append(NOTES[root] + kind)
    return names, np.array(temps)


def _rank_keys(chroma):
    prof = chroma.mean(axis=1)
    prof = prof / (prof.sum() + 1e-9)
    out = []
    for root in range(12):
        for mode, ks in (("major", KS_MAJOR), ("minor", KS_MINOR)):
            r = np.corrcoef(prof, np.roll(ks, root))[0, 1]
            out.append((float(r), NOTES[root], mode))
    out.sort(reverse=True)
    return out


def _chords(chroma, beats):
    names, temps = _templates()
    sync = librosa.util.sync(chroma, beats, aggregate=np.median)
    sync = sync / (np.linalg.norm(sync, axis=0, keepdims=True) + 1e-9)
    idx = np.argmax(temps @ sync, axis=0)

    # 1 vurusluk sicramalar neredeyse hep hata; komsulari ayniysa duzelt
    for i in range(1, len(idx) - 1):
        if idx[i - 1] == idx[i + 1] and idx[i] != idx[i - 1]:
            idx[i] = idx[i - 1]

    times = librosa.frames_to_time(beats, sr=SR, hop_length=HOP)
    segs = []
    for i, c in enumerate(idx):
        t = float(times[i]) if i < len(times) else float(times[-1])
        if segs and segs[-1][2] == c:
            segs[-1][1] = t
        else:
            segs.append([t, t, int(c)])
    return [[round(a, 2), round(b, 2), names[c]] for a, b, c in segs if b - a > 0.35]


def _scale(root, mode):
    i = NOTES.index(root)
    steps = MINOR_STEPS if mode == "minor" else MAJOR_STEPS
    pent = MINOR_PENT if mode == "minor" else MAJOR_PENT
    rel_i = (i + 3) % 12 if mode == "minor" else (i + 9) % 12
    rel_mode = "majör" if mode == "minor" else "minör"
    return {
        "name": f"{root} doğal {'minör' if mode == 'minor' else 'majör'}",
        "notes": [NOTES[(i + k) % 12] for k in steps],
        "pentatonic": [NOTES[(i + k) % 12] for k in pent],
        "relative": f"{NOTES[rel_i]} {rel_mode}",
    }


def _load_harmonic(folder: Path):
    parts, n = [], 0
    for s in HARMONIC_STEMS:
        f = folder / f"{s}.mp3"
        if not f.exists():
            continue
        y, _ = librosa.load(str(f), sr=SR, mono=True)
        parts.append(y)
        n = max(n, len(y))
    if not parts:
        return None
    out = np.zeros(n, dtype=np.float32)
    for p in parts:
        out[: len(p)] += p
    return out / (np.abs(out).max() + 1e-9)


def analyze(folder: Path) -> dict:
    """Klasordeki kanallari analiz et. Agir islem - cagiran cache'lemeli."""
    y = _load_harmonic(folder)
    if y is None:
        raise FileNotFoundError(f"armonik kanal bulunamadi: {folder}")

    t0 = time.time()
    # Perkusif bileseni at: chroma icin sadece armonik kisim anlamli
    chroma = librosa.feature.chroma_cqt(
        y=librosa.effects.harmonic(y, margin=3.0), sr=SR,
        hop_length=HOP, bins_per_octave=36)
    tempo, beats = librosa.beat.beat_track(y=y, sr=SR, hop_length=HOP)

    ranked = _rank_keys(chroma)
    conf, root, mode = ranked[0]
    chords = _chords(chroma, beats)

    # Vurus takipcileri sik sik yariyi ya da katini bulur (Dylan'in agir
    # baladina 143.6 BPM demisti, gercegi ~72). Gizlemek yerine alternatifi
    # de veriyoruz, kullanici hangisinin dogru oldugunu duyarak secer.
    bpm = round(float(np.atleast_1d(tempo)[0]), 1)
    alt = round(bpm / 2, 1) if bpm > 140 else (round(bpm * 2, 1) if bpm < 70 else None)

    return {
        "version": CACHE_VERSION,
        "key": {
            "root": root,
            "mode": mode,
            "label": f"{root} {'minör' if mode == 'minor' else 'majör'}",
            "confidence": round(conf, 3),
        },
        "alternatives": [
            {"label": f"{n} {'minör' if m == 'minor' else 'majör'}",
             "confidence": round(r, 3)}
            for r, n, m in ranked[1:4]
        ],
        "scale": _scale(root, mode),
        "tempo": bpm,
        "tempo_alt": alt,
        "chords": chords,
        "common_chords": [c for c, _ in Counter(c for _, _, c in chords).most_common(6)],
        "took": round(time.time() - t0, 1),
    }


def cache_path(folder: Path) -> Path:
    return folder / "analysis.json"


def load_cached(folder: Path):
    p = cache_path(folder)
    if not p.exists():
        return None
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return d if d.get("version") == CACHE_VERSION else None


def analyze_cached(folder: Path) -> dict:
    d = load_cached(folder)
    if d is None:
        d = analyze(folder)
        cache_path(folder).write_text(
            json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    return d
