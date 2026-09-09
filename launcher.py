"""GgMix baslatici.

Paketlenmis surumun giris noktasi. Gelistirmede de calisir:
    .venv\\Scripts\\python.exe launcher.py

Yaptiklari:
  - Gomulu Demucs modellerini kullanacak sekilde ortami hazirlar (cevrimdisi)
  - Uygulama zaten calisiyorsa ikinci sunucu baslatmaz, sadece sekmeyi acar
  - Port gercekten dinlemeye baslayinca tarayiciyi acar (kor bekleme yok)
"""
from __future__ import annotations

import json
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser

# demucs/huggingface_hub ICE AKTARILMADAN ONCE olmali: bu kutuphaneler
# ortam degiskenlerini import aninda okuyor
from app.paths import data_dir, setup_model_cache

HOST = "127.0.0.1"
FIRST_PORT = 8000
PORT_TRIES = 10


def is_our_server(port: int, timeout: float = 0.6) -> bool:
    """Bu portta bizim sunucumuz mu var, baska bir uygulama mi?

    Sadece "port dolu" bakmak yetmez - baska bir program 8000'i tutuyorsa
    kullaniciyi alakasiz bir sayfaya goturmus oluruz.
    """
    try:
        with urllib.request.urlopen(
                f"http://{HOST}:{port}/api/health", timeout=timeout) as r:
            return bool(json.loads(r.read()).get("ok"))
    except (urllib.error.URLError, OSError, ValueError):
        return False


def port_free(port: int) -> bool:
    with socket.socket() as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((HOST, port))
            return True
        except OSError:
            return False


def pick_port() -> tuple[int, bool]:
    """(port, zaten_calisiyor) dondurur."""
    for i in range(PORT_TRIES):
        port = FIRST_PORT + i
        if is_our_server(port):
            return port, True
        if port_free(port):
            return port, False
    raise SystemExit(f"{FIRST_PORT}-{FIRST_PORT + PORT_TRIES - 1} portlarinin "
                     "hepsi dolu.")


def open_when_ready(url: str, port: int) -> None:
    for _ in range(240):                 # en fazla 60 sn
        if is_our_server(port, timeout=0.3):
            webbrowser.open(url)
            return
        time.sleep(0.25)


def main() -> None:
    cache = setup_model_cache()
    port, running = pick_port()
    url = f"http://{HOST}:{port}"

    print()
    print("  GgMix")
    print(f"  veri klasoru : {data_dir()}")
    print(f"  modeller     : {'gomulu (cevrimdisi)' if cache else 'HuggingFace onbellegi'}")
    print(f"  adres        : {url}")

    if running:
        print("\n  Uygulama zaten calisiyor - tarayici aciliyor.\n")
        webbrowser.open(url)
        return

    print("  kapatmak icin: Ctrl+C\n")
    threading.Thread(target=open_when_ready, args=(url, port), daemon=True).start()

    import uvicorn
    from app.main import app

    for d in ("songs", "stems"):
        (data_dir() / d).mkdir(parents=True, exist_ok=True)

    try:
        uvicorn.run(app, host=HOST, port=port, log_level="warning")
    except KeyboardInterrupt:
        pass
    print("\n  kapatildi.")


if __name__ == "__main__":
    sys.exit(main())
