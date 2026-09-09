"""GgMix sunucusu - sarkilari enstruman kanallarina ayiran yerel arac.

Tamamen lokal calisir (127.0.0.1). Disariya hicbir istek gitmez,
muzik dosyalari hicbir yere yuklenmez.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from mutagen import File as MutagenFile

from . import analysis, fetch, library, paths, record, transcribe
from .separator import QUEUE, SONGS, STEMS, STEM_ORDER

AUDIO_EXT = {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".opus", ".aac", ".wma"}
STATIC = paths.bundle_dir() / "app" / "static"

app = FastAPI(title="GgMix")


# --------------------------------------------------------------------- model

def song_id(path: Path) -> str:
    return hashlib.sha1(path.name.encode("utf-8")).hexdigest()[:12]


def scan() -> dict[str, Path]:
    SONGS.mkdir(exist_ok=True)
    return {
        song_id(p): p
        for p in sorted(SONGS.iterdir())
        if p.is_file() and p.suffix.lower() in AUDIO_EXT
    }


# Etiket ayristirma sarki basina ~12 ms ve /api/songs maliyetinin %93'u.
# (mtime, boyut) anahtarli onbellek: dosya degisirse damga tutmaz ve
# kendiliginden tazelenir, elle gecersiz kilmaya gerek yok.
_meta_cache: dict[str, tuple] = {}


# ID3v1 etiketleri kodlama bilgisi tasimaz; mutagen latin-1 varsayiyor.
# Turkce etiketler genelde Windows-1254 ile yazildigi icin "BİR" -> "BÝR"
# gibi bozuluyor. Asagidaki harfler latin-1'de Izlandaca'ya ait ve Turkce
# bir baslikta gercekten gecme ihtimali yok; varlarsa yanlis cozulmus
# demektir ve cp1254 ile yeniden cozuyoruz.
_CP1254_HINTS = set("ÐÝÞðýþ")


def _fix_encoding(s: str | None) -> str | None:
    if not s or not (_CP1254_HINTS & set(s)):
        return s
    try:
        return s.encode("latin-1").decode("cp1254")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def metadata(path: Path) -> dict:
    key = str(path)
    try:
        st = path.stat()
        stamp = (st.st_mtime_ns, st.st_size)
    except OSError:
        stamp = None

    hit = _meta_cache.get(key)
    if hit and stamp and hit[0] == stamp:
        return hit[1]

    title, artist, duration = path.stem, None, None
    try:
        tags = MutagenFile(path, easy=True)
        if tags is not None:
            if tags.info is not None:
                duration = round(float(tags.info.length), 2)
            title = _fix_encoding((tags.get("title") or [title])[0])
            artist = _fix_encoding((tags.get("artist") or [None])[0])
    except Exception:
        pass

    out = {"title": title, "artist": artist, "duration": duration,
           "src_bytes": stamp[1] if stamp else 0,
           "mtime": stamp[0] / 1e9 if stamp else 0}
    if stamp:
        _meta_cache[key] = (stamp, out)
    return out


def describe(sid: str, path: Path, can_tr: bool | None = None) -> dict:
    # can_tr istek basina bir kez hesaplanip gecilir; sarkiya bagli degil
    # (sadece .venv-transcribe ve bp_worker.py varligina bakiyor)
    if can_tr is None:
        can_tr = transcribe.available()
    out = STEMS / path.stem
    # Kanal/analiz/nota varligi ve klasor boyutu TEK dizin okumasiyla.
    # Onceden 14 ayri exists() cagrisiydi; scandir hem daha ucuz hem de
    # disk gostergesi icin gereken boyutu ek maliyetsiz veriyor.
    names, stem_bytes = library.scan_stem_dir(out)
    available = [s for s in STEM_ORDER if f"{s}.mp3" in names]
    job = QUEUE.get(sid, "separate")

    if len(available) == len(STEM_ORDER):
        state = "ready"
    elif job and job.state in ("queued", "running"):
        state = job.state
    elif job and job.state == "error":
        state = "error"
    else:
        state = "raw"

    info = {
        "id": sid,
        "file": path.name,
        "state": state,
        "stems": available,
        "analysis": analysis.cache_path(out).name in names,
        "notes": [s for s in transcribe.TRANSCRIBABLE
                  if transcribe.json_path(out, s).name in names],
        "can_transcribe": can_tr,
        "stem_bytes": stem_bytes,
        **metadata(path),
    }
    if job:
        info["job"] = job.as_dict()
    ajob = QUEUE.get(sid, "analyze")
    if ajob:
        info["analysis_job"] = ajob.as_dict()
    return info


# ---------------------------------------------------------------------- api

@app.get("/api/songs")
def list_songs():
    can_tr = transcribe.available()
    return [describe(sid, p, can_tr) for sid, p in scan().items()]


@app.get("/api/songs/{sid}")
def get_song(sid: str):
    lib = scan()
    if sid not in lib:
        raise HTTPException(404, "sarki bulunamadi")
    return describe(sid, lib[sid])


@app.post("/api/songs/{sid}/separate")
def separate(sid: str, mode: str = "hybrid"):
    lib = scan()
    if sid not in lib:
        raise HTTPException(404, "sarki bulunamadi")
    if mode not in ("fast", "hybrid"):
        raise HTTPException(400, "mode 'fast' veya 'hybrid' olmali")
    src = lib[sid]
    job = QUEUE.submit(sid, src, STEMS / src.stem, mode=mode)
    return job.as_dict()


@app.get("/api/songs/{sid}/analysis")
def get_analysis(sid: str):
    """Onbellekteki analizi dondur.

    202 = henuz yok ya da hesaplaniyor; istemci POST /analyze ile
    tetikleyip bu ucu yoklamaya devam eder.
    """
    lib = scan()
    if sid not in lib:
        raise HTTPException(404, "sarki bulunamadi")
    folder = STEMS / lib[sid].stem
    cached = analysis.load_cached(folder)
    if cached:
        return cached
    job = QUEUE.get(sid, "analyze")
    return JSONResponse(
        {"pending": True, "job": job.as_dict() if job else None}, status_code=202)


@app.post("/api/songs/{sid}/analyze")
def start_analysis(sid: str):
    lib = scan()
    if sid not in lib:
        raise HTTPException(404, "sarki bulunamadi")
    folder = STEMS / lib[sid].stem
    if not (folder / "gitar.mp3").exists():
        raise HTTPException(409, "once kanallara ayrilmali")
    return QUEUE.submit(sid, lib[sid], folder, kind="analyze").as_dict()


@app.get("/api/songs/{sid}/notes/{stem}")
def get_notes(sid: str, stem: str):
    """Onbellekteki nota dizisi. 202 = yok ya da hesaplaniyor."""
    lib = scan()
    if sid not in lib:
        raise HTTPException(404, "sarki bulunamadi")
    if stem not in transcribe.TRANSCRIBABLE:
        raise HTTPException(400, f"bu kanal icin nota cikarilmaz: {stem}")
    folder = STEMS / lib[sid].stem
    cached = transcribe.load_cached(folder, stem)
    if cached:
        return transcribe.enrich(cached)
    job = QUEUE.get(sid, "transcribe", stem)
    return JSONResponse(
        {"pending": True, "available": transcribe.available(),
         "job": job.as_dict() if job else None}, status_code=202)


@app.post("/api/songs/{sid}/transcribe")
def start_transcribe(sid: str, stem: str = "gitar"):
    lib = scan()
    if sid not in lib:
        raise HTTPException(404, "sarki bulunamadi")
    if stem not in transcribe.TRANSCRIBABLE:
        raise HTTPException(400, f"bu kanal icin nota cikarilmaz: {stem}")
    if not transcribe.available():
        raise HTTPException(503, ".venv-transcribe kurulu degil")
    folder = STEMS / lib[sid].stem
    if not (folder / f"{stem}.mp3").exists():
        raise HTTPException(409, "once kanallara ayrilmali")
    return QUEUE.submit(sid, lib[sid], folder, kind="transcribe", stem=stem).as_dict()


@app.get("/api/songs/{sid}/midi/{stem}")
def get_midi(sid: str, stem: str):
    lib = scan()
    if sid not in lib:
        raise HTTPException(404, "sarki bulunamadi")
    path = transcribe.midi_path(STEMS / lib[sid].stem, stem)
    if not path.exists():
        raise HTTPException(404, "MIDI henuz uretilmedi")
    return FileResponse(path, media_type="audio/midi",
                        filename=f"{lib[sid].stem} - {stem}.mid")


@app.delete("/api/songs/{sid}")
def delete_song(sid: str, scope: str = "stems"):
    """Kanallari ya da sarkinin tamamini geri donusum kutusuna gonder.

    scope=stems  kanallar silinir, kaynak mp3 kalir (yeniden ayirilabilir)
    scope=all    kaynak dosya da silinir
    """
    if scope not in ("stems", "all"):
        raise HTTPException(400, "scope 'stems' veya 'all' olmali")
    lib = scan()
    if sid not in lib:
        raise HTTPException(404, "sarki bulunamadi")

    # Calisan/sirada bekleyen is varken silmek isciyi yarida birakir
    for kind in ("separate", "analyze"):
        j = QUEUE.get(sid, kind)
        if j and j.state in ("queued", "running"):
            raise HTTPException(409, "bu sarki uzerinde is calisiyor, once bitmeli")

    src = lib[sid]
    removed, freed = [], 0
    folder = STEMS / src.stem
    if folder.is_dir():
        freed += library.dir_size(folder)
        if library.trash(folder):
            removed.append(f"stems/{src.stem}")
    if scope == "all":
        try:
            freed += src.stat().st_size
        except OSError:
            pass
        if library.trash(src):
            removed.append(f"songs/{src.name}")
        _meta_cache.pop(str(src), None)

    return {"removed": removed, "freed_bytes": freed, "scope": scope}


@app.get("/api/library/orphans")
def list_orphans():
    """songs/'ta karsiligi kalmamis kanal klasorleri (kuru calistirma)."""
    items = library.find_orphans(SONGS, STEMS)
    return {"items": items, "total_bytes": sum(i["bytes"] for i in items)}


@app.delete("/api/library/orphans")
def delete_orphans():
    items = library.find_orphans(SONGS, STEMS)
    removed, freed = [], 0
    for it in items:
        if library.trash(STEMS / it["name"]):
            removed.append(it["name"])
            freed += it["bytes"]
    return {"removed": removed, "freed_bytes": freed}


@app.get("/api/sources")
def sources():
    """Bağlantıdan indirme ve sistem sesi kaydı kullanılabilir mi."""
    f_ok, f_why = fetch.available()
    r_ok, r_why = record.available()
    dev = record.loopback_device() if r_ok else None
    return {
        "fetch": {"available": f_ok, "reason": f_why, **fetch.FETCHER.as_dict()},
        "record": {"available": r_ok, "reason": r_why,
                   "device": dev["name"] if dev else None,
                   **record.RECORDER.as_dict()},
    }


@app.post("/api/fetch")
def start_fetch(url: str):
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "gecerli bir baglanti degil")
    ok, why = fetch.available()
    if not ok:
        raise HTTPException(503, why)
    return fetch.FETCHER.start(url, SONGS)


@app.post("/api/record/start")
def record_start(name: str = ""):
    from datetime import datetime
    ok, why = record.available()
    if not ok:
        raise HTTPException(503, why)
    label = name.strip() or f"Kayıt {datetime.now():%Y-%m-%d %H.%M}"
    return record.RECORDER.start(SONGS, label)


@app.post("/api/record/stop")
def record_stop():
    return record.RECORDER.stop()


@app.get("/api/jobs")
def jobs():
    return QUEUE.all()


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    name = Path(file.filename or "").name
    if not name or Path(name).suffix.lower() not in AUDIO_EXT:
        raise HTTPException(400, "desteklenmeyen dosya turu")
    SONGS.mkdir(exist_ok=True)
    dest = SONGS / name
    if dest.exists():
        return JSONResponse({"id": song_id(dest), "existing": True})
    with dest.open("wb") as fh:
        while chunk := await file.read(1 << 20):
            fh.write(chunk)
    return {"id": song_id(dest), "existing": False}


@app.get("/audio/{sid}/{stem}")
def audio(sid: str, stem: str):
    lib = scan()
    if sid not in lib:
        raise HTTPException(404, "sarki bulunamadi")
    if stem not in STEM_ORDER:
        raise HTTPException(404, "gecersiz kanal")
    path = STEMS / lib[sid].stem / f"{stem}.mp3"
    if not path.exists():
        raise HTTPException(404, "kanal henuz uretilmedi")
    return FileResponse(path, media_type="audio/mpeg")


@app.get("/api/health")
def health():
    return {"ok": True, "songs": len(scan())}


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
