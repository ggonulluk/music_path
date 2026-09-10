# GgMix — Optimizasyon, Kaynak Kullanımı ve Kütüphane Yönetimi

**Tarih:** 2026-09-08 · **2. sürüm:** 2026-09-10 (lisans denetimi eklendi, §7)
**Kapsam:** `app/`, `build.py` / `launcher.py`, `.venv` / `.venv-transcribe`
**Durum:** Salt okunur denetim. Bu raporu hazırlarken **hiçbir kod değiştirilmedi.**

Bu belge bir uygulama ajanına devredilmek üzere yazıldı. Her sayı bu makinede
ölçüldü; türetilmiş olanlar "hesap" diye işaretlendi.

> **2. sürüm notu:** §2①②③, §3.3 ve §4.2 uygulandı (commit `9d7b13f`) ve doğrulandı —
> ayrıntı §8'deki durum tablosunda. Bu turda **lisans denetimi** eklendi (§7);
> paketleme başladığı için (`build.py`) lisans soruları artık teorik değil.

> ### ❗ Açık kusur — bu turda bulunan tek gerçek hata
>
> **`app/static/app.js` → `pollJobs()`, `finished` bayrağı hiç tetiklenmeyebiliyor.**
> Bir iş, kütüphane yüklendikten sonraki ilk 1.5 saniye içinde `done`/`error`'a ulaşırsa
> yoklama durur ve satır "ayrılıyor" yazılı asılı kalır. Ayırma ve analiz için erişilemez;
> **hızlı hata veren indirme ve nota çıkarma yolları için erişilebilir.**
>
> Tam teşhis, erişilebilirlik analizi ve düzeltme önerisi: **§2①**. Öncelik listesinde **A**.
> Düzeltme birkaç satır, riski düşük — sıradaki ilk iş bu olmalı.

---

## 0. Bağlam — değiştirmeden önce bilinmesi gerekenler

| | |
|---|---|
| Amaç | Gitar çalmayı öğrenmek. Tempo yavaşlatma, A/B döngü ve kanal fader'ları eşit derecede kritik. |
| Dağıtım | Tamamen lokal, `127.0.0.1:8000`. Sunucu/hosting **istenmiyor**. Hedef: tek `.exe`. |
| Donanım | i7-10700, 16 GB RAM, **GPU yok**. Demucs CPU'da ~0.6x gerçek zaman. |
| Mimari | Ayırma çevrimdışı + önbellekli; çalma gerçek zamanlı (Web Audio + WASM stretcher). |
| Kütüphane boyutu | Şu an **2 şarkı**. Aşağıdaki sorunların hiçbiri bugün hissedilmiyor; hepsi ölçek sorunu. |

> **Uyarı:** Bu ölçekte hiçbir madde acil değil. Öncelik sırasına uyun, "hepsini birden"
> yapmayın — özellikle §5'teki dokunulmaz listesine dikkat edin.

---

## 1. Ölçüm yöntemi (yeniden üretilebilir)

```bash
# API gecikmesi
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}s\n" http://127.0.0.1:8000/api/songs; done

# Şarkı başına maliyet dökümü
.venv/Scripts/python.exe -c "
import time; from pathlib import Path; from mutagen import File as M
songs=[p for p in Path('songs').iterdir() if p.is_file()]
t=time.perf_counter()
for _ in range(20):
    for p in songs: tags=M(p,easy=True); tags.info.length; tags.get('title')
print('mutagen: %.2f ms/sarki' % ((time.perf_counter()-t)*1000/(20*len(songs))))"
```

**Sonuçlar (2 şarkı):**

| İş | Şarkı başına | Payı |
|---|---:|---:|
| `mutagen` etiket ayrıştırma | **6.66 ms** | **%94** |
| 14 × `exists()` (6 stem + analiz + 5 nota + 2 venv) | 0.40 ms | %6 |
| `iterdir` (istek başına, şarkı başına değil) | 0.066 ms | — |
| **`/api/songs` toplam** | **15–22 ms** | |

---

## 2. API ve yoklama optimizasyonu

### Sorun

`/api/songs` her istekte tüm kütüphaneyi diskten yeniden inşa ediyor
(`main.py` → `list_songs()` → `describe()`), ve ön yüz **tek bir işin ilerlemesini
izlemek için** bu ucu 2 saniyede bir yokluyor. Maliyet şarkı sayısıyla doğrusal:

| Kütüphane | `/api/songs` | 2 sn'lik poll'un CPU payı |
|---:|---:|---:|
| 2 şarkı (bugün) | ~17 ms | %0.9 |
| 100 şarkı | ~750 ms (hesap) | **%38** |
| 300 şarkı | ~2.1 sn (hesap) | poll periyodunu aşar |

### ① Yoklamayı `/api/jobs`'a taşı — **yapısal çözüm, önce bu**

`/api/jobs` ucu zaten var ve **tamamen bellekte** — sıfır disk erişimi, maliyeti kütüphane
boyutundan bağımsız. Kütüphane listesi ise yalnızca bir iş bittiğinde ya da dosya
yüklendiğinde değişir.

- İlerleme yoklaması `/api/jobs`'a gitsin.
- `/api/songs` sadece bir işin durumu `queued|running` → `done|error` geçişi yaptığında **bir kez** yenilensin.
- Değişiklik **ön yüzde** (`app/static/app.js`); backend'e dokunmaya gerek yok.

**Kabul ölçütü:** Ayırma çalışırken, kütüphane büyüklüğünden bağımsız olarak poll başına
disk erişimi = 0. Var olan davranış (ilerleme çubuğu, iş bitince listenin tazelenmesi) korunur.

#### ✅ Uygulandı — ama bir açık kusur bıraktı

Doğrulandı: tüm JS'te `/api/songs`'a giden tek çağrı kaldı (`app.js:119`), üzerinde timer yok.
Yapısal hedef tutturulmuş.

**Açık kusur** — `app/static/app.js`, `pollJobs()`:

```js
const prev = jobStates[key];
if (prev && prev !== j.state && (j.state === 'done' || j.state === 'error')) {
```

`jobStates` yalnızca `pollJobs` içinde doluyor; `loadLibrary` doldurmuyor. Dolayısıyla bir işi
**ilk kez gördüğünde `prev` tanımsız** ve `finished` asla tetiklenmiyor.

Bir iş, `loadLibrary`'den sonraki ilk 1.5 saniye içinde `done`/`error`'a ulaşırsa
`finished` **ve** `busy` false kalır → yoklama durur, satır "ayrılıyor" yazılı asılı kalır;
kullanıcı kütüphaneden çıkıp girene kadar düzelmez.

- Ayırma (dakikalar) ve analiz (14–35 sn) için erişilemez.
- **Hızlı hata veren yollar için erişilebilir** — özellikle indirme (`app/fetch.py`) ve
  nota çıkarma uçları anında hata döndürebilir.

**Düzeltme:** `loadLibrary` yanıtta zaten `job` ve `analysis_job` alanlarını alıyor;
`jobStates`'i oradan tohumlayın, `prev` her zaman dolu olsun. `prev &&` koşulunu tek başına
kaldırmak işe yaramaz — o zaman her sayfa açılışında eski bitmiş işler yüzünden gereksiz bir
`/api/songs` çağrısı doğar.

**İki küçük not:**
- `_meta_cache` silinen dosyaların kaydını hiç atmıyor — işler için çözülen sorunun (§3.3)
  aynısı. Kayıt başına ~200 bayt, aciliyeti yok.
- `metadata()` önbellekteki sözlüğü **referansla** döndürüyor. Bugün güvenli, çünkü
  `describe()` `**metadata(path)` ile kopyalıyor. İleride biri döneni değiştirirse önbellek
  bozulur — küçük bir yorum satırı bunu ilerideki okura anlatır.

### ② Metadata önbelleği — `(mtime, size)` anahtarlı

`metadata()` aynı dosyayı her istekte yeniden ayrıştırıyor. Bellekte
`{yol: (mtime, boyut, meta)}` sözlüğü tut; `stat()` değişmedikçe mutagen'i atla.

- 6.66 ms → ~0.01 ms (önbellek isabeti).
- Dosya değişirse mtime tutmaz, kendiliğinden tazelenir — **bayatlama riski yok**, elle
  geçersiz kılmaya gerek yok.
- İsteğe bağlı: sözlüğü diske yaz ki yeniden başlatmada da isabet etsin.

**Kabul ölçütü:** İkinci ve sonraki `/api/songs` çağrılarında mutagen hiç çağrılmaz
(sayaçla doğrulanır); etiketi değişen dosya bir sonraki istekte güncel gelir.

### ③ `can_transcribe` şarkı bağımsız — bedava kazanç

`describe()` içinde `transcribe.available()` her şarkı için çağrılıyor, ama
`.venv-transcribe/Scripts/python.exe` ve `tools/bp_worker.py` varlığına bakıyor — sonuç
tüm şarkılarda aynı. 100 şarkıda **200 gereksiz stat çağrısı**.

İstek başına bir kez hesaplayıp `describe()`'a parametre olarak geçir.

### ④ 14 `exists()` yerine 1 `scandir()` — *yalnızca ① yetmezse*

Windows'ta her `exists()` ayrı çekirdek çağrısı. `os.scandir(stems/<ad>)` klasörün tüm
isimlerini tek okumada verir; stem/nota varlığını küme üyeliğiyle çıkar. ~14× daha az syscall.

① yapıldıysa buna gerek kalmaz. Kütüphane 300+ şarkıya çıkarsa gündeme alın.

---

## 3. Kaynak kullanımı

### 3.1 RAM — ayırma tarafı

399 sn'lik şarkı, stereo float32 @44.1 kHz:

```
stem başına           = 399 × 44100 × 2 kanal × 4 bayt =  141 MB
6 stem (6s geçişi)                                     =  845 MB
+ hibrit 2. geçiş, 4 stem daha                         = +563 MB
tepe (model + torch tamponları hariç)                  ≈ 1.4 GB
```

`separator.py` içindeki `_separate()`, `stems` sözlüğünü sona kadar tutuyor. Ama
**hibritte gitar / piyano / diğer 1. geçişten sonra kesinleşmiş** — ikinci geçiş yalnızca
`vocals` / `drums` / `bass`'i eziyor.

> **Öneri:** 1. geçişten sonra kesinleşen 3 stem'i hemen diske yaz ve bellekten düşür.
> Tepeyi ~%40 kırar. 16 GB'da bugün sorun yok; **10 dakikalık bir şarkıda sınıra yaklaşır**
> (2.1 GB + geçiş tepesi).

**Kabul ölçütü:** Çıktı dosyaları bit düzeyinde aynı kalır; tepe RSS ölçülüp düşüş belgelenir.

### 3.2 RAM — çalma tarafı (mobil için belirleyici)

`app.js` altı stem'i tam çözüp **12 kanalı** stretch düğümüne veriyor:

```
kanal başına = 399 × 44100 × 4 bayt = 70.4 MB
12 kanal (WASM yığınında)           =  845 MB
```

Masaüstü Chrome kaldırıyor. Mobil sekme bellek tavanı çok daha alçak — bu boyutta bir
`WebAssembly.Memory` büyümesi Android'de büyük olasılıkla başarısız olur.

| Profil | Kanal | Toplam (6:39 şarkı) |
|---|---:|---:|
| Şimdiki: stereo @44.1k | 12 | 845 MB |
| Mono @44.1k | 6 | 422 MB |
| **Mono @32k** | **6** | **306 MB** |
| Mono @22.05k | 6 | 211 MB |

> **Kaldıraç:** `new AudioContext({ sampleRate: 32000 })` — `decodeAudioData` çözerken
> kendiliğinden yeniden örnekler, ayrı dönüştürme kodu gerekmez. Mono'ya inmek ayrıca
> **stretcher'ı 12 kanaldan 6'ya düşürür**, CPU yükünü de yarılar.
>
> Masaüstünde şimdiki kalite korunmalı; bu bir **mobil profil**, genel bir düşürme değil.

### 3.3 İş kaydı sözlüğü sınırsız büyüyor

`SeparationQueue`, işleri `f"{kind}:{stem}:{song_id}"` ile anahtarlıyor ve `_jobs` sözlüğü
**hiç budanmıyor**. Bitmiş işler süreç ömrü boyunca duruyor, `/api/jobs` hepsini döndürüyor.

Kayıt başına birkaç yüz bayt — sızıntı sayılmaz, ama uzun oturumda `/api/jobs` yanıtı
sürekli şişer. Bitmiş işleri N dakika sonra ya da son 50'yi tutacak şekilde budayın.

### 3.4 Disk

**Ölçülen:**

| | |
|---|---:|
| `stems/` (2 şarkı) | 123 MB |
| `.venv/Lib/site-packages` | 1.068 MB (torch tek başına 506 MB) |
| `.venv-transcribe/Lib/site-packages` | 1.727 MB |
| HuggingFace model önbelleği (Demucs) | 3.842 MB |
| **Toplam ayak izi** | **~6.8 GB** |

Stem maliyeti: 192 kbps × 6 stem = **şarkı dakikası başına 8.64 MB**.
100 şarkı × 4 dk ≈ **3.5 GB** (hesap).

**İki gözlem:**

1. Whitesnake stem'leri `BITRATE = 192` ayarından önce üretilmiş — hepsi **320 kbps**
   (96 MB). Dylan'ınkiler 192 (32 MB). Yeniden ayırma %40 yer açar. Ses önbelleğinde
   sürüm damgası yok; `analysis.json`'daki `CACHE_VERSION` gibi bir damga eski çıktıları
   tespit edilebilir kılar.
2. Opus @96 kbps yer ihtiyacını bir kat daha yarılar ve mp3-192'den daha temiz olur.
   Chrome/Firefox sorunsuz çözer. **Mobil aktarım gündeme gelirse** ciddi aday; masaüstü
   için yalnız disk kazancı.

---

## 4. Kütüphane yönetimi

Terim iki anlama geliyor; ikisi de gerçek bulgu içeriyor.

### 4.1 Şarkı kütüphanesi

**Kimlik türetimi.** `song_id()` = `sha1(dosya_adı)[:12]`, stem klasörü ise `path.stem`
(uzantısız ad). Sonuç:

- `sarki.mp3` ve `sarki.wav` **farklı** id alır ama **aynı** `stems/sarki/` klasörünü paylaşır → çakışma.
- Dosya yeniden adlandırılırsa id değişir ve stem'ler öksüz kalır; eski klasör diskte durur.

Bugün 2 şarkıda görünmez. Kütüphane büyüyecekse: id'yi içerik özetinden (ilk+son N KB +
boyut) türetin, stem klasörünü **id ile** adlandırın, insan okunur adı bir manifest'te tutun.

**Öksüz temizliği.** `songs/`'tan silinen bir şarkının `stems/` klasörü kalıcı. Şarkı başına
32–96 MB. Bir "kullanılmayan stem'leri temizle" bakım ucu gerekiyor — önce kuru çalıştırma
raporu, sonra onaylı silme.

**Yükleme sınırı yok.** `upload()` 1 MB'lık parçalarla akıtıyor — bellek açısından doğru —
ama **boyut tavanı ve kimlik doğrulama yok**. `127.0.0.1`'de bu kabul edilebilir bir tercih.
**LAN'a açılırsa** (mobil senaryosu) ağdaki herkes diski doldurabilir: tavan + paylaşılan
anahtar şart olur.

**Öneri:** Kütüphane yüzlerce şarkıya çıkarsa dosya sistemini gerçek kaynak saymayı bırakıp
küçük bir SQLite manifest'e geçin (id, yol, mtime, süre, etiketler, stem durumu, analiz
sürümü). §2 ①/②'nin ikisini birden gereksiz kılar ve öksüz tespitini önemsizleştirir.

### 4.2 Bağımlılık ve ortam yönetimi

**Bulgu — `.venv-transcribe` yeniden üretilebilir değil.** Depoda tek bir
`requirements.txt` var ve o `.venv`'e ait. TensorFlow + basic-pitch ortamının **sabitlenmiş
paket listesi yok**. Bu ortamın ayrı tutulması bilinçli (basic-pitch numpy'yi 1.26'ya
düşürüp ana ortamı bozuyor) — karar doğru, ama kaydı eksik.

> **Yapılacak:** `requirements-transcribe.txt` üret
> (`.venv-transcribe/Scripts/pip.exe freeze`) ve iki ortamın **neden** ayrı olduğunu
> README'ye bir cümleyle yaz. Tek `.exe` hedefi için bu kayıt olmadan paketleme
> tekrarlanabilir olmaz.

**Ayak izi tek `.exe` hedefini zorluyor.** ~2.8 GB bağımlılık + 3.8 GB model önbelleği.
Faz 4'e girmeden karara bağlanmalı:

- Modeller `.exe` içine mi gömülecek, ilk çalıştırmada mı indirilecek? İndirme, "kurduğum
  her bilgisayarda çalışsın" hedefiyle çelişir — internetsiz makinede çalışmaz.
- TensorFlow ortamı pakete girecek mi? Nota çıkarma **isteğe bağlı bir özellik**; kod zaten
  `transcribe.available()` ile yokluğunu düzgün karşılıyor. Paket dışında bırakmak dağıtım
  boyutunu ~1.7 GB düşürür ve mevcut mimariye uyar.
- `torch` 506 MB. Demucs'un kullanmadığı alt paketleri PyInstaller `excludes` ile budamak
  mümkün — ama **ölçmeden budamayın**, sessiz çalışma zamanı hatası üretir.

**`requirements.txt` tam sabitlenmiş** (60+ paket, `==` ile). Lokal, tek kullanıcılı bir
araç için doğru tercih — dokunmayın.

---

## 5. Dokunulmayacaklar

Uygulayıcı ajan için: aşağıdakiler **bilinçli kararlar**, verimsizlik değil. "Optimize"
etmeye kalkışmak gerçek bir gerilemeye yol açar.

| Karar | Neden korunmalı |
|---|---|
| Tek işçili kuyruk | Paralel ayırma toplam süreyi kısaltmaz, sadece RAM'i şişirir. GPU yok. |
| İki Demucs modelinin bellekte kalıcı tutulması | Hibrit modda her işte ikisi de gerekiyor. Yeniden yükleme maliyeti daha büyük. |
| Hibritte `other`'ın 6s geçişinden alınması | 4-stem `other` gitar+piyanoyu içerir; üzerine yazmak stem ayrımını bozar. |
| `127.0.0.1`'e bağlanma, CORS kapalı | Güvenlik duruşu bilinçli. §6'daki koşullar sağlanmadan gevşetilmemeli. |
| Tek stretch düğümünün 12 kanal taşıması | Altı ayrı stretcher kanallar arası kaymaya yol açar; tek hesap bunu imkânsız kılar. |
| Analiz kaynağının armonik kanallar olması | Davul ve vokali atmak akor bölümlerini 113'ten 90'a indirdi — ölçülmüş. |
| `requirements.txt`'in tam sabitlenmiş olması | Lokal araç için doğru. |
| `build.py`'de `--onedir` (`--onefile` değil) | LGPL'li `lameenc` ve `soxr`'ın değiştirilebilirlik şartını doğal olarak sağlıyor. Onefile'a geçmek lisans yükümlülüğü doğurur — bkz. §7.2. |

**Bilinen worklet tuzakları:** `numberOfInputs: 0` worklet'i patlatır; `schedule()` sonrası
`start()` girişi sıfırlar. Ses motoruna dokunan her değişiklikte bunlar tekrar kontrol edilmeli.

---

## 6. Güvenlik notu (mevcut durumda sorun yok)

Bugünkü haliyle duruş doğru: yükleme ucu `Path(filename).name` ile dizin geçişini kesiyor,
uzantı beyaz listesi var, `/audio/{sid}/{stem}` iki parametreyi de sözlükten doğruluyor
(yol birleştirme yok), sunucu yalnız `127.0.0.1`'e bağlı, CORS kapalı.

**Bu yalnızca lokale bağlı olduğu için geçerli.** Ağa açma gündeme gelirse — mobil
senaryosunun ilk adımı budur — üçü birlikte şart:

1. `0.0.0.0` yerine tek bir LAN arayüzüne bağlanma,
2. yazma yapan uçlarda (`/api/upload`, `/separate`, `/analyze`, `/transcribe`) paylaşılan anahtar,
3. yükleme boyutu tavanı.

Ayrıca: `AudioWorklet` yalnızca **güvenli bağlamda** tanımlıdır. `localhost` güvenilir sayılır,
`http://192.168.x.x` **sayılmaz** — yani düz HTTP ile LAN'a açılan sürümde tempo yavaşlatma ve
perde kaydırma **çalışmaz**. Ağa açılacaksa güvenilir bir sertifika (ör. mkcert ile yerel CA)
işin parçasıdır, sonradan eklenecek bir ayrıntı değil.

---

## 7. Lisans denetimi

**Kural:** Bu lisansların yükümlülüklerinin neredeyse tamamı **dağıtımda** doğar, kullanımda
değil. Uygulama kendi makinelerinizde kaldığı sürece bugün **hiçbir ihlal yok.** Ama
`build.py` ve `launcher.py` eklendi — paketleme başladı, dolayısıyla aşağısı artık teorik değil.

Denetim yöntemi: her iki venv'deki `*.dist-info/METADATA` dosyalarından `License` /
`License-Expression` / `Classifier: License` alanları okundu (144 paket), kritik olanlar
LICENSE dosyasından tek tek doğrulandı.

### 7.1 Kırmızı — dağıtırsanız sorun

**`mutagen` 1.48.1 → GPL-2.0-or-later.** En ciddi kalem. `app/main.py` içinde modül
seviyesinde `import` ediliyor, pakete kesin giriyor. GPL'li bir kütüphaneyi paketleyip
dağıtmak **tüm dağıtılan programı GPL-2.0 şartlarına sokar** — kaynağı aynı lisansla açma
yükümlülüğü doğar.

> Kullanılan tek şey başlık / sanatçı / süre. **`tinytag` (MIT)** tam olarak bunu veriyor;
> değişiklik `metadata()` içinde birkaç satır. Dağıtım düşünülüyorsa en yüksek getirili
> tek hamle budur.

**`yt-dlp` 2026.8.19 → Unlicense (kamu malı).** *Yazılım lisansı* açısından tamamen temiz.
Risk lisans değil, **içerik hakları**: yayın sitelerinden indirmeyi otomatikleştirmek o
sitelerin kullanım şartlarını ihlal eder ve kaynağa/ülkeye göre telif sorunu doğurabilir.
Kendi materyalini kendi makinende işlemek başka, bunu yapan bir aracı dağıtmak başka.

`build.py` bunu **dışlamıyor**, yani pakete girecek. `.exe` paylaşılacaksa kaldırılacak ya da
"kendi dosyanı getir"e indirgenecek ilk madde bu.

### 7.2 Sarı — dağıtımda dikkat

**`lameenc` 1.8.4 → LGPL-3.0-or-later** (LAME sarmalayıcısı; mp3 yazımının kritik yolunda,
demucs `save_audio` üzerinden) ve **`soxr` 1.1.0 → LGPL-2.1-or-later** (librosa/soundfile
yeniden örnekleme). Zayıf copyleft: kullanıcının bu bileşeni değiştirebilmesi gerekir.

> **İyi haber ve korunması gereken karar:** `build.py` **`--onedir`** kullanıyor,
> `--onefile` değil. Onedir'de DLL'ler klasörde ayrı dosyalar olarak durur ve LGPL'in bu
> şartı doğal olarak sağlanır. **`--onefile`'a geçilirse durum zorlaşır** — bu tercihi
> bilinçli koruyun.

**ffmpeg — Gyan `full_build`, yani GPL derlemesi** (`ffmpeg-9.0.1-full_build`, WinGet ile
ayrıca kurulmuş). Uygulama onu **harici program olarak** çağırıyor; bu "kol mesafesinde"
sayılır, bulaşma yok. **O ikiliyi pakete koymayın.** Şart olursa LGPL derlemesi kullanın.

**`certifi`, `tqdm` → MPL-2.0.** Dosya bazlı copyleft; değiştirmeden paketlemek yeterli,
yalnızca bildirimleri taşıyın.

### 7.3 Yeşil — sorun yok

**`PyInstaller` 6.22.2 → GPLv2-or-later, ama özel istisnalı.** METADATA'dan birebir
doğrulandı: *"with a special exception which allows to use PyInstaller to build and
distribute non-free programs (including commercial ones)"*. Çıktıya hiçbir yükümlülük
binmiyor. Otomatik taramalarda copyleft diye işaretlenir — **yanlış alarm**.

**Demucs 4.1.0 → MIT (Meta Platforms).** LICENSE dosyasından doğrulandı. Ağırlıklar
`https://dl.fbaipublicfiles.com/demucs/` üzerinden geliyor ve `build.py` bunları pakete
gömüyor (`adefossez/HTDemucs`, `adefossez/HTDemucs-6s`), deponun MIT lisansı altında.

> **Dürüstçe işaretlenmesi gereken gri alan:** htdemucs modelleri **MUSDB18-HQ** üzerinde
> eğitildi; o veri seti **CC BY-NC-SA** (ticari kullanım yasak). Meta ağırlıkları MIT olarak
> yayınlıyor. Eğitim verisinin türev modelin ticari kullanımını kısıtlayıp kısıtlamadığı
> yerleşmiş bir soru değil ve bu denetimde çözülemez. Kişisel kullanımda önemi yok;
> **satış düşünülürse** hukukçuya sorulacak tek madde budur.

**Geri kalan 144 paketin tamamı izin verici:** torch Apache-2.0, torchaudio BSD,
librosa ISC, FastAPI / pydantic / uvicorn / PyYAML MIT, numpy / scipy / scikit-learn BSD-3,
huggingface_hub Apache-2.0, sphn Apache-2.0, TensorFlow Apache-2.0,
basic-pitch Apache-2.0 (Spotify), PyAudioWPatch Apache-2.0.

**Vendor JS örnek alınacak durumda.** `app/static/vendor/NOTICE.md` paketi, sürümü (1.3.2),
MIT lisansını, kaynak deposunu ve "değiştirilmeden kopyalandı" notunu içeriyor. Bu tam olarak
olması gereken şey — yeni bir vendor dosyası eklenirse aynı biçimde belgelensin.

**Depo temiz.** `git ls-files` üzerinde doğrulandı: hiçbir ses dosyası commit edilmemiş,
`songs/` ve `stems/` gitignore'da.

### 7.4 Eksik olan iki şey

1. **Projenin kendi LICENSE dosyası yok.** Dağıtım düşünülüyorsa şart. Ayrıca MIT / BSD /
   Apache'nin hepsi kendi telif bildirimlerinin taşınmasını istiyor: paketle birlikte giden
   **toplu bir üçüncü taraf bildirim dosyası** (`THIRD-PARTY-NOTICES.txt`) gerekiyor.
   `pip-licenses` ile üretilip `build.py`'nin çıktı klasörüne kopyalanabilir.
2. **`build.py`'de `--exclude-module=yt_dlp` yok.** TensorFlow ve basic_pitch doğru şekilde
   dışlanmış (§4.2'de önerilen ~1.7 GB kazanç alınmış), ama yt-dlp pakete girecek — 7.1'deki
   karar verilmeden paketlenmemeli.

### 7.5 Özet

| Bileşen | Lisans | Kişisel kullanım | Dağıtım |
|---|---|---|---|
| mutagen | GPL-2.0-or-later | sorun yok | **tüm programı GPL'e sokar** |
| yt-dlp | Unlicense | kod temiz, içerik riski var | **karar gerekiyor** |
| lameenc | LGPL-3.0-or-later | sorun yok | onedir ile uygun |
| soxr | LGPL-2.1-or-later | sorun yok | onedir ile uygun |
| ffmpeg (Gyan full) | GPL | harici çağrı, sorun yok | **paketlemeyin** |
| certifi, tqdm | MPL-2.0 | sorun yok | bildirim taşıyın |
| PyInstaller | GPLv2 + istisna | sorun yok | sorun yok |
| Demucs kodu + ağırlıklar | MIT | sorun yok | sorun yok (ticari için §7.3 notu) |
| Diğer 136 paket | MIT/BSD/Apache/ISC | sorun yok | bildirim taşıyın |

---

## 8. Öncelik ve durum

### Yapıldı (commit `9d7b13f`, doğrulandı)

| # | İş | Doğrulama |
|---|---|---|
| 1 | Yoklama `/api/jobs`'a taşındı (§2①) | Tüm JS'te tek `/api/songs` çağrısı, timer yok. **Bir açık kusur bıraktı — §2①** |
| 2 | Metadata önbelleği (§2②) | Süreç içinde ölçüldü: sıcak isabet 0.047 ms, ayrıştırma 6.66 ms → ~140x |
| 3 | `can_transcribe` istek başına (§2③) | Kod incelemesi; tekil `get_song` yolu da doğru |
| 4 | `requirements-transcribe.txt` (§4.2) | 64 paket sabitlendi |
| 6 | Bitmiş işleri buda (§3.3) | `KEEP_FINISHED = 40`; yalnız `done`/`error` budanıyor, yeni biten iş korunuyor, kilit çakışması yok |

Beşi de sonraki 4 commit'te (fretboard, gamlar, akor basılışları, şarkı kaynakları) bozulmadan durmuş.

### Açık

| # | İş | Etki | Emek | Risk |
|---|---|---|---|---|
| A | `pollJobs` `finished` kusuru (§2①) | **Açık kusur** — UI takılı kalabiliyor | Çok düşük | Düşük |
| B | `yt_dlp` paketleme kararı (§7.1, §7.4) | Dağıtımın önkoşulu | Düşük | — (karar) |
| C | LICENSE + üçüncü taraf bildirimleri (§7.4) | Dağıtımın önkoşulu | Düşük | Yok |
| D | `mutagen` → `tinytag` (§7.1) | Dağıtımda GPL'i kaldırır | Düşük | Düşük |
| E | Kesinleşen stem'leri erken yaz ve bırak (§3.1) | Orta — tepeyi %40 kırar | Orta | Orta (çıktı doğrulanmalı) |
| F | Öksüz stem temizliği (§4.1) | Kütüphane büyürse orta | Orta | Orta (silme — kuru çalıştırma şart) |
| G | Mobil ses profili: mono @32k (§3.2) | Android'in ön koşulu | Orta | Düşük |
| H | `scandir` (§2④) | ① yapıldığı için yok | Düşük | Düşük |
| I | SQLite manifest (§4.1) | Yüzlerce şarkıda yüksek | Yüksek | Orta |

**A bir kusur, hemen yapılabilir. B–D dağıtım yapılacaksa yapılmalı, kod riski yok.
E–I için önce ölçüm, sonra değişiklik.**

---

## 9. Kapanış kuralı

Bu projede geçerli bir ders var: **müzikal ya da başarımsal varsayımları ölçmeden iddia etme.**
Yukarıdaki her sayı bu makinede ölçüldü. Bir değişiklik yapmadan önce ölçümü tekrarlayın,
sonra tekrar ölçüp farkı belgeleyin — özellikle §3.1 ve §3.2'de.

Aynısı lisans için de geçerli: §7'deki her satır kurulu paketin kendi METADATA ve LICENSE
dosyasından okundu, hatırlamayla değil. Yeni bir bağımlılık eklendiğinde tarama tekrarlansın —
tek bir GPL'li paket dağıtım planını değiştirmeye yeter.
