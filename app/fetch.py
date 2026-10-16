"""Bağlantıdan ses indirme (yt-dlp).

ISTEGE BAGLI OZELLIK. yt-dlp yoksa arayuz bunu soyler, uygulamanin geri
kalani calismaya devam eder - nota cikarma ozelliginde oldugu gibi.

MP3'E CEVIRIYORUZ, indirilen formati oldugu gibi birakmiyoruz. Sebep:
ayirma motoru sesi `sphn` ile okuyor ve sphn m4a/webm/opus cozemiyor
(olculdu). Cevirme ffmpeg ile; paket onu ffmpeg/ klasorunde getiriyor,
yoksa ilk indirmede indiriliyor (app/updater.py). Cekirdek boru hatti
ffmpeg'e bagimli degil, yalnizca BU ozellik.

BAKIM: yt-dlp sik guncelleme ister cunku siteler ic yapilarini
degistiriyor. app/updater.py gunde bir kez ve her basarisiz indirmeden
sonra PyPI'a bakip yeni surumu veri klasorune kuruyor; basarisiz indirme
yeni surumle bir kez tekrar deneniyor.
"""
from __future__ import annotations

import re
import threading
import time
from pathlib import Path

from . import updater
from .updater import ffmpeg_path


def available() -> tuple[bool, str]:
    if not updater.YTDLP.version():
        return False, "yt-dlp kurulu değil"
    return True, ""


def safe_name(s: str) -> str:
    s = re.sub(r'[\\/:*?"<>|]', "_", s or "").strip()
    return (s[:120] or "indirilen").rstrip(". ")


class Fetcher:
    """Tek seferde tek indirme. Durum arayuze yoklamayla veriliyor.

    Ayirma kuyruguna BILEREK katilmiyor: indirme ag islemi, uzun suren
    bir ayirmanin arkasinda beklemesi anlamsiz olurdu.
    """

    def __init__(self) -> None:
        self.state = "idle"        # idle | running | done | error
        self.pct = 0.0
        self.title = ""
        self.error = ""
        self.note = ""             # "ffmpeg indiriliyor" gibi ara adimlar
        self.path: Path | None = None
        self._lock = threading.Lock()

    def as_dict(self) -> dict:
        d = {"state": self.state, "progress": round(self.pct, 3), "title": self.title}
        if self.note:
            d["note"] = self.note
        if self.error:
            d["error"] = self.error
        if self.path:
            d["file"] = self.path.name
        return d

    def start(self, url: str, dest: Path) -> dict:
        with self._lock:
            if self.state == "running":
                return self.as_dict()
            self.state = "running"
            self.pct = 0.0
            self.title = ""
            self.error = ""
            self.note = ""
            self.path = None
        threading.Thread(target=self._run, args=(url, dest), daemon=True).start()
        return self.as_dict()

    def _run(self, url: str, dest: Path) -> None:
        # Indirme boyunca kilit: guncelleme modulu calisan indirmenin
        # altinda degistiremez
        with updater.YTDLP.lock:
            try:
                ff = ffmpeg_path()
                if not ff:
                    self.note = "ffmpeg indiriliyor (bir kerelik)"
                    updater.install_ffmpeg(progress=lambda p: setattr(self, "pct", p))
                    ff = ffmpeg_path()
                    if not ff:
                        raise RuntimeError("ffmpeg kurulamadı")
                self.pct, self.note = 0.0, ""
                try:
                    self._download(url, dest, ff)
                except Exception as e:
                    updater.YTDLP.record(False, str(e))
                    # Yeni surum varsa kur ve bir kez daha dene
                    self.note = "yt-dlp güncellemesi aranıyor"
                    if not updater.YTDLP.check(force=True):
                        raise
                    self.pct, self.note = 0.0, updater.YTDLP.message + ", yeniden deneniyor"
                    self._download(url, dest, ff)
                updater.YTDLP.record(True)
                self.pct, self.note = 1.0, ""
                self.state = "done"
            except Exception as e:
                self.state = "error"
                self.note = ""
                self.error = str(e)[:300]

    def _download(self, url: str, dest: Path, ff: str) -> None:
        import yt_dlp          # her seferinde: guncelleme sonrasi yeni kopya

        dest.mkdir(parents=True, exist_ok=True)
        before = {p.name for p in dest.iterdir() if p.is_file()}

        def hook(d):
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                if total:
                    self.pct = min(0.9, d.get("downloaded_bytes", 0) / total * 0.9)
            elif d.get("status") == "finished":
                self.pct = 0.92          # kalan: mp3'e cevirme

        opts = {
            "format": "bestaudio/best",
            "outtmpl": str(dest / "%(title)s.%(ext)s"),
            "ffmpeg_location": ff,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,      # ilerleme progress_hooks'tan; GgMix.log'u doldurmasin
            "noplaylist": True,
            "progress_hooks": [hook],
        }
        with yt_dlp.YoutubeDL(opts) as y:
            info = y.extract_info(url, download=True)
        self.title = info.get("title", "")
        # yt-dlp'nin son dosya adini guvenilir sekilde vermiyor; klasoru
        # once/sonra karsilastirmak daha saglam
        time.sleep(0.2)
        new = [p for p in dest.iterdir() if p.is_file() and p.name not in before]
        mp3 = [p for p in new if p.suffix.lower() == ".mp3"]
        self.path = (mp3 or new or [None])[0]
        if not self.path:
            raise RuntimeError("indirilen dosya bulunamadı")


FETCHER = Fetcher()
