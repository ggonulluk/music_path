"""Indirme ozelliginin dis parcalari: yt-dlp'yi guncel tutmak, ffmpeg'i bulmak.

YT-DLP NEDEN KENDINI GUNCELLIYOR
  Siteler ic yapilarini sik degistiriyor; pakete gomulu yt-dlp birkac ay
  sonra YouTube'da calismamaya baslar. Paketlenmis surumde pip yok, yt-dlp
  PYZ arsivinin icinde. Cozum: PyPI'daki resmi wheel'i (saf Python, sha256
  ozeti PyPI'dan dogrulanir) veri klasorundeki yt-dlp\\<surum>\\ altina acip
  importu oraya yonlendirmek - sys.meta_path'in basina YALNIZCA yt_dlp
  adlarini yakalayan bir bulucu. Gomulu surum yedek olarak kalir: indirilen
  yuklenemezse ona donulur, uygulama yeni surumle gelirse o kullanilir.

  Ne zaman bakiliyor:
    - acilista, son bakistan 24 saat gectiyse (arka planda)
    - bir indirme hatayla dusunce, hemen. Daha yeni surum varsa kurulur ve
      indirme bir kez tekrar denenir. Yeni surum yoksa maliyet tek bir
      kucuk JSON istegi; hatanin site mi ag mi kaynakli oldugunu tahmin
      etmeye gerek kalmiyor.
    - arayuzden elle

FFMPEG
  Paket ffmpeg'i exe'nin yanindaki ffmpeg\\ klasorunde getiriyor (LGPL
  derlemesi, bkz. THIRD-PARTY-NOTICES). Yoksa (gelistirme ortami, klasor
  silinmis) sistemdekine bakiliyor; o da yoksa ilk indirmede ayni LGPL
  derlemesi oraya indiriliyor. build.py de paketi ayni fonksiyonla
  hazirliyor, iki yol ayni ikiliyi getiriyor.
"""
from __future__ import annotations

import hashlib
import importlib
import importlib.abc
import importlib.machinery
import importlib.metadata
import json
import re
import shutil
import ssl
import sys
import threading
import time
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

from . import paths

YTDLP_ROOT = paths.data_dir() / "yt-dlp"
FFMPEG_DIR = paths.data_dir() / "ffmpeg"
STATE_FILE = YTDLP_ROOT / "state.json"
CHECK_EVERY = 24 * 3600

PYPI_URL = "https://pypi.org/pypi/yt-dlp/json"
FFMPEG_RELEASE = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest"
# Kararli dal, LGPL, paylasimli DLL'ler: GPL derlemesi pakete konamaz;
# paylasimli derleme statikten ~2 kat kucuk ve DLL'ler degistirilebilir.
FFMPEG_ASSET = re.compile(r"ffmpeg-n([\d.]+)-latest-win64-lgpl-shared-[\d.]+\.zip")
FFMPEG_SKIP = {"ffplay.exe"}          # oynatici; bize gerekmiyor (~19 MB)

FFMPEG_HINTS = [
    Path.home() / "AppData/Local/Microsoft/WinGet/Packages",
]


def vtuple(v: str | None) -> tuple[int, ...]:
    """'2026.08.19' ve '2026.8.19' ayni surum."""
    return tuple(int(x) for x in re.findall(r"\d+", v or ""))


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _open(url: str, timeout: float = 30):
    req = urllib.request.Request(url, headers={"User-Agent": "GgMix"})
    return urllib.request.urlopen(req, timeout=timeout, context=_ssl_context())


def _download(url: str, dest: Path, sha256: str, progress=None) -> None:
    h = hashlib.sha256()
    with _open(url, 60) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while chunk := r.read(1 << 16):
            f.write(chunk)
            h.update(chunk)
            done += len(chunk)
            if progress and total:
                progress(done / total)
    if h.hexdigest() != sha256.lower():
        dest.unlink(missing_ok=True)
        raise RuntimeError("indirilen dosyanın sha256 özeti tutmuyor")


def _safe_member(name: str) -> bool:
    p = PurePosixPath(name)
    return not p.is_absolute() and ".." not in p.parts


# --------------------------------------------------------------------- ffmpeg

def ffmpeg_path() -> str | None:
    """Once paketle gelen, sonra PATH, sonra bilinen kurulum yerleri."""
    if (FFMPEG_DIR / "ffmpeg.exe").is_file():
        return str(FFMPEG_DIR)
    found = shutil.which("ffmpeg")
    if found:
        return str(Path(found).parent)
    for base in FFMPEG_HINTS:
        if not base.is_dir():
            continue
        for exe in base.glob("**/ffmpeg.exe"):
            return str(exe.parent)
    return None


def install_ffmpeg(dest: Path = FFMPEG_DIR, progress=None) -> str:
    """BtbN'nin LGPL derlemesini indirip dest'e ac. Surum etiketini dondurur."""
    with _open(FFMPEG_RELEASE, 20) as r:
        assets = {a["name"]: a["browser_download_url"] for a in json.load(r)["assets"]}
    cands = sorted((vtuple(m.group(1)), n) for n in assets
                   if (m := FFMPEG_ASSET.fullmatch(n)))
    if not cands:
        raise RuntimeError("uygun ffmpeg derlemesi bulunamadı")
    name = cands[-1][1]
    with _open(assets["checksums.sha256"], 20) as r:
        sums = r.read().decode()
    sha = next((ln.split()[0] for ln in sums.splitlines()
                if ln.strip().endswith(name)), None)
    if not sha:
        raise RuntimeError(f"{name} için sha256 özeti yok")

    tmp = dest.with_name(dest.name + ".part")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    zpath = tmp / name
    _download(assets[name], zpath, sha, progress)
    with zipfile.ZipFile(zpath) as z:
        for m in z.namelist():
            p = PurePosixPath(m)
            if not _safe_member(m) or m.endswith("/"):
                continue
            keep = (len(p.parts) >= 3 and p.parts[-2] == "bin"
                    and p.suffix.lower() in (".exe", ".dll") and p.name not in FFMPEG_SKIP)
            if keep or p.name == "LICENSE.txt":
                (tmp / p.name).write_bytes(z.read(m))
    zpath.unlink()
    if not (tmp / "ffmpeg.exe").is_file() or not (tmp / "ffprobe.exe").is_file():
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError("arşivde ffmpeg.exe/ffprobe.exe yok")
    (tmp / "KAYNAK.txt").write_text(
        f"{name}\nhttps://github.com/BtbN/FFmpeg-Builds\n"
        "FFmpeg LGPL derlemesi. Kaynak kodu: https://ffmpeg.org/download.html\n",
        encoding="utf-8")
    shutil.rmtree(dest, ignore_errors=True)
    tmp.rename(dest)
    return name


# --------------------------------------------------------------------- yt-dlp

class _Override(importlib.abc.MetaPathFinder):
    """yt_dlp ve alt modullerini yalnizca verilen klasorden yukle."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def find_spec(self, name, path=None, target=None):
        if name == "yt_dlp":
            return importlib.machinery.PathFinder.find_spec(name, [str(self.root)])
        if name.startswith("yt_dlp."):
            spec = importlib.machinery.PathFinder.find_spec(name, path)
            if spec is None:
                # gomulu kopyadan uyumsuz bir modul karismasin
                raise ModuleNotFoundError(f"No module named {name!r}", name=name)
            return spec
        return None


def _purge_ytdlp() -> None:
    for n in [n for n in sys.modules if n == "yt_dlp" or n.startswith("yt_dlp.")]:
        del sys.modules[n]
    importlib.invalidate_caches()


def bundled_version() -> str | None:
    """Pakete gomulu surum (build.py --copy-metadata=yt-dlp ile tasiniyor)."""
    try:
        return importlib.metadata.version("yt-dlp")
    except importlib.metadata.PackageNotFoundError:
        return None


def _python_ok(spec: str | None) -> bool:
    m = re.search(r">=\s*([\d.]+)", spec or "")
    return not m or sys.version_info[:3] >= vtuple(m.group(1))


class YtDlpUpdater:
    """Hangi yt-dlp'nin yuklenecegine karar verir, guncellemeyi yapar.

    `lock` indirmeyle paylasiliyor: Fetcher bir indirme boyunca onu tutar,
    boylece modul degisimi asla calisan bir indirmenin altinda olmaz.
    """

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.state = "idle"            # idle | checking | updating | error
        self.message = ""
        self._finder: _Override | None = None
        self.st = self._load()
        self._activate_saved()

    # -- kalici durum
    def _load(self) -> dict:
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _save(self) -> None:
        try:
            YTDLP_ROOT.mkdir(parents=True, exist_ok=True)
            STATE_FILE.write_text(json.dumps(self.st, indent=1), encoding="utf-8")
        except OSError:
            pass

    # -- hangi kopya
    def _use(self, root: Path | None) -> None:
        if self._finder in sys.meta_path:
            sys.meta_path.remove(self._finder)
        self._finder = _Override(root) if root else None
        if self._finder:
            sys.meta_path.insert(0, self._finder)
        _purge_ytdlp()

    def _activate_saved(self) -> None:
        ver = self.st.get("active")
        if not ver:
            return
        root = YTDLP_ROOT / ver
        if not (root / "yt_dlp" / "__init__.py").is_file():
            return
        bundled = bundled_version()
        if bundled and vtuple(bundled) >= vtuple(ver):
            return                    # uygulama daha yenisiyle gelmis
        self._use(root)

    def version(self) -> str | None:
        try:
            import yt_dlp.version
            return yt_dlp.version.__version__
        except Exception:
            return None

    def as_dict(self) -> dict:
        return {
            "version": self.version(),
            "bundled": bundled_version(),
            "latest": self.st.get("latest"),
            "checked": self.st.get("checked"),
            "last_ok": self.st.get("last_ok"),
            "failures": self.st.get("failures", 0),
            "state": self.state,
            "message": self.message,
        }

    # -- basarim kaydi
    def record(self, ok: bool, error: str = "") -> None:
        if ok:
            self.st["last_ok"] = time.time()
            self.st["failures"] = 0
            self.st.pop("last_error", None)
        else:
            self.st["failures"] = self.st.get("failures", 0) + 1
            self.st["last_error"] = error[:300]
        self._save()

    # -- guncelleme
    def check(self, force: bool = False) -> bool:
        """Daha yeni surum varsa kur. Kurulduysa True."""
        with self.lock:
            if not force and time.time() - self.st.get("checked", 0) < CHECK_EVERY:
                return False
            self.state, self.message = "checking", ""
            try:
                with _open(PYPI_URL, 20) as r:
                    data = json.load(r)
                latest = data["info"]["version"]
                self.st["checked"] = time.time()
                self.st["latest"] = latest
                current = self.version()
                if current and vtuple(latest) <= vtuple(current):
                    self.state, self.message = "idle", ""
                    return False
                if not _python_ok(data["info"].get("requires_python")):
                    self.state = "idle"
                    self.message = f"yt-dlp {latest} bu sürümle uyumsuz"
                    return False
                whl = next(u for u in data["urls"]
                           if u["packagetype"] == "bdist_wheel"
                           and u["filename"].endswith("-py3-none-any.whl"))
                self.state = "updating"
                self._install(latest, whl["url"], whl["digests"]["sha256"])
                self.state, self.message = "idle", f"yt-dlp {latest} sürümüne güncellendi"
                return True
            except Exception as e:
                self.state, self.message = "error", f"güncelleme başarısız: {e}"[:200]
                return False
            finally:
                self._save()

    def check_async(self, force: bool = False) -> None:
        if force:
            # arayuz dugmeye basar basmaz "kontrol ediliyor" gorsun
            self.state, self.message = "checking", ""
        threading.Thread(target=self.check, args=(force,), daemon=True).start()

    def _install(self, ver: str, url: str, sha256: str) -> None:
        YTDLP_ROOT.mkdir(parents=True, exist_ok=True)
        tmp = YTDLP_ROOT / f"{ver}.part"
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir()
        whl = tmp / "yt_dlp.whl"
        _download(url, whl, sha256)
        with zipfile.ZipFile(whl) as z:
            members = [m for m in z.namelist()
                       if m.startswith("yt_dlp/") and _safe_member(m)]
            z.extractall(tmp, members)
        whl.unlink()
        dest = YTDLP_ROOT / ver
        shutil.rmtree(dest, ignore_errors=True)
        tmp.rename(dest)

        prev = self._finder.root if self._finder else None
        self._use(dest)
        got = self.version()
        if vtuple(got) != vtuple(ver):
            self._use(prev)
            shutil.rmtree(dest, ignore_errors=True)
            raise RuntimeError(f"yeni sürüm yüklenemedi ({got})")
        self.st["active"] = ver
        for old in YTDLP_ROOT.iterdir():
            if old.is_dir() and old.name != ver:
                shutil.rmtree(old, ignore_errors=True)


YTDLP = YtDlpUpdater()
