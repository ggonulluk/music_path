"""Faz 0 - kalite ve hiz testi.

Kullanim:
    .venv/Scripts/python.exe tools/separate_test.py songs/sarki.mp3
    .venv/Scripts/python.exe tools/separate_test.py songs/sarki.mp3 --hybrid
"""
import argparse
import time
from pathlib import Path

from demucs.api import Separator, save_audio

ROOT = Path(__file__).resolve().parent.parent
TR = {
    "vocals": "vokal",
    "drums": "davul",
    "bass": "bas",
    "guitar": "gitar",
    "piano": "piyano",
    "other": "diger",
}


def run(model_name, src, jobs, shifts):
    print(f"\n>> {model_name} yukleniyor...")
    sep = Separator(model=model_name, device="cpu", jobs=jobs,
                    shifts=shifts, progress=True)
    t0 = time.perf_counter()
    _, stems = sep.separate_audio_file(src)
    return stems, sep.samplerate, time.perf_counter() - t0


def main():
    p = argparse.ArgumentParser()
    p.add_argument("input")
    p.add_argument("--hybrid", action="store_true",
                   help="vokal/davul/bas icin htdemucs, gitar/piyano icin htdemucs_6s")
    p.add_argument("--jobs", type=int, default=2)
    p.add_argument("--shifts", type=int, default=1)
    p.add_argument("--wav", action="store_true", help="mp3 yerine wav yaz")
    args = p.parse_args()

    src = Path(args.input).resolve()
    if not src.exists():
        raise SystemExit(f"Dosya yok: {src}")

    out = ROOT / "stems" / src.stem
    out.mkdir(parents=True, exist_ok=True)

    stems, sr, elapsed = run("htdemucs_6s", src, args.jobs, args.shifts)
    total = elapsed

    if args.hybrid:
        stems4, sr, e2 = run("htdemucs", src, args.jobs, args.shifts)
        total += e2
        # 4-stem modelin daha temiz ciktilarini tercih et
        for k in ("vocals", "drums", "bass"):
            stems[k] = stems4[k]

    ext = "wav" if args.wav else "mp3"
    print()
    for name, wav in stems.items():
        dest = out / f"{TR.get(name, name)}.{ext}"
        save_audio(wav, dest, samplerate=sr)
        mb = dest.stat().st_size / 1e6
        print(f"  {TR.get(name, name):8s} -> {dest.name:14s} {mb:6.1f} MB")

    dur = stems["vocals"].shape[-1] / sr
    print(f"\nSarki suresi : {dur/60:.1f} dk")
    print(f"Ayirma suresi: {total/60:.1f} dk  ({total/dur:.1f}x gercek zaman)")
    print(f"Klasor       : {out}")


if __name__ == "__main__":
    main()
