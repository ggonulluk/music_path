# Üçüncü taraf bileşenler

GgMix açık kaynak kütüphaneler kullanıyor. Bu dosya hangi bileşenin hangi
lisansla geldiğini ve **paketleme sırasında bozulmaması gereken kısıtları**
kaydediyor.

> **Bugünkü durum:** Program dağıtılmıyor, kişisel kullanımda. Aşağıdaki
> yükümlülüklerin neredeyse tamamı **dağıtımda** doğar, kullanımda değil.
> Yani bugün uyulması gereken bir şey yok. Bu dosya, ileride paylaşmaya
> karar verilirse nelere bakılacağını kaydetmek için var.

Lisanslar, kurulu paketlerin kendi `METADATA` dosyalarından okundu.

---

## Paketlemede korunması gereken iki karar

Bunlar keyfi değil; değiştirilirse dağıtım yükümlülüğü doğar.

### 1. `build.py` `--onedir` kullanmalı, `--onefile` değil

`lameenc` (LGPL-3.0-or-later, mp3 yazımı) ve `soxr` (LGPL-2.1-or-later,
yeniden örnekleme) zayıf copyleft. LGPL, kullanıcının bu bileşeni
değiştirebilmesini şart koşuyor. `--onedir`'de DLL'ler klasörde ayrı
dosyalar olarak durduğu için bu şart doğal olarak sağlanıyor.
`--onefile`'a geçilirse şart zorlaşır.

> Not: `--onedir` zaten başka bir sebeple de doğru tercih — paketin içinde
> torch var (541 MB) ve `--onefile` her açılışta bunu geçici klasöre açardı.

### 2. ffmpeg ikilisi pakete konmamalı

Kurulu olan `Gyan.FFmpeg full_build` bir **GPL** derlemesi. Uygulama onu
**harici program olarak** çağırıyor (`app/fetch.py` → `yt-dlp`'nin
`ffmpeg_location` ayarı); bu "kol mesafesinde" sayılır, bulaşma yok.
Pakete gömülürse durum değişir. Gerekirse LGPL derlemesi kullanılmalı.

`build.py` şu an ffmpeg'i **paketlemiyor** — indirme özelliği kullanıcının
sisteminde ffmpeg arıyor, yoksa düğme kapalı kalıyor.

---

## Kaldırılan bağımlılık

**`mutagen` → `tinytag`.** `mutagen` GPL-2.0-or-later; paketlenip
dağıtıldığında tüm programı GPL şartlarına sokuyordu. Kullanılan tek şey
başlık/sanatçı/süre okumaktı; `tinytag` (MIT) tam olarak bunu veriyor.

Aynı dosyalarda karşılaştırıldı: başlık ve sanatçı birebir aynı, süre VBR
tahmininde ~0.5 sn farklı (gösterimde aynı dakikayı veriyor, oynatıcı süreyi
zaten çözülmüş sesten alıyor). `build.py` ayrıca `--exclude-module=mutagen`
taşıyor — ileride bir kurulum onu geri getirirse pakete girmesin diye.

---

## Bileşenler

### Çekirdek

| Bileşen | Lisans | Ne için |
|---|---|---|
| Demucs 4.1.0 | MIT (Meta) | Kanal ayırma |
| HTDemucs / HTDemucs-6s ağırlıkları | MIT | Ayırma modelleri |
| torch, torchaudio | Apache-2.0 / BSD | Demucs'un motoru |
| librosa | ISC | Ton, gam, tempo, akor analizi |
| numpy, scipy, scikit-learn | BSD-3 | Sayısal işlem |
| FastAPI, uvicorn, pydantic | MIT | Sunucu |
| sphn | Apache-2.0 | Ses okuma |
| soundfile | BSD-3 | WAV yazma |
| tinytag | MIT | Etiket okuma |
| Send2Trash | BSD | Geri dönüşüm kutusuna silme |
| PyAudioWPatch | Apache-2.0 | Sistem sesi kaydı |
| yt-dlp | Unlicense (kamu malı) | Bağlantıdan indirme |

### Zayıf copyleft — yukarıdaki kısıtlara bakın

| Bileşen | Lisans |
|---|---|
| lameenc | LGPL-3.0-or-later |
| soxr | LGPL-2.1-or-later |

### Dosya bazlı copyleft — bildirimi taşımak yeterli

| Bileşen | Lisans |
|---|---|
| certifi | MPL-2.0 |
| tqdm | MPL-2.0 AND MIT |

### Arayüz

| Bileşen | Lisans | Ne için |
|---|---|---|
| Signalsmith Stretch 1.3.2 | MIT | Perde bozmadan tempo değiştirme |

Ayrıntı: `app/static/vendor/NOTICE.md`

### Yalnızca derleme aracı

**PyInstaller 6.22.2** — GPLv2-or-later, **ama özel istisnalı**: METADATA'da
birebir şöyle yazıyor: *"with a special exception which allows to use
PyInstaller to build and distribute non-free programs (including commercial
ones)"*. Üretilen pakete hiçbir yükümlülük binmiyor. Otomatik lisans
taramaları bunu copyleft diye işaretler — yanlış alarm.

### İsteğe bağlı ortam (pakete girmiyor)

`.venv-transcribe` içindeki nota çıkarma ortamı ayrı tutuluyor ve pakete
dahil edilmiyor:

| Bileşen | Lisans |
|---|---|
| basic-pitch | Apache-2.0 (Spotify) |
| TensorFlow | Apache-2.0 |

---

## Ticari kullanım düşünülürse tek gri alan

htdemucs modelleri **MUSDB18-HQ** veri seti üzerinde eğitildi; o veri seti
**CC BY-NC-SA** (ticari kullanım yasak). Meta ağırlıkları MIT olarak
yayınlıyor. Eğitim verisinin türev modelin ticari kullanımını kısıtlayıp
kısıtlamadığı yerleşmiş bir hukuki soru değil.

**Kişisel kullanımda önemi yok.** Satış düşünülürse hukukçuya sorulacak tek
madde budur.

---

## Yeni bağımlılık eklenirse

`pip install` sonrası lisansı kontrol et:

```
.venv/Scripts/python.exe -c "import importlib.metadata as md; m=md.metadata('PAKET'); print(m.get('License-Expression') or m.get('License') or [c for c in m.get_all('Classifier') or [] if 'License' in c])"
```

Tek bir GPL'li paket dağıtım planını değiştirmeye yeter.
