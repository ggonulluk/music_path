"""Sistem sesi kaydı (WASAPI loopback).

Hoparlöre giden sesi dosyaya yazar - YouTube, Spotify, ne calıyorsa.
Indirme degil, kayıt: ses kartının çıkışı dinleniyor.

WAV yaziyoruz, mp3 degil. Kayit gercek zamanli oldugu icin sikistirma
yapmak gereksiz islemci yuku olurdu; ayirma zaten wav'i dogrudan okuyor
ve sonuc stem'leri nasil olsa mp3'e yaziliyor.

ISTEGE BAGLI OZELLIK. PyAudioWPatch yoksa ya da loopback cihazi
bulunamazsa arayuz bunu soyler.
"""
from __future__ import annotations

import queue
import threading
from pathlib import Path

CHUNK = 2048


"""Cihaz bilgisi BIR KEZ sorgulanip onbellege aliniyor.

Onceden her /api/sources yoklamasinda yeni bir PyAudio ornegi acilip
kapaniyordu. Arayuz kayit sirasinda bu ucu 700 ms'de bir yokladigi icin,
bir thread PortAudio'yu sonlandirirken digerinde acik akis kaliyor ve
surec cokuyordu (segfault olculdu). Cihaz listesi zaten oturum boyunca
degismiyor.
"""
_probe: tuple[bool, str, dict | None] | None = None
_probe_lock = threading.Lock()


def _do_probe() -> tuple[bool, str, dict | None]:
    try:
        import pyaudiowpatch as pa
    except ImportError:
        return False, "PyAudioWPatch kurulu değil", None
    try:
        with pa.PyAudio() as p:
            wasapi = p.get_host_api_info_by_type(pa.paWASAPI)
            out = p.get_device_info_by_index(wasapi["defaultOutputDevice"])
            for d in p.get_loopback_device_info_generator():
                if out["name"] in d["name"]:
                    return True, "", dict(d)
        return False, "loopback cihazı bulunamadı", None
    except (OSError, AttributeError):
        return False, "WASAPI bulunamadı (Windows gerekiyor)", None


def _cached() -> tuple[bool, str, dict | None]:
    global _probe
    if _probe is None:
        with _probe_lock:
            if _probe is None:
                _probe = _do_probe()
    return _probe


def available() -> tuple[bool, str]:
    ok, why, _ = _cached()
    return ok, why


def loopback_device():
    return _cached()[2]


class Recorder:
    def __init__(self) -> None:
        self.state = "idle"        # idle | recording | done | error
        self.seconds = 0.0
        self.error = ""
        self.path: Path | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def as_dict(self) -> dict:
        d = {"state": self.state, "seconds": round(self.seconds, 1)}
        if self.error:
            d["error"] = self.error
        if self.path:
            d["file"] = self.path.name
        return d

    def start(self, dest: Path, name: str) -> dict:
        if self.state == "recording":
            return self.as_dict()
        ok, why = available()
        if not ok:
            self.state, self.error = "error", why
            return self.as_dict()
        dev = loopback_device()
        if not dev:
            self.state, self.error = "error", "loopback cihazı bulunamadı"
            return self.as_dict()

        dest.mkdir(parents=True, exist_ok=True)
        safe = "".join(c for c in name if c not in '\\/:*?"<>|').strip() or "kayit"
        path = dest / f"{safe}.wav"
        i = 2
        while path.exists():
            path = dest / f"{safe} ({i}).wav"
            i += 1

        self.state = "recording"
        self.seconds = 0.0
        self.error = ""
        self.path = path
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, args=(dev, path), daemon=True)
        self._thread.start()
        return self.as_dict()

    def stop(self) -> dict:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
        return self.as_dict()

    def _run(self, dev: dict, path: Path) -> None:
        """Geri cagirma kipiyle kayit.

        Bloke eden stream.read() KULLANILMIYOR: hicbir sey calmiyorken
        WASAPI loopback veri uretmiyor ve okuma sonsuza kadar asili
        kaliyordu - kullanici "durdur" dedigi halde thread cikmiyor,
        dosya kilitli kaliyordu. Geri cagirma kipinde sessizlik sadece
        "cagri gelmedi" demek; durdurma her zaman temiz calisiyor.

        Yan etki: sessiz gecen sureler dosyaya yazilmiyor, yani kayit
        fiilen ses ciktigi anda basliyor. Kullanim icin bu iyi - once
        kaydi baslatip sonra sarkiyi calabilirsin.
        """
        import numpy as np
        import pyaudiowpatch as pa
        import soundfile as sf

        rate = int(dev["defaultSampleRate"])
        ch = int(dev["maxInputChannels"])
        frames = 0

        # Geri cagirma SADECE kuyruga atiyor; dosyaya bu thread yaziyor.
        # PyAudio geri cagirmasi ayri bir C thread'inde kosuyor ve oradan
        # libsndfile'a yazmak sureci cokertiyordu (segfault olculdu).
        q: "queue.Queue[bytes]" = queue.Queue(maxsize=400)

        def cb(in_data, frame_count, time_info, status):
            if in_data:
                try:
                    q.put_nowait(in_data)
                except queue.Full:
                    pass          # disk yetisemiyorsa parcayi dusur, akisi bozma
            return (None, pa.paContinue)

        p = stream = None
        try:
            p = pa.PyAudio()
            stream = p.open(format=pa.paInt16, channels=ch, rate=rate,
                            frames_per_buffer=CHUNK, input=True,
                            input_device_index=dev["index"], stream_callback=cb)
            stream.start_stream()
            with sf.SoundFile(str(path), "w", samplerate=rate,
                              channels=ch, subtype="PCM_16") as f:
                # Durdurma bayragi HER dongude kontrol edilmeli. Once
                # sadece kuyruk bosaldiginda bakiliyordu; ses surekli
                # aktigi icin kuyruk hic bosalmiyor ve "durdur" ise
                # yaramiyordu.
                while not self._stop.is_set():
                    try:
                        data = q.get(timeout=0.2)
                    except queue.Empty:
                        continue
                    f.write(np.frombuffer(data, dtype=np.int16).reshape(-1, ch))
                    frames += len(data) // (2 * ch)
                    self.seconds = frames / rate

                # Kuyrukta kalanlari da yaz, sonun kirpilmasin
                while True:
                    try:
                        data = q.get_nowait()
                    except queue.Empty:
                        break
                    f.write(np.frombuffer(data, dtype=np.int16).reshape(-1, ch))
                    frames += len(data) // (2 * ch)
                self.seconds = frames / rate
            self.state = "done"
        except Exception as e:
            self.state = "error"
            self.error = str(e)[:300]
        finally:
            # Sirasi onemli: once akis dursun, sonra PyAudio kapansin
            if stream is not None:
                try:
                    stream.stop_stream()
                    stream.close()
                except Exception:
                    pass
            if p is not None:
                try:
                    p.terminate()
                except Exception:
                    pass


RECORDER = Recorder()
