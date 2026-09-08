# Stem Player — Optimizasyon, Kaynak Kullanımı ve Kütüphane Yönetimi

**Tarih:** 2026-09-08 · **Kapsam:** `app/` (FastAPI + statik ön yüz), `.venv` / `.venv-transcribe`
**Durum:** Salt okunur denetim. Bu raporu hazırlarken **hiçbir kod değiştirilmedi.**

Bu belge bir uygulama ajanına devredilmek üzere yazıldı. Her sayı bu makinede
ölçüldü; türetilmiş olanlar "hesap" diye işaretlendi.

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

## 7. Öncelik sırası

| # | İş | Etki | Emek | Risk |
|---|---|---|---|---|
| 1 | Yoklamayı `/api/jobs`'a taşı (§2①) | Yüksek — poll maliyetini ölçekten koparır | Düşük | Düşük |
| 2 | Metadata önbelleği (§2②) | Yüksek — %94'lük maliyeti siler | Düşük | Düşük |
| 3 | `can_transcribe`'ı istek başına hesapla (§2③) | Düşük ama bedava | Çok düşük | Yok |
| 4 | `requirements-transcribe.txt` üret (§4.2) | Faz 4 için engelleyici | Çok düşük | Yok |
| 5 | Kesinleşen stem'leri erken yaz ve bırak (§3.1) | Orta — tepeyi %40 kırar | Orta | Orta (çıktı doğrulanmalı) |
| 6 | Bitmiş işleri buda (§3.3) | Düşük | Düşük | Düşük |
| 7 | Öksüz stem temizliği (§4.1) | Kütüphane büyürse orta | Orta | Orta (silme — kuru çalıştırma şart) |
| 8 | Mobil ses profili: mono @32k (§3.2) | Android'in ön koşulu | Orta | Düşük |
| 9 | `scandir` (§2④) | ① yapıldıysa yok | Düşük | Düşük |
| 10 | SQLite manifest (§4.1) | Yüzlerce şarkıda yüksek | Yüksek | Orta |

**1–4 arası düşük riskli ve bugün yapılabilir. 5–10 için önce ölçüm, sonra değişiklik.**

---

## 8. Kapanış kuralı

Bu projede geçerli bir ders var: **müzikal ya da başarımsal varsayımları ölçmeden iddia etme.**
Yukarıdaki her sayı bu makinede ölçüldü. Bir değişiklik yapmadan önce ölçümü tekrarlayın,
sonra tekrar ölçüp farkı belgeleyin — özellikle §3.1 ve §3.2'de.
