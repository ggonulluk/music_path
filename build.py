"""Portable ZIP paketi uretir.

    .venv\\Scripts\\python.exe build.py

Ciktilar:
    dist/GgMix/            calisir klasor (GgMix.exe icinde)
    dist/GgMix-portable.zip

Tasarim kararlari:

  --onedir, --onefile DEGIL. Paketin icinde torch var (541 MB); onefile her
  calistirmada bunu gecici klasore acar, acilis 20-60 sn surer. onedir
  saniyeler icinde acilir.

  Demucs modelleri (133 MB) gomuluyor. Yoksa ilk ayirmada internet gerekir
  ve "kurdugum her bilgisayarda calissin" hedefi tutmaz.

  Nota cikarma GOMULU: basic-pitch ONNX modeli + onnxruntime (~40 MB).
  Eskiden TensorFlow (1.8 GB) ile ayri ortamdaydi ve her makinede elle
  kurulmasi gerekiyordu; ONNX ciktisi birebir ayni (olculdu).

  --windowed: konsol penceresi yok. Uygulama sistem tepsisinde ikonla
  duruyor (app/tray.py); cikti GgMix.log'a yaziliyor.

  Ikon app/static/icon.ico (tools/make_icon.py logodan uretir). Surum
  bilgisi de gomuluyor: Gorev Yoneticisi "GgMix" yaziyor, Python degil.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
DIST = ROOT / "dist"
STAGE = BUILD / "stage"
NAME = "GgMix"

MODEL_REPOS = ["models--adefossez--HTDemucs", "models--adefossez--HTDemucs-6s"]


def hf_cache() -> Path:
    for env in ("HF_HUB_CACHE", "HF_HOME"):
        v = os.environ.get(env)
        if v:
            p = Path(v)
            return p if p.name == "hub" else p / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def stage_models() -> Path:
    """Demucs modellerini pakete girecek klasore kopyala."""
    src_root = hf_cache()
    dest_root = STAGE / "models" / "hub"
    dest_root.mkdir(parents=True, exist_ok=True)
    total = 0
    for repo in MODEL_REPOS:
        src, dest = src_root / repo, dest_root / repo
        if not src.is_dir():
            sys.exit(f"Model bulunamadi: {src}\n"
                     "Once bir sarkiyi ayirip modellerin inmesini sagla.")
        if dest.exists():
            shutil.rmtree(dest)
        # blobs/ symlink hedefleri; snapshots zaten gercek dosya iceriyor
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns(".lock", "*.lock"))
        size = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file())
        total += size
        print(f"  model  {repo:34s} {size / 1e6:7.1f} MB")
    print(f"  toplam model                            {total / 1e6:7.1f} MB")
    return STAGE / "models"


VERSION = (1, 1, 0, 0)


def write_version_file() -> Path:
    """Exe'nin Ozellikler > Ayrintilar sekmesi ve Gorev Yoneticisi adi."""
    v = ".".join(map(str, VERSION))
    path = BUILD / "version.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={VERSION}, prodvers={VERSION}),
  kids=[
    StringFileInfo([StringTable('041F04B0', [
      StringStruct('ProductName', '{NAME}'),
      StringStruct('FileDescription', '{NAME}'),
      StringStruct('InternalName', '{NAME}'),
      StringStruct('OriginalFilename', '{NAME}.exe'),
      StringStruct('FileVersion', '{v}'),
      StringStruct('ProductVersion', '{v}')])]),
    VarFileInfo([VarStruct('Translation', [0x041F, 1200])])
  ]
)
""", encoding="utf-8")
    return path


def run_pyinstaller(models: Path) -> None:
    sep = ";" if os.name == "nt" else ":"
    icon = ROOT / "app" / "static" / "icon.ico"
    if not icon.exists():
        sys.exit("Ikon yok. Once: .venv\\Scripts\\python.exe tools\\make_icon.py")
    args = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
        "--onedir", "--windowed", "--name", NAME,
        f"--icon={icon}",
        f"--version-file={write_version_file()}",
        "--distpath", str(DIST), "--workpath", str(BUILD / "pyi"),
        "--specpath", str(BUILD),
        f"--add-data={ROOT / 'app' / 'static'}{sep}app/static",
        f"--add-data={models}{sep}models",
        # demucs model tanimlarini (remote/*.txt) veri olarak tasir
        "--collect-data=demucs",
        "--collect-data=librosa",
        "--collect-data=lazy_loader",
        # nota cikarma: ONNX modeli basic_pitch/saved_models icinde,
        # resampy'nin filtre katsayilari paket verisinde (.npz)
        "--collect-data=basic_pitch",
        "--collect-data=resampy",
        # uvicorn protokollerini dinamik iceri aliyor
        "--hidden-import=uvicorn.protocols.http.h11_impl",
        "--hidden-import=uvicorn.protocols.websockets.auto",
        "--hidden-import=uvicorn.lifespan.on",
        "--hidden-import=uvicorn.loops.asyncio",
        # basic-pitch bunlari varsa kullaniyor; ONNX yolunu sectigimiz icin
        # pakete girmemeli (TensorFlow tek basina 1.8 GB)
        "--exclude-module=tensorflow",
        "--exclude-module=coremltools",
        "--exclude-module=tflite_runtime",
        # Pillow sadece tools/make_icon.py icin (derleme zamani)
        "--exclude-module=PIL",
        # mutagen GPL-2.0: paketlenirse tum programi GPL sartlarina sokar.
        # Etiket okuma tinytag'e (MIT) tasindi; yt-dlp de mutagen'i istege
        # bagli kullaniyor. Ilerideki bir kurulum onu geri getirirse diye
        # dislama burada dursun.
        "--exclude-module=mutagen",
        "--exclude-module=matplotlib",
        "--exclude-module=tkinter",
        "--exclude-module=PyInstaller",
        "--exclude-module=pytest",
        str(ROOT / "launcher.py"),
    ]
    print("\n  PyInstaller calisiyor (birkac dakika surebilir)...\n")
    subprocess.run(args, check=True, cwd=ROOT)


def write_readme(out: Path) -> None:
    (out / "OKUBENI.txt").write_text(
        # Bitisik iki metin once birlesip sonra 40'la carpiliyordu:
        # basligin kendisi 40 kez tekrarlaniyordu. Aradaki "+" sart.
        "GgMix - tasinabilir surum\n" + "=" * 40 + "\n\n"
        "CALISTIRMA\n"
        "  GgMix.exe dosyasina cift tikla.\n"
        "  Tarayici kendiliginden acilir. Siyah pencere acilmaz;\n"
        "  uygulama saatin yanindaki sistem tepsisinde GgMix ikonuyla durur.\n"
        "    - ikonun ustune gelince: o anki is ve ilerlemesi\n"
        "    - sol tik: tarayicida ac\n"
        "    - sag tik: Ac / Sarki klasoru / Cikis\n"
        "  Ikon gorunmuyorsa tepsideki ^ okuna bak.\n\n"
        "MUZIK EKLEME\n"
        "  mp3'lerini bu klasordeki songs\\ icine kopyala, ya da\n"
        "  arayuzdeki 'Sarki ekle' dugmesini kullan.\n\n"
        "VERILERIN NEREDE\n"
        "  songs\\   kaynak muzik dosyalarin\n"
        "  stems\\   ayrilmis kanallar, analiz ve nota dosyalari\n"
        "  Bu klasoru bir baska bilgisayara kopyalarsan her sey tasinir.\n\n"
        "INTERNET\n"
        "  Gerekmiyor. Demucs modelleri pakete gomulu.\n\n"
        "NOTA VE AKOR CIKARMA\n"
        "  Pakete dahil, ek kurulum gerekmez. Nota panelinde\n"
        "  'Notalari cikar'a bas (6 dk'lik kanal ~15-40 sn).\n\n"
        "SORUN OLURSA\n"
        "  Bu klasordeki GgMix.log dosyasina bak.\n",
        encoding="utf-8")


def make_zip(out: Path) -> Path:
    zpath = DIST / f"{NAME}-portable.zip"
    if zpath.exists():
        zpath.unlink()
    files = [f for f in out.rglob("*") if f.is_file()]
    print(f"\n  ZIP yaziliyor ({len(files)} dosya)...")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f in files:
            z.write(f, Path(NAME) / f.relative_to(out))
    return zpath


def guard_user_data() -> None:
    """dist/GgMix'te kullanici verisi varsa derlemeyi DURDUR.

    PyInstaller --noconfirm cikti klasorunu tamamen silip yeniden yaratiyor.
    Exe dist/GgMix'ten calistirilmissa songs/ ve stems/ oradadir; 2026-10-12
    derlemesi bu yuzden ayrilmis kanallari geri donussuz sildi. Otomatik
    tasimak yerine durmak bilincli: veri kullanicinin, yerini o secsin.
    """
    out = DIST / NAME
    found = [out / d for d in ("songs", "stems")
             if (out / d).is_dir() and any((out / d).iterdir())]
    if found:
        sys.exit("DURDU: dist\\GgMix icinde kullanici verisi var, derleme bunu "
                 "silerdi:\n  " + "\n  ".join(map(str, found)) +
                 "\nBu klasorleri baska bir yere tasi, sonra tekrar derle.")


def main() -> None:
    t0 = time.time()
    guard_user_data()
    if STAGE.exists():
        shutil.rmtree(STAGE)
    print("  modeller hazirlaniyor")
    models = stage_models()

    run_pyinstaller(models)

    out = DIST / NAME
    if not out.is_dir():
        sys.exit("PyInstaller ciktisi bulunamadi")
    for d in ("songs", "stems"):
        (out / d).mkdir(exist_ok=True)
    write_readme(out)

    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    zpath = make_zip(out)

    print(f"\n  klasor : {out}  ({size / 1e6:.0f} MB)")
    print(f"  zip    : {zpath}  ({zpath.stat().st_size / 1e6:.0f} MB)")
    print(f"  sure   : {(time.time() - t0) / 60:.1f} dk")


if __name__ == "__main__":
    main()
