"""Demucs ayirma motoru: tek isci thread'li kuyruk + ilerleme takibi.

Ayirma CPU-yogun ve tek seferlik. Ayni anda birden fazla sarki islemek
toplam sureyi kisaltmaz, sadece RAM'i sisirir - bu yuzden tek isci.
"""
from __future__ import annotations

import queue
import threading
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from demucs.api import Separator, save_audio

ROOT = Path(__file__).resolve().parent.parent
SONGS = ROOT / "songs"
STEMS = ROOT / "stems"

# Kaynak 128-320 kbps mp3; stem'leri 192'de tutmak duyulur kayip vermiyor
# ve sarki basina ~96 MB yerine ~58 MB'a indiriyor.
BITRATE = 192

TR = {
    "vocals": "vokal",
    "drums": "davul",
    "bass": "bas",
    "guitar": "gitar",
    "piano": "piyano",
    "other": "diger",
}
STEM_ORDER = ["gitar", "vokal", "davul", "bas", "piyano", "diger"]


@dataclass
class Job:
    song_id: str
    src: Path
    dest: Path
    mode: str = "hybrid"          # "fast" (tek model) | "hybrid" (iki model)
    state: str = "queued"          # queued | running | done | error
    progress: float = 0.0          # 0..1
    stage: str = ""
    error: str = ""
    queued_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None

    def as_dict(self) -> dict:
        d = {
            "song_id": self.song_id,
            "state": self.state,
            "progress": round(self.progress, 4),
            "stage": self.stage,
            "mode": self.mode,
        }
        if self.error:
            d["error"] = self.error
        if self.started_at and self.state == "running":
            d["elapsed"] = round(time.time() - self.started_at, 1)
        if self.started_at and self.finished_at:
            d["took"] = round(self.finished_at - self.started_at, 1)
        return d


class SeparationQueue:
    """Arka planda tek isci ile calisan ayirma kuyrugu."""

    def __init__(self) -> None:
        self._q: "queue.Queue[Job]" = queue.Queue()
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._models: dict[str, Separator] = {}
        self._worker = threading.Thread(target=self._run, daemon=True, name="separator")
        self._worker.start()

    # ---------------------------------------------------------------- public

    def submit(self, song_id: str, src: Path, dest: Path, mode: str = "hybrid") -> Job:
        with self._lock:
            existing = self._jobs.get(song_id)
            if existing and existing.state in ("queued", "running"):
                return existing
            job = Job(song_id=song_id, src=src, dest=dest, mode=mode)
            self._jobs[song_id] = job
        self._q.put(job)
        return job

    def get(self, song_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(song_id)

    def all(self) -> dict[str, dict]:
        with self._lock:
            return {k: v.as_dict() for k, v in self._jobs.items()}

    # ---------------------------------------------------------------- worker

    def _separator(self, name: str, on_progress) -> Separator:
        """Modeli bir kez yukle, sonraki isler icin bellekte tut."""
        if name not in self._models:
            self._models[name] = Separator(model=name, device="cpu", jobs=2, progress=False)
        sep = self._models[name]
        sep.update_parameter(callback=on_progress)
        return sep

    def _run(self) -> None:
        while True:
            job = self._q.get()
            try:
                self._process(job)
            except Exception:
                job.state = "error"
                job.error = traceback.format_exc(limit=3)
                job.finished_at = time.time()
            finally:
                self._q.task_done()

    def _process(self, job: Job) -> None:
        job.state = "running"
        job.started_at = time.time()
        job.dest.mkdir(parents=True, exist_ok=True)

        passes = ["htdemucs_6s"] + (["htdemucs"] if job.mode == "hybrid" else [])
        total_passes = len(passes)
        stems: dict[str, object] = {}
        samplerate = 44100

        for idx, model_name in enumerate(passes):
            job.stage = f"{model_name} ({idx + 1}/{total_passes})"
            base, span = idx / total_passes, 1 / total_passes
            # Ayirma asamasi toplam surenin ~%90'i, yazma ~%10'u
            out_sr: dict = {}
            self._apply(job, model_name, base, span * 0.9, stems, out_sr)
            samplerate = out_sr.get("sr", samplerate)

        job.stage = "dosyalar yaziliyor"
        names = list(stems.keys())
        for i, name in enumerate(names):
            dest = job.dest / f"{TR.get(name, name)}.mp3"
            save_audio(stems[name], dest, samplerate=samplerate, bitrate=BITRATE)
            job.progress = 0.9 + 0.1 * (i + 1) / len(names)

        stems.clear()
        job.progress = 1.0
        job.state = "done"
        job.stage = "hazir"
        job.finished_at = time.time()

    def _apply(self, job: Job, model_name: str, base: float, span: float,
               stems: dict, out_sr: dict) -> None:
        seen = {"max": 0}

        def on_progress(data: dict) -> None:
            # segment_offset paralel havuzdan sirasiz gelebilir -> max tut
            off = data.get("segment_offset", 0)
            length = data.get("audio_length") or 0
            if length:
                seen["max"] = max(seen["max"], off)
                job.progress = base + span * min(1.0, seen["max"] / length)

        sep = self._separator(model_name, on_progress)
        out_sr["sr"] = sep.samplerate
        _, separated = sep.separate_audio_file(job.src)

        if not stems:
            stems.update(separated)
        else:
            # hibrit: 4-stem modelin daha temiz vokal/davul/bas'ini tercih et
            for key in ("vocals", "drums", "bass"):
                if key in separated:
                    stems[key] = separated[key]
        job.progress = base + span


QUEUE = SeparationQueue()
