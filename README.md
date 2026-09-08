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
| `↑` `↓` | Hızı %5 artır / azalt |
| `A` / `B` | Döngü başlangıcı / bitişi işaretle |
| `−` / `+` | Perdeyi yarım ton indir / çıkar |
| `1`–`6` | O kanalı sustur |
| `Shift`+`1`–`6` | O kanalı solo yap |

### Çalışma kontrolleri

**Hız** %25–%125 arası ayarlanır ve **ses perdesi bozulmaz** — solo'yu yarı
hızda çalışıp yavaşça hızlandırabilirsin. **Perde** ±6 yarım ton kaydırılır;
şarkı Eb akortsa gitarını sökmeden bir ton indirip çalabilirsin. İkisi
birbirinden bağımsız: hızı değiştirmek perdeyi, perdeyi değiştirmek hızı
etkilemez.

Döngü (A/B) yavaşlatmayla birlikte çalışır — asıl kullanım şekli de budur:
4 ölçüyü işaretle, %50 hıza al, parmakların öğrenene kadar tekrar et.

Dalga formunda **turuncu olan gitar kanalının seviyesi** — solonun ya da riff'in
nerede olduğunu gözle bulmak için.

### Nota paneli

Sağdaki panel, seçtiğin kanaldan çıkarılan notaları piano roll olarak gösterir.
İlk kez kullanırken **Notaları çıkar**'a basman gerekir (6 dakikalık bir kanal
~20 saniye). Dar ekranda panel mikserin altına iner.

- **Döngü açıkken panel o aralığa yakınlaşır.** Tüm şarkıyı göstermek 1700 notayı
  900 piksele sıkıştırıyor ve okunmuyor; asıl çalışma da döngü içinde olduğu için
  yakınlaşmak doğru olan.
- Sol kenardaki `e B G D A E` çizgileri açık tel perdeleri.
- Panelin altında, oynatma kafasının o anda üzerinde olduğu notalar ve
  **tel/perde tahmini** yazar (`C3 A/3` = A teli 3. perde).
### İki indirme düğmesi — karıştırma

| Düğme | Ne verir | Ne için |
|---|---|---|
| **Ses** | Seçili kanalın **mp3'ü** (izole gitar, izole vokal…) | Dinlemek, telefona atmak, DAW'a almak |
| **MIDI** | Sadece **nota verisi** | MuseScore / Guitar Pro / DAW'da notaya dökmek |

**MIDI bir ses dosyası değildir.** İçinde "hangi an, hangi perde, ne kadar süre"
bilgisi vardır; şarkının tonu, distortion'ı, tınısı yoktur. Oynatıcın onu kendi
ses bankasıyla sentezler — bu yüzden gitar solosu bir MIDI oynatıcıda garip bir
klavye sesi gibi duyulur. Bu bir hata değil, formatın doğası.

Kanal başına makul bir General MIDI enstrümanı atanıyor (gitar → temiz elektro
gitar, bas → elektrik bas, vokal → koro) ki en azından doğru enstrüman ailesinde
duyulsun. **Gitar için bilerek temiz ton seçildi** — distortion'lı MIDI sesleri
notaları birbirine karıştırıyor, oysa amaç notaları ayırt etmek.

Şarkının gerçek gitar sesini duymak istiyorsan **Ses** düğmesini kullan.

### Akor rozeti

Aynı anda duyulan notalardan akorun adı çıkarılır ve büyük puntoyla yazılır
(`E`, `Am7`, `E5`, `Gsus4`…). Altındaki küçük yazı akoru oluşturan notaları
gösterir.

Rozetin rengi ne kadar güveneceğini söyler:

| Renk | Anlamı |
|---|---|
| **Yeşil** | Transkripsiyon ve librosa akor analizi **aynı kökü** buldu |
| **Turuncu** | Notalar bir akor şablonuna tam oturdu |
| **Gri** (`yaklaşık`) | Kısmi eşleşme — eksik ya da fazla nota var |

Ters çevrilmiş akor gösterimi (`E/G#`) bilerek yok: transkripsiyon çoğu zaman
en kalın teli kaçırıyor, o zaman en pes duyulan nota gerçek bas sanılıp yanlış
etiket çıkıyor. Notaların tamamı zaten altındaki çiplerde görünüyor.

Tel/perde tahmini kabadır — en düşük perdeyi seçer, gerçek parmak pozisyonu
çevredeki notalara göre değişir. Başlangıç noktası olarak düşün.

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
  analysis.py     Ton / gam / tempo / akor analizi (librosa)
  transcribe.py   Nota çıkarma — ayrı venv'de alt süreç olarak çalışır
  static\         Arayüz (saf JS + Web Audio API)
    vendor\       signalsmith-stretch (MIT) — bkz. vendor\NOTICE.md
songs\            Kaynak müzik dosyaların
stems\            Ayrılmış kanallar + analysis.json + notes_<kanal>.json/.mid
tools\
  separate_test.py   Komut satırından ayırma
  analyze_stems.py   Kanalların enerji analizi
  analyze_music.py   Ton, gam, tempo, akor tespiti (miks/kanal karşılaştırmalı)
  bp_worker.py       basic-pitch işçisi (.venv-transcribe içinde koşar)
```

### İki ayrı Python ortamı

`basic-pitch` TensorFlow çekiyor ve numpy'yi 1.26'ya düşürüyor — bu da ana
ortamdaki torch/demucs kurulumunu bozar. Bu yüzden ayrı tutuluyor:

| Ortam | İçerik | Kullanım |
|---|---|---|
| `.venv` | torch, demucs, librosa, fastapi | Uygulama ve ayırma |
| `.venv-transcribe` | tensorflow, basic-pitch | Sadece nota çıkarma, alt süreç |

Nota çıkarma ortamını kurmak (isteğe bağlı — yoksa panel bunu söyler):

```
python -m venv .venv-transcribe
.venv-transcribe\Scripts\python.exe -m pip install -r requirements-transcribe.txt
```

İki ortamın da paket listesi sabitlenmiş: `requirements.txt` ve
`requirements-transcribe.txt`. Tek `.exe` paketleme bu kayıtlar olmadan
tekrarlanabilir olmaz.

### Ses motoru

Tek bir Signalsmith Stretch düğümü **12 kanal** taşıyor (6 stem × stereo):

```
stretch(12ch) → splitter → [merger → ölçer → fader] ×6 → ana çıkış
```

Bütün kanallar aynı gerdirme hesabından geçtiği için aralarında kayma
*matematiksel olarak* imkânsız. Altı ayrı stretcher çalıştırmak daha basit
olurdu ama zamanla ayrışma riski taşırdı. Fader'lar gerdirmeden sonra,
seviye göstergeleri fader'dan önce.

Ölçüm: %50 hızda oran tam 0.500, perde ±2 yarım ton kaydırıldığında hız
oranı 0.502 — ikisi gerçekten bağımsız.

### Performans kararları

Bunlar bilinçli; "sadeleştirmek" isteyen biri farkında olmalı.

**İlerleme yoklaması `/api/jobs`'a gider, `/api/songs`'a değil.** `/api/songs`
her istekte kütüphaneyi diskten yeniden kurar — şarkı başına ~12 ms etiket
ayrıştırma (ölçüldü). 100 şarkılık bir kütüphanede bu 1.3 saniye eder ve
1.5 saniyede bir yoklamak işlemciyi sürekli meşgul bırakır. `/api/jobs`
tamamen bellekte, ~2 ms, kütüphane boyutundan bağımsız. Kütüphane listesi
yalnızca bir iş bittiğinde tazelenir; ilerleme çubuğu yerinde güncellenir.

**Etiket önbelleği `(mtime, boyut)` anahtarlı.** Dosya değişirse damga tutmaz
ve kendiliğinden tazelenir — elle geçersiz kılmaya gerek yok.

**Nota paneli okuma alanı sabit yükseklikte (106 px).** Akor rozeti ve nota
çipleri saniyede değişiyor; yükseklik serbest bırakılırsa panel zıplıyor ve
`flex:1` olan piano roll her seferinde yeniden boyutlanıp çiziliyor. Rozet
akor yokken gizlenmez, boşalır.

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
- **Tempo yavaşlatma, ses perdesi bozulmadan** (%25–%125)
- **Perde kaydırma** (±6 yarım ton)
- Klavye kısayolları
- **Ton / gam / pentatonik / tempo şeridi** — ayırmadan sonra otomatik
- **Nota transkripsiyonu** — piano roll, tel/perde tahmini, MIDI indirme
- **Akor rozeti** — duyulan notalardan akor adı, analizle çapraz kontrollü

**Sırada**

- Akor şeridi — dalga formu boyunca akor dizisi, "tahmin" olduğu belirtilerek
- Bölüm işaretleri (intro / verse / solo) ve döngüleri kaydetme
- Sayım metronomu

**Faz 4**

- Tek `.exe` paketleme (PyInstaller) — hedef makinede Python kurulu olmasın
- Kanal ayarlarını şarkı başına hatırlama
