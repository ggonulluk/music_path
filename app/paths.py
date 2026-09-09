"""Yol cozumu: gelistirme ve PyInstaller paketi icin ortak.

Iki farkli kok var ve karistirilmamali:

  bundle_dir()  salt okunur paket icerigi - statik dosyalar, Demucs modelleri.
                Pakette bu, exe'nin yanindaki _internal klasoru.
  data_dir()    kullanici verisi - songs/, stems/. YAZILABILIR olmali.
                Pakette exe'nin bulundugu klasor.

Gelistirmede ikisi de proje kokunu gosterir, yani davranis degismez.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))


def bundle_dir() -> Path:
    if FROZEN:
        # PyInstaller onedir: _MEIPASS = exe'nin yanindaki _internal
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    if FROZEN:
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def setup_model_cache() -> Path | None:
    """Gomulu Demucs modellerini kullan ve agi tamamen kapat.

    Paket icinde model varsa HuggingFace'i o klasore yonlendirip cevrimdisi
    moda aliyoruz. Boylece internetsiz makinede de calisir - "kurdugum her
    bilgisayarda calissin" hedefinin sarti bu.

    demucs'u iceri almadan ONCE cagrilmali; huggingface_hub bu degiskenleri
    import aninda okuyor.
    """
    cache = bundle_dir() / "models"
    if not (cache / "hub").is_dir():
        return None                      # gelistirme ortami: normal indirme
    os.environ["HF_HOME"] = str(cache)
    os.environ["HF_HUB_CACHE"] = str(cache / "hub")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    return cache
