"""Kutuphane bakimi: disk kullanimi, silme, oksuz kanal temizligi.

Silme islemleri geri donusum kutusunu kullanir (send2trash). Yanlis tiklama
kurtarilabilir olsun diye; yuzlerce sarkilik bir kutuphanede kalici silme
fazla riskli.
"""
from __future__ import annotations

import os
from pathlib import Path

from send2trash import send2trash

STEM_FILES = ("gitar", "vokal", "davul", "bas", "piyano", "diger")


def scan_stem_dir(folder: Path) -> tuple[set[str], int]:
    """Klasordeki dosya adlari + toplam boyut, TEK dizin okumasiyla.

    Onceden kanal/analiz/nota varligi 14 ayri exists() ile bakiliyordu;
    Windows'ta her biri ayri cekirdek cagrisi. scandir hepsini bir okumada
    verir ve boyutu da bedavaya getirir - disk gostergesi bu sayede
    ek maliyet olmadan eklenebildi.
    """
    names: set[str] = set()
    total = 0
    try:
        with os.scandir(folder) as it:
            for e in it:
                names.add(e.name)
                if e.is_file(follow_symlinks=False):
                    try:
                        total += e.stat(follow_symlinks=False).st_size
                    except OSError:
                        pass
    except (FileNotFoundError, NotADirectoryError, PermissionError):
        pass
    return names, total


def dir_size(folder: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(folder):
        for f in files:
            try:
                total += (Path(root) / f).stat().st_size
            except OSError:
                pass
    return total


def find_orphans(songs_dir: Path, stems_dir: Path) -> list[dict]:
    """songs/'ta karsiligi kalmamis stems/ klasorleri.

    Eslesme dosya ADINDAN (uzantisiz) kuruluyor - stem klasoru boyle
    adlandiriliyor. Yani sarki yeniden adlandirilirsa kanallari oksuz kalir.
    """
    if not stems_dir.is_dir():
        return []
    live = {p.stem for p in songs_dir.iterdir() if p.is_file()} if songs_dir.is_dir() else set()
    out = []
    for d in sorted(stems_dir.iterdir()):
        if d.is_dir() and d.name not in live:
            out.append({"name": d.name, "bytes": dir_size(d)})
    return out


def trash(path: Path) -> bool:
    """Geri donusum kutusuna gonder. Yoksa sessizce False."""
    if not path.exists():
        return False
    send2trash(str(path))
    return True
