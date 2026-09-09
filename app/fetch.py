"""Bağlantıdan ses indirme (yt-dlp).

ISTEGE BAGLI OZELLIK. yt-dlp ya da ffmpeg yoksa arayuz bunu soyler,
uygulamanin geri kalani calismaya devam eder - nota cikarma ozelliginde
oldugu gibi.

MP3'E CEVIRIYORUZ, indirilen formati oldugu gibi birakmiyoruz. Sebep:
ayirma motoru sesi `sphn` ile okuyor ve sphn m4a/webm/opus cozemiyor
(olculdu). demucs ffmpeg'e dusuyor ama paketlenmis surumde ffmpeg
bulunmuyor. Indirme sirasinda cevirince ffmpeg yalnizca BU ozellik icin
gerekli oluyor, cekirdek boru hatti ona bagimli kalmiyor.

BAKIM NOTU: yt-dlp sik guncelleme ister cunku siteler ic yapilarini
degistiriyor. Paketlenmis surumde gomulu kalan bir yt-dlp birkac ay
sonra calismayabilir; kullanicinin guncellemesi gerekir.
"""
from __future__ import annotations

import re
import shutil
import threading
import time
from pathlib import Path

FFMPEG_HINTS = [
    Path.home() / "AppData/Local/Microsoft/WinGet/Packages",
]


def ffmpeg_path() -> str | None:
    """PATH'te yoksa bilinen kurulum yerlerine bak."""
    found = shutil.which("ffmpeg")
    if found:
        return str(Path(found).parent)
    for base in FFMPEG_HINTS:
        if not base.is_dir():
            continue
        for exe in base.glob("**/ffmpeg.exe"):
            return str(exe.parent)
    return None


def available() -> tuple[bool, str]:
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        return False, "yt-dlp kurulu değil"
    if not ffmpeg_path():
        return False, "ffmpeg bulunamadı (ses dönüşümü için gerekli)"
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
        self.path: Path | None = None
        self._lock = threading.Lock()

    def as_dict(self) -> dict:
        d = {"state": self.state, "progress": round(self.pct, 3), "title": self.title}
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
            self.path = None
        threading.Thread(target=self._run, args=(url, dest), daemon=True).start()
        return self.as_dict()

    def _run(self, url: str, dest: Path) -> None:
        try:
            import yt_dlp
        except ImportError:
            self.state, self.error = "error", "yt-dlp kurulu değil"
            return
        ff = ffmpeg_path()
        if not ff:
            self.state, self.error = "error", "ffmpeg bulunamadı"
            return

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
            "noplaylist": True,
            "progress_hooks": [hook],
        }
        try:
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
            self.pct = 1.0
            self.state = "done"
        except Exception as e:
            self.state = "error"
            self.error = str(e)[:300]


FETCHER = Fetcher()
