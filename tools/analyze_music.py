"""Ton (key), gam, tempo ve akor tespiti prototipi.

Deney: ayni sarkiyi iki kaynaktan analiz edip karsilastirir.
  1) tam miks (orijinal mp3)
  2) armonik kanallar (gitar + bas + piyano + diger; davul ve vokal cikarilmis)

Beklenti: davul chroma'yi gurultuyle kirletir, vokal ise akorda olmayan
gecici notalar ekler. Ikisini de atinca akor tespiti duzelmeli.

Kullanim:
    .venv/Scripts/python.exe tools/analyze_music.py "songs/sarki.mp3"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import librosa
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SR = 22050

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
TR_NOTES = {"C#": "Do#", "D#": "Re#", "F#": "Fa#", "G#": "Sol#", "A#": "La#"}

# Krumhansl-Schmuckler ton profilleri (dinleyici deneylerinden turetilmis
# agirliklar; her perdenin o tonda ne kadar "evinde" oldugunu anlatir)
KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# Armonik kanallar: davul chroma'yi kirletir, vokal akor disi nota ekler
HARMONIC_STEMS = ["gitar", "bas", "piyano", "diger"]


# ----------------------------------------------------------------- yardimci

def chord_templates():
    """36 akor sablonu: 12 major + 12 minor + 12 power chord.

    Power chord (kok + besli, ucsuz) sart: rock'ta akorlarin buyuk kismi
    bu ve ucluye zorlandiginda eslestirici major/minor arasinda rastgele
    seciyor. Olcumde bolum sayisini 114'ten 90'a dusurdu.
    """
    names, temps = [], []
    for root in range(12):
        for kind, intervals in (("", (0, 4, 7)), ("m", (0, 3, 7)), ("5", (0, 7))):
            v = np.zeros(12)
            for i in intervals:
                v[(root + i) % 12] = 1.0
            temps.append(v / np.linalg.norm(v))
            names.append(NOTES[root] + kind)
    return names, np.array(temps)


def detect_key(chroma):
    """Krumhansl-Schmuckler: ortalama chroma'yi 24 ton profiliyle korele et."""
    prof = chroma.mean(axis=1)
    prof = prof / (prof.sum() + 1e-9)
    best = []
    for root in range(12):
        for name, ks in (("major", KS_MAJOR), ("minor", KS_MINOR)):
            r = np.corrcoef(prof, np.roll(ks, root))[0, 1]
            best.append((r, NOTES[root], name))
    best.sort(reverse=True)
    return best


def detect_chords(chroma, beats, sr, hop):
    """Vurus senkron akor tespiti + tekil sicramalari yumusatma."""
    names, temps = chord_templates()
    sync = librosa.util.sync(chroma, beats, aggregate=np.median)
    sync = sync / (np.linalg.norm(sync, axis=0, keepdims=True) + 1e-9)
    idx = np.argmax(temps @ sync, axis=0)

    # 1 vurusluk sicramalar neredeyse hep hata; komsulari ayniysa duzelt
    smoothed = idx.copy()
    for i in range(1, len(idx) - 1):
        if idx[i - 1] == idx[i + 1] and idx[i] != idx[i - 1]:
            smoothed[i] = idx[i - 1]

    times = librosa.frames_to_time(beats, sr=sr, hop_length=hop)
    segments = []
    for i, c in enumerate(smoothed):
        t = times[i] if i < len(times) else times[-1]
        if segments and segments[-1][2] == c:
            segments[-1][1] = t
        else:
            segments.append([t, t, c])
    return [(a, b, names[c]) for a, b, c in segments if b - a > 0.35]


def load_mix(path):
    y, _ = librosa.load(str(path), sr=SR, mono=True)
    return y


def load_stems(folder):
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
    out = np.zeros(n)
    for p in parts:
        out[: len(p)] += p
    return out / (np.abs(out).max() + 1e-9)


def analyze(y, label):
    print(f"\n{'=' * 66}\n{label}\n{'=' * 66}")
    hop = 512

    # Perkusif bileseni at: chroma icin sadece armonik kisim anlamli
    y_h = librosa.effects.harmonic(y, margin=3.0)
    chroma = librosa.feature.chroma_cqt(y=y_h, sr=SR, hop_length=hop, bins_per_octave=36)

    tempo, beats = librosa.beat.beat_track(y=y, sr=SR, hop_length=hop)
    tempo = float(np.atleast_1d(tempo)[0])

    ranked = detect_key(chroma)
    r0, root, mode = ranked[0]
    tr = TR_NOTES.get(root, root)
    print(f"  Tempo      : {tempo:.1f} BPM   ({len(beats)} vurus)")
    print(f"  Ton        : {tr} {'majör' if mode == 'major' else 'minör'}   (guven r={r0:.3f})")
    print("  Alternatif : " + ", ".join(
        f"{TR_NOTES.get(n, n)} {'maj' if m == 'major' else 'min'} ({r:.2f})"
        for r, n, m in ranked[1:4]))

    scale_note(root, mode)

    seg = detect_chords(chroma, beats, SR, hop)
    print(f"\n  Akor dizisi ({len(seg)} bolum, ilk 16):")
    for a, b, c in seg[:16]:
        print(f"    {int(a//60)}:{a%60:05.2f} - {int(b//60)}:{b%60:05.2f}   {c}")

    from collections import Counter
    top = Counter(c for _, _, c in seg).most_common(6)
    print("  En sik akorlar: " + ", ".join(f"{c} ({n})" for c, n in top))
    return {"tempo": tempo, "key": f"{root} {mode}", "conf": r0, "chords": seg}


def scale_note(root, mode):
    """Calisirken hangi gamin kullanilacagini sade dille soyle."""
    i = NOTES.index(root)
    if mode == "minor":
        rel = NOTES[(i + 3) % 12]
        pent = [NOTES[(i + k) % 12] for k in (0, 3, 5, 7, 10)]
        print(f"  Gam        : {TR_NOTES.get(root, root)} doğal minör "
              f"(= {TR_NOTES.get(rel, rel)} majörün akrabası)")
        print(f"  Pentatonik : {' '.join(TR_NOTES.get(n, n) for n in pent)}")
    else:
        rel = NOTES[(i + 9) % 12]
        pent = [NOTES[(i + k) % 12] for k in (0, 2, 4, 7, 9)]
        print(f"  Gam        : {TR_NOTES.get(root, root)} majör "
              f"(= {TR_NOTES.get(rel, rel)} minörün akrabası)")
        print(f"  Pentatonik : {' '.join(TR_NOTES.get(n, n) for n in pent)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    args = ap.parse_args()

    src = Path(args.input).resolve()
    if not src.exists():
        sys.exit(f"Dosya yok: {src}")

    a = analyze(load_mix(src), "1) TAM MİKS  (orijinal dosya)")

    folder = ROOT / "stems" / src.stem
    y = load_stems(folder) if folder.exists() else None
    if y is None:
        print(f"\n(Ayrilmis kanal yok: {folder} - karsilastirma atlandi)")
        return
    b = analyze(y, "2) ARMONİK KANALLAR  (gitar+bas+piyano+diger, davul ve vokal yok)")

    print(f"\n{'=' * 66}\nKARSILASTIRMA\n{'=' * 66}")
    print(f"  Ton      : miks={a['key']:10s}  kanallar={b['key']:10s}"
          f"   {'AYNI' if a['key'] == b['key'] else 'FARKLI'}")
    print(f"  Guven    : miks={a['conf']:.3f}      kanallar={b['conf']:.3f}"
          f"   ({'kanallar daha net' if b['conf'] > a['conf'] else 'miks daha net'})")
    print(f"  Tempo    : miks={a['tempo']:.1f}       kanallar={b['tempo']:.1f}")
    print(f"  Bolum    : miks={len(a['chords'])}          kanallar={len(b['chords'])}"
          f"   (az bolum = daha kararli, sicrama az)")


if __name__ == "__main__":
    main()
