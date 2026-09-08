# Stem Player

Şarkıları enstrüman kanallarına ayırıp her kanalı ayrı kısıp açabildiğin yerel bir
çalışma aracı. Amaç: bir parçanın gitarını (ya da başka bir enstrümanını) izole edip
çalmayı öğrenmek.

Tamamen kendi bilgisayarında çalışır. İnternet gerektirmez, müzik dosyaların hiçbir
yere yüklenmez.

---

## Çalıştırma

`start.bat` dosyasına çift tıkla. Tarayıcı birkaç saniye içinde açılır.
Kapatmak için açılan siyah pencerede `Ctrl+C`.

Elle çalıştırmak istersen:

```
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Kullanım

1. **Şarkı ekle** ile bir mp3 seç, ya da dosyayı doğrudan `songs\` klasörüne kopyala.
2. Kitaplıkta **Kanallara ayır**'a bas. 4 dakikalık bir şarkı yaklaşık 4 dakika sürer
   (bilgisayarında ekran kartı olmadığı için işlemcide çalışıyor).
3. İş bitince **Aç**'a bas. 6 kanal yüklenir, mikser açılır.

Ayırma şarkı başına bir kez yapılır; sonuç `stems\` altına yazılır ve bir daha
beklemezsin.

### Klavye

| Tuş | İş |
|---|---|
| `Boşluk` | Oynat / duraklat |
| `←` `→` | 5 saniye geri / ileri |
| `A` / `B` | Döngü başlangıcı / bitişi işaretle |
| `1`–`6` | O kanalı sustur |
| `Shift`+`1`–`6` | O kanalı solo yap |

Dalga formunda **turuncu olan gitar kanalının seviyesi** — solonun ya da riff'in
nerede olduğunu gözle bulmak için.

---

## Kanal kalitesi hakkında

Ayrım mükemmel değil, model tabanlı bir tahmin:

- **Vokal, davul, bas** — çok iyi. Bunlar `htdemucs` modelinden geliyor.
- **Gitar** — öğrenmeye yeter, ama sızıntı ve metalik artefakt duyarsın.
  Distortion'lı gitarda daha iyi, temiz/akustikte daha zayıf.
- **Piyano** — zayıf. Şarkıda piyano yoksa bu kanal boş kalır; varsa da
  yaylılar ve diğer enstrümanlar buraya karışabilir.
- **İki gitar varsa** (ritim + solo) birbirinden **ayrılmaz**, ikisi de `gitar`
  kanalında toplanır.

## Ayırma modları

| Mod | Ne yapar | Süre |
|---|---|---|
| `hybrid` (varsayılan) | Vokal/davul/bas için `htdemucs`, gitar/piyano için `htdemucs_6s` | ~1.0x |
| `fast` | Sadece `htdemucs_6s` | ~0.5x |

`hybrid` iki kat sürer ama vokal/davul/bas belirgin daha temiz çıkar.
Modu değiştirmek için: `POST /api/songs/{id}/separate?mode=fast`

---

## Yapı

```
app\
  main.py         FastAPI: kitaplık, iş kuyruğu API'si, ses servisi
  separator.py    Demucs motoru — tek işçi thread'li kuyruk, ilerleme takibi
  static\         Arayüz (saf JS + Web Audio API, bağımlılık yok)
songs\            Kaynak müzik dosyaların
stems\            Ayrılmış kanallar (şarkı başına bir klasör, 192 kbps mp3)
tools\
  separate_test.py   Komut satırından ayırma
  analyze_stems.py   Kanalların enerji analizi
```

Oynatma tarafı Web Audio API üzerinde: her kanal kendi `GainNode`'una bağlı ve
altı kaynak da tek `AudioContext` saatinden başlatılıyor, yani kanallar arasında
kayma olmaz.

## Ortamı başka bilgisayarda kurmak

```
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

PyTorch'un işlemci sürümü gerekiyorsa:
`pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu`

---

## Durum

**Bitti**

- Ayırma motoru, iş kuyruğu, ilerleme bildirimi
- Kitaplık, dosya yükleme
- 6 kanallı mikser: fader, sustur, solo, seviye göstergesi
- Dalga formu (gitar vurgulu), tıklayarak konum değiştirme
- A/B döngü
- Klavye kısayolları

**Sırada (Faz 3) — öğrenme için asıl kritik olanlar**

- **Tempo yavaşlatma, ses perdesi bozulmadan.** Solo çalışmanın en önemli aracı.
  Web Audio'nun `playbackRate`'i perdeyi de değiştirdiği için gerçek bir
  time-stretcher gerekiyor (`signalsmith-stretch` WASM adayı).
- **Perde kaydırma.** Şarkı Eb akortsa gitarı sökmeden dinleyebilmek için.
- Bölüm işaretleri (intro / verse / solo) ve döngüleri kaydetme
- Sayım metronomu

**Faz 4**

- Tek `.exe` paketleme (PyInstaller) — hedef makinede Python kurulu olmasın
- Kanal ayarlarını şarkı başına hatırlama
