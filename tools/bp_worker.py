"""basic-pitch isci scripti.

ONEMLI: Bu script ANA venv'de degil, `.venv-transcribe` icinde calisir.
basic-pitch TensorFlow cekiyor ve numpy'yi 1.26'ya dusuruyor; ana ortamdaki
torch/demucs kurulumunu bozmamak icin ayri tutuldu. Ana uygulama bunu alt
surec olarak cagirir ve JSON okur.

Kullanim:
    .venv-transcribe/Scripts/python.exe tools/bp_worker.py <ses> <cikti.json> <cikti.mid> <kanal>
"""
import json
import sys
import time

from basic_pitch import ICASSP_2022_MODEL_PATH
from basic_pitch.inference import predict

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


def main():
    src, out_json, out_mid, stem = sys.argv[1:5]
    lo, hi = BOUNDS.get(stem, (55.0, 2100.0))

    t0 = time.time()
    _, midi, notes = predict(
        src,
        ICASSP_2022_MODEL_PATH,
        onset_threshold=0.6,
        frame_threshold=0.4,
        minimum_note_length=70,     # ms - kisa hayalet notalari at
        minimum_frequency=lo,
        maximum_frequency=hi,
    )
    for inst in midi.instruments:
        inst.program = PROGRAMS.get(stem, 0)
        inst.name = stem
    midi.write(out_mid)

    rows = [
        [round(float(s), 3), round(float(e), 3), int(p), round(float(a), 3)]
        for s, e, p, a, _ in sorted(notes, key=lambda n: n[0])
    ]
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump({
            "version": 1,
            "stem": stem,
            "count": len(rows),
            "range_hz": [lo, hi],
            "took": round(time.time() - t0, 1),
            "notes": rows,
        }, fh)
    print(f"OK {len(rows)} nota, {time.time() - t0:.1f} sn")


if __name__ == "__main__":
    main()
