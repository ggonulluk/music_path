"""Yerel stem player sunucusu.

Tamamen lokal calisir (127.0.0.1). Disariya hicbir istek gitmez,
muzik dosyalari hicbir yere yuklenmez.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from mutagen import File as MutagenFile

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


def metadata(path: Path) -> dict:
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
    return {"title": title, "artist": artist, "duration": duration}


def describe(sid: str, path: Path) -> dict:
    out = STEMS / path.stem
    available = [s for s in STEM_ORDER if (out / f"{s}.mp3").exists()]
    job = QUEUE.get(sid)

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
        **metadata(path),
    }
    if job:
        info["job"] = job.as_dict()
    return info


# ---------------------------------------------------------------------- api

@app.get("/api/songs")
def list_songs():
    return [describe(sid, p) for sid, p in scan().items()]


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
