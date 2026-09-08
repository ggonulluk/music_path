"""Yerel stem player sunucusu.

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

from . import analysis, transcribe
from .separator import QUEUE, SONGS, STEMS, STEM_ORDER

AUDIO_EXT = {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".opus", ".aac", ".wma"}
STATIC = Path(__file__).resolve().parent / "static"

app = FastAPI(title="Stem Player")


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
            title = (tags.get("title") or [title])[0]
            artist = (tags.get("artist") or [None])[0]
    except Exception:
        pass

    out = {"title": title, "artist": artist, "duration": duration}
    if stamp:
        _meta_cache[key] = (stamp, out)
    return out


def describe(sid: str, path: Path, can_tr: bool | None = None) -> dict:
    # can_tr istek basina bir kez hesaplanip gecilir; sarkiya bagli degil
    # (sadece .venv-transcribe ve bp_worker.py varligina bakiyor)
    if can_tr is None:
        can_tr = transcribe.available()
    out = STEMS / path.stem
    available = [s for s in STEM_ORDER if (out / f"{s}.mp3").exists()]
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
        "analysis": analysis.cache_path(out).exists(),
        "notes": [s for s in transcribe.TRANSCRIBABLE
                  if transcribe.json_path(out, s).exists()],
        "can_transcribe": can_tr,
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
