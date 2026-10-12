"""GgMix baslatici.

Paketlenmis surumun giris noktasi. Gelistirmede de calisir:
    .venv\\Scripts\\python.exe launcher.py

Yaptiklari:
  - Gomulu Demucs modellerini kullanacak sekilde ortami hazirlar (cevrimdisi)
  - Uygulama zaten calisiyorsa ikinci sunucu baslatmaz, sadece sekmeyi acar
  - Port gercekten dinlemeye baslayinca tarayiciyi acar (kor bekleme yok)
  - Konsol penceresi yerine sistem tepsisinde ikon: ipucunda o anki is ve
    ilerlemesi, is bitince bildirim, sag tikta Ac / Klasor / Cikis
"""
from __future__ import annotations

import json
import os
import signal
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser

# demucs/huggingface_hub ICE AKTARILMADAN ONCE olmali: bu kutuphaneler
# ortam degiskenlerini import aninda okuyor
from app.paths import bundle_dir, data_dir, setup_model_cache

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


def setup_log():
    """Konsolsuz pakette sys.stdout/stderr None; uvicorn, tqdm ve
    basic-pitch yazmaya calisinca cokuyor. Ikisini de veri klasorundeki
    GgMix.log'a bagla - konsol yokken hata ayiklamanin tek kaynagi bu."""
    if sys.stdout is not None and sys.stderr is not None:
        return None
    log = data_dir() / "GgMix.log"
    fh = open(log, "w", encoding="utf-8", buffering=1, errors="replace")
    sys.stdout = sys.stderr = fh
    return log


# Bildirim metinleri: (baslik, govde sablonu)
DONE = {
    "separate": ("Kanallar hazır", "{song}"),
    "transcribe": ("Notalar çıkarıldı", "{song} · {stem}"),
}
KIND = {"separate": "ayrılıyor", "analyze": "analiz", "transcribe": "nota çıkarma"}


def make_poll(queue, url: str, server_thread: threading.Thread, tray_ref: list):
    """Tepsinin saniyelik sorgusu: (ipucu, balon ya da None)."""
    seen: dict[str, str] = {}

    def poll():
        if not server_thread.is_alive() and tray_ref:
            # Sunucu acilamadi (port yarisi vb.) - sessizce tepside kalmasin
            from app.tray import message_box
            message_box("Sunucu durdu. Ayrıntı: GgMix.log")
            tray_ref[0].close()
            return "", None

        jobs = queue.all()
        running = [j for j in jobs.values() if j["state"] == "running"]
        queued = sum(j["state"] == "queued" for j in jobs.values())
        if running:
            j = running[0]
            what = j["stage"] or KIND.get(j["kind"], j["kind"])
            tip = f"GgMix · {j['song']}\n{what} %{round(j['progress'] * 100)}"
            if queued:
                tip += f" (+{queued} sırada)"
        else:
            tip = f"GgMix · hazır\n{url}"

        note = None
        for key, j in jobs.items():
            prev, seen[key] = seen.get(key), j["state"]
            # Sadece bizim izlerken biten isler; acilista eski "done" kayitlari
            # icin bildirim yagmasin
            if note or prev not in ("queued", "running"):
                continue
            if j["state"] == "done" and j["kind"] in DONE:
                title, body = DONE[j["kind"]]
                note = (title, body.format(**j), False)
            elif j["state"] == "error":
                note = ("İşlem başarısız", f"{j['song']}: {j.get('error', '')}", True)
        return tip, note

    return poll


def run(log) -> None:
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

    print("  kapatmak icin: tepsi ikonu > Cikis (ya da Ctrl+C)\n")
    threading.Thread(target=open_when_ready, args=(url, port), daemon=True).start()

    import uvicorn
    from app.main import app
    from app.separator import QUEUE
    from app.tray import Tray

    for d in ("songs", "stems"):
        (data_dir() / d).mkdir(parents=True, exist_ok=True)

    # Sunucu yan thread'de, tepsi ana thread'de: Win32 mesaj dongusu
    # pencereyi yaratan thread'e bagli. uvicorn ana thread disinda sinyal
    # isleyicisi kurmuyor, kapatma should_exit ile.
    server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=port,
                                           log_level="warning"))
    srv = threading.Thread(target=server.run, daemon=True, name="uvicorn")
    srv.start()

    tray_ref: list = []
    tray = Tray(
        icon_path=str(bundle_dir() / "app" / "static" / "icon.ico"),
        title="GgMix",
        on_open=lambda: webbrowser.open(url),
        on_folder=lambda: os.startfile(data_dir() / "songs"),
        on_quit=lambda: setattr(server, "should_exit", True),
        poll=make_poll(QUEUE, url, srv, tray_ref),
    )
    tray_ref.append(tray)
    signal.signal(signal.SIGINT, lambda *_: tray.request_close())
    tray.run()

    srv.join(timeout=5)
    print("\n  kapatildi.")


def main() -> None:
    log = setup_log()
    try:
        run(log)
    except SystemExit as e:
        if log and e.code not in (None, 0):
            from app.tray import message_box
            message_box(str(e.code))
        raise
    except Exception:
        import traceback
        traceback.print_exc()
        if log:
            from app.tray import message_box
            message_box(f"GgMix başlatılamadı. Ayrıntı:\n{log}")
        raise
    finally:
        sys.stdout.flush()
    # Ayirma ortasinda kapatilirsa torch'un ic thread'leri sureci acik
    # tutabiliyor; tepsiden Cikis dendiyse surec gercekten bitmeli
    os._exit(0)


if __name__ == "__main__":
    sys.exit(main())
