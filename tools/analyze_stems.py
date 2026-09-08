"""Ayrilmis stem'lerin enerji analizi - kulakla dinlemeye eslik eden objektif veri."""
import sys
from pathlib import Path
import numpy as np
import sphn

STEMS = ["gitar", "vokal", "davul", "bas", "diger", "piyano"]
BUCKET = 30  # saniye


def db(x):
    return 20 * np.log10(max(x, 1e-9))


def main(folder):
    folder = Path(folder)
    env, overall, sr = {}, {}, None

    for name in STEMS:
        f = folder / f"{name}.mp3"
        wav, sr = sphn.read(str(f))
        mono = wav.mean(axis=0).astype(np.float32)
        overall[name] = db(float(np.sqrt(np.mean(mono**2))))
        n = sr * BUCKET
        buckets = [mono[i:i+n] for i in range(0, len(mono), n)]
        env[name] = np.array([np.sqrt(np.mean(b**2)) for b in buckets if len(b) > sr])
        del wav, mono

    print(f"\n{'='*62}\nGENEL SEVIYE (RMS, dBFS)  -  yuksek = o stem'de cok sinyal var\n{'='*62}")
    for name, v in sorted(overall.items(), key=lambda kv: -kv[1]):
        bar = "#" * int(max(0, (v + 60) / 2))
        print(f"  {name:8s} {v:7.1f} dB  {bar}")

    print(f"\n{'='*62}\nZAMANA GORE DAGILIM ({BUCKET} sn'lik dilimler)\n{'='*62}")
    print(f"  {'zaman':>9s}  " + "  ".join(f"{s[:5]:>5s}" for s in STEMS) + "   baskin")
    nb = len(env["gitar"])
    for i in range(nb):
        t = i * BUCKET
        vals = {s: db(float(env[s][i])) for s in STEMS}
        top = max(vals, key=vals.get)
        row = "  ".join(f"{vals[s]:5.0f}" for s in STEMS)
        print(f"  {t//60:3d}:{t%60:02d}-{(t+BUCKET)//60:d}:{(t+BUCKET)%60:02d}  {row}   {top}")

    g = env["gitar"]
    loud = int(np.argmax(g)) * BUCKET
    quiet = int(np.argmin(g)) * BUCKET
    print(f"\n  Gitar en gurultulu: {loud//60}:{loud%60:02d}   en sessiz: {quiet//60}:{quiet%60:02d}")


if __name__ == "__main__":
    main(sys.argv[1])
