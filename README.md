# GgMix

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

### Gitar klavyesi

Nota panelinin üstünde, çaldıkça basılı pozisyonları yakan bir klavye var.
Perde penceresi çalınan bölgeye kendiliğinden kayar (üstte `perde 2–9` yazar);
her karede kaydırmak gözü yorduğu için sadece nota pencerenin dışına çıkınca
yeniden konumlanır.

**Asıl iş çizim değil, pozisyon seçimi.** Bir `E4` notası gitarda 6 farklı
tel/perde kombinasyonunda çalınabilir. Her notayı tek başına değerlendirip
"en düşük perde" seçmek geçerli ama gerçekçi olmayan sonuç verir — el sürekli
klavyenin bir ucundan ötekine zıplar, ve öğrenme aracında bu yanlış alışkanlık
kazandırır.

Bunun yerine pozisyonlar **tüm dizi boyunca bir yol olarak** seçiliyor: her nota
olayı için olası parmak pozisyonları düğüm, ardışık olaylar arasındaki el
hareketi geçiş maliyeti; dinamik programlama toplamı en aza indiren yolu buluyor.

Ölçülen sonuç:

| | Naif | Yol seçimi |
|---|---|---|
| Ortalama el hareketi (Whitesnake) | 1.84 perde | **1.17 perde** |
| 5+ perde sıçraması (Whitesnake) | 96 | **19** |
| 5+ perde sıçraması (Bir Kaç Saat) | 45 | **2** |

Doğrulama olarak dört klasik açık akor şekli birebir çıkıyor: E majör
`E0 A2 D2 G1 B0 e0`, Am `A0 D2 G2 B1 e0`, G majör `E3 A2 D0 G0 B0 e3`,
D majör `D0 G2 B3 e2`.

1700 nota için hesap ~13 ms, tarayıcıda çalışıyor, önbelleğe gerek yok.

**Bir incelik:** uzun süren bir nota hâlâ tınlarken yeni bir nota başlayabilir
ve ikisi aynı tele düşebilir. Gitarda bu imkânsız değil — teli tekrar kullanmak
önceki notayı susturur — ama klavyede iki nokta göstermek yanlış olur. Gösterimde
o telde en son başlayan nota kalır.

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

## Gamlar sayfası

Üst çubuktaki **Gamlar** ayrı bir sayfa açar. Şarkı çalarken de açılabilir —
oynatma durmaz.

Kök nota (12) × gam (13) seçilir, klavyede 15 perde boyunca gamın tüm notaları
derece etiketleriyle gösterilir (`1 2 b3 4 5 b6 b7`), kök notalar turuncu dolu.

**Gamlar:**

| Grup | |
|---|---|
| Temel | Majör, doğal minör, majör/minör pentatonik, blues |
| Modlar | Dorian, Frigian, Lidyan, Miksolidyan, Lokrian |
| İleri | Harmonik minör, melodik minör, Frigian dominant |

(Ionian = majör, Aeolian = doğal minör olduğu için ayrıca listelenmedi.)

**Pentatonik kutuları (CAGED).** Pentatonik ve blues seçiliyken 5 standart
pozisyon çıkar; kalın E telindeki kök notadan başlarlar. A minör pentatonikte
bu 5-8-10-12-15 verir — gitaristin ezberlediği klasik dizilim. Kutuya tıklayınca
klavyede o aralık vurgulanır.

**Akor cetveli.** Gamın her derecesi üstüne kurulan üçlüler, roma rakamı ve
renk koduyla (majör yeşil, minör mavi, eksilmiş kırmızı, artırılmış mor).
Pentatonik ve blues 7 notalı olmadığı için onlarda ana gamın akorları
gösterilir — pentatonikle solo yaparken altta zaten o akorlar çalar.

**Şarkının tonu.** Bir şarkı açıksa düğme görünür ve analizin bulduğu tona
atlar. Şarkı açık değilse gizli kalır.

### Akor basılışları

Cetveldeki bir akora tıklayınca **klavye boyunca 4-5 farklı pozisyondaki
basılış şekli** diyagram olarak çıkar: `x32010`, `8755xx`, `8-10-10-9-8-8`…
Her diyagramın altında pozisyon, parmak sayısı ve barre gerekip gerekmediği
yazar.

Üretici gerçek gitar kısıtlarını uyguluyor:

- Akorun bütün sesleri bulunmalı (kök, üçlü, beşli)
- El açıklığı 4 perdeyi geçemez
- Parmak sayısı 4'ü geçemez

**Barre kuralı ayrı bir incelik.** Aynı perdeye basılmış iki telin *arasında*
daha yüksek perdeye basılmış bir tel varsa, o iki teli ayrı parmaklarla
tutmak mümkün değil — tek çözüm işaret parmağını yatırmak. Ama barre ancak
şeklin en düşük perdesinde kurulabilir ve barre aralığında boş tel olamaz
(işaret parmağı onu da bastırır). Bu kural olmadan `10321x` gibi fiziksel
olarak basılamayan şekiller üretiliyordu.

Puanlama gerçek gitar tercihlerini taklit ediyor: kök notanın basta olması,
çok telin duyması, boş tel ve düşük pozisyon iyi; ortadaki teli susturmak,
çok parmak ve gerilme kötü.

**Doğrulama:** üreteç 13 bilinen akor şekliyle sınandı ve hepsini buluyor —
`C=x32010`, `G=320003`, `D=xx0232`, `A=x02220`, `E=022100`, `Am=x02210`,
`Em=022000`, `Dm=xx0231`, `F=133211`, `Bm=x24432`, `B=x24442`, `E7=020100`,
`A7=x02020`. Bu şekiller gitar kitaplarında sabittir; çıkmıyorsa algoritma
yanlıştır.

### Derece adlandırmasında bir incelik

7 notalı gamlarda derece adı **aralıktan değil gamdaki konumdan** gelir.
Lokrian'ın 8. yarım tonu `b6`'dır, `#5` değil — majörün 6. derecesinin
pesleştirilmiş hali olduğu için. Sadece aralığa bakan bir kural burada
yanılıyordu; konum majör ölçütüyle karşılaştırılıp işaret oradan çıkarılıyor.
Pentatonik ve blues 7 notalı olmadığı için orada aralığa göre adlandırma
yapılıyor (blues'un 6. yarım tonu `b5`, Lidyan'ınki `#4`).

---

## Şarkı kaynakları

`songs\` klasörüne elle kopyalamanın yanında iki yol daha var. İkisi de
**isteğe bağlı** — bağımlılığı olmayan makinede düğme kapalı kalır ve sebebi
yazar.

### Bağlantıdan indirme

Kitaplığın üstündeki alana bağlantı yapıştır, **İndir**'e bas. `yt-dlp`
sesi indirir, ffmpeg mp3'e çevirir, dosya `songs\` klasörüne düşer.

**Neden mp3'e çeviriyoruz?** Ayırma motoru sesi `sphn` ile okuyor ve sphn
m4a/webm/opus çözemiyor (ölçüldü). demucs ffmpeg'e düşüyor ama paketlenmiş
sürümde ffmpeg bulunmuyor. İndirme sırasında çevirince ffmpeg yalnızca bu
özellik için gerekli oluyor, çekirdek boru hattı ona bağımlı kalmıyor.

**Bakım notu:** `yt-dlp` sık güncelleme ister çünkü siteler iç yapılarını
değiştiriyor. Paketlenmiş sürümde gömülü kalan bir `yt-dlp` birkaç ay sonra
çalışmayabilir.

> YouTube'un kullanım şartları kendi sunduğu özellikler dışında indirmeyi
> yasaklıyor. `yt-dlp`'nin kendisi meşru bir açık kaynak araç; kısıt aracın
> değil sitenin şartlarından geliyor.

### Sistem sesi kaydı

**Sistem sesini kaydet**'e bas, şarkıyı çal, bitince tekrar bas. Hoparlöre
giden ses WAV olarak `songs\` klasörüne yazılır — kaynak fark etmez.
İndirme değil, kayıt.

Sessiz geçen süreler dosyaya yazılmaz, yani kayıt fiilen ses çıktığı anda
başlar. Önce kaydı başlatıp sonra şarkıyı çalabilirsin.

### Bu ikisinde çıkan üç kusur

Kayıt özelliği yazılırken üç ayrı hata ölçümle yakalandı; hepsi kodda
yorumla işaretli:

1. **Bloke eden okuma.** Hiçbir şey çalmıyorken WASAPI loopback veri
   üretmiyor ve `stream.read()` sonsuza kadar asılı kalıyordu — kullanıcı
   "durdur" dediği halde dosya kilitli kalıyordu. Geri çağırma kipine geçildi.
2. **Süreç çökmesi (segfault).** Arayüz kayıt sırasında durumu 700 ms'de bir
   yokluyordu ve her yoklamada yeni bir PyAudio örneği açılıp kapanıyordu; bir
   thread PortAudio'yu sonlandırırken diğerinde açık akış kalınca süreç
   çöküyordu. Cihaz bilgisi artık bir kez sorgulanıp önbelleğe alınıyor.
3. **Durdurma çalışmıyordu.** Yazma döngüsü durdurma bayrağını sadece kuyruk
   boşaldığında kontrol ediyordu; ses sürekli aktığı için kuyruk hiç
   boşalmıyor ve döngü çıkmıyordu.

## Kütüphane yönetimi

Kitaplık başlığında **arama** (yazdıkça süzer), **durum filtresi** (tümü / hazır /
ayrılmamış / işlemde), **sıralama** (ad, eklenme, süre, boyut) ve sağda toplam
sayaç var: `12 / 40 şarkı · 3.2 GB`. Süzme tamamen tarayıcıda yapılır; liste
zaten bellekte olduğu için her tuş vuruşunda sunucuya gidilmez.

Her satırın sonundaki **⋯** menüsünde:

| | Ne yapar |
|---|---|
| Analizi yenile | Ton/gam/akor analizini yeniden hesaplar |
| Kanalları sil | `stems\` klasörünü siler, kaynak mp3 kalır — tekrar ayırabilirsin |
| Şarkıyı tamamen sil | Kaynak dosya + kanallar |

**Silinen hiçbir şey kalıcı olarak yok edilmez** — hepsi geri dönüşüm kutusuna
gider. Her silme öncesi ne kadar yer boşalacağını gösteren bir onay çıkar.
Üzerinde iş çalışan bir şarkı silinemez (işçi yarıda kalmasın diye).

Altta **Öksüz kanalları tara** var: `songs\`'ta karşılığı kalmamış `stems\`
klasörlerini bulur. Önce ne bulunduğunu ve kaç MB olduğunu gösterir, sonra
onay ister.

### Ölçek

Stem maliyeti şarkı dakikası başına **8.64 MB** (6 kanal × 192 kbps):

| Kütüphane | Kanalların kapladığı yer |
|---|---|
| 50 şarkı | 1.7 GB |
| 100 şarkı | 3.5 GB |
| 300 şarkı | 10.4 GB |

### Bilinen sınır

Şarkı kimliği **dosya adından** türetiliyor ve kanal klasörü de öyle
adlandırılıyor. Yani bir şarkıyı yeniden adlandırırsan kanalları öksüz kalır
(tarama aracı bunları bulur). Ayrıca `parça.mp3` ile `parça.wav` aynı kanal
klasörünü paylaşır. Yüzlerce şarkıya çıkarsa kimliği dosya içeriğinden
türetmek gerekir.

### Türkçe etiketler

ID3v1 etiketleri kodlama bilgisi taşımaz ve `mutagen` latin-1 varsayar; Türkçe
etiketler genelde Windows-1254 ile yazıldığı için `BİR` → `BÝR` gibi bozulur.
Başlıkta latin-1'e özgü Izlandaca harfler (`ÐÝÞðýþ`) varsa yanlış çözülmüş
sayılıp cp1254 ile yeniden çözülür.

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
  transcribe.py   Nota çıkarma — basic-pitch ONNX modeli, ana süreçte
  tray.py         Sistem tepsisi ikonu (saf ctypes)
  static\         Arayüz (saf JS + Web Audio API)
    vendor\       signalsmith-stretch (MIT) — bkz. vendor\NOTICE.md
songs\            Kaynak müzik dosyaların
stems\            Ayrılmış kanallar + analysis.json + notes_<kanal>.json/.mid
tools\
  separate_test.py   Komut satırından ayırma
  analyze_stems.py   Kanalların enerji analizi
  analyze_music.py   Ton, gam, tempo, akor tespiti (miks/kanal karşılaştırmalı)
  make_icon.py       Logodan exe/tepsi ikonu (app\static\icon.ico)
```

### Tek Python ortamı

Nota çıkarma eskiden TensorFlow ile ayrı bir `.venv-transcribe` ortamında,
alt süreç olarak çalışıyordu: basic-pitch'in TF bağımlılığı numpy'yi 1.26'ya
düşürüp torch/demucs'u bozuyordu. Bu yüzden pakete giremiyordu ve her
bilgisayarda elle kurulması gerekiyordu. Kurulmayan makinede akor rozeti
boş kalıyordu.

Artık basic-pitch'in kendi ONNX modeli (`nmp.onnx`) onnxruntime ile ana
süreçte çalışıyor. Çıktı TF ile birebir aynı: Whitesnake gitar kanalında
1713/1713 nota, aynı başlangıç ve perde (ölçüldü). basic-pitch `--no-deps`
ile kurulu (bkz. *Kaynaktan kurmak*). Bir avantajı daha var: TensorFlow'un
her çağrıda ödenen ~30 sn açılış süresi yok.

Paket listesi sabitlenmiş: `requirements.txt` ve `requirements-nodeps.txt`.
`.venv-transcribe` artık kullanılmıyor, silinebilir.

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

## Başka bilgisayarda çalıştırmak

### Taşınabilir paket (Python gerekmez)

```
.venv\Scripts\python.exe build.py
```

Çıktı: `dist\GgMix\` klasörü (~917 MB) ve `dist\GgMix-portable.zip`
(~416 MB). ZIP'i hedef bilgisayarda aç, `GgMix.exe`'ye çift tıkla.
Python, yönetici hakkı ve internet gerekmez.

Paketle ilgili kararlar:

| Karar | Neden |
|---|---|
| `--onedir`, `--onefile` değil | İçinde torch var (541 MB); onefile her açılışta bunu geçici klasöre açar, açılış 20–60 sn sürer |
| Demucs modelleri gömülü (133 MB) | Yoksa ilk ayırmada internet ister; "kurduğum her bilgisayarda çalışsın" hedefi tutmaz |
| Nota çıkarma **gömülü** (ONNX) | basic-pitch'in ONNX modeli + onnxruntime ~40 MB; TensorFlow (1.8 GB) gerekmiyor |
| `--windowed` | Siyah konsol penceresi yok; uygulama sistem tepsisinde durur, çıktı `GgMix.log`'a |
| Logodan ikon + sürüm bilgisi | Exe, tepsi ve Görev Yöneticisi'nde Python amblemi yerine GgMix logosu ve adı |
| ffmpeg **yok** | Gerekmiyor — demucs mp3'ü `sphn` ile çözüyor (ölçüldü) |

Veriler `songs\` ve `stems\` klasörlerinde, exe'nin yanında durur. Klasörün
tamamını kopyalarsan şarkılar, ayrılmış kanallar ve analizler birlikte taşınır.

İkon logodan üretiliyor (`logo.jfif` değişirse yeniden çalıştır):

```
.venv\Scripts\python.exe tools\make_icon.py
```

### Başlatıcı

`launcher.py` (paketin giriş noktası) `start.bat`'ın körlemesine beklemesinin
yerine geçiyor:

- Port gerçekten dinlemeye başlayınca tarayıcıyı açar
- Uygulama zaten çalışıyorsa ikinci sunucu başlatmaz, sadece sekmeyi açar
- 8000'i başka bir program tutuyorsa `/api/health` ile bunu anlar ve
  sonraki portu dener — alakasız bir sayfaya götürmez
- Sistem tepsisine ikon koyar (`app/tray.py`, saf ctypes): üstüne gelince o
  anki iş ve yüzdesi, iş bitince bildirim balonu; sol tık tarayıcıyı açar,
  sağ tık menüsünde Aç / Şarkı klasörü / Çıkış. Sunucu yan thread'de, tepsi
  ana thread'de — Win32 mesaj döngüsü pencereyi yaratan thread'e bağlı.
- Konsol yoksa (paketlenmiş sürüm) `stdout`/`stderr`'i `GgMix.log`'a bağlar;
  başlatma hatasını mesaj kutusuyla gösterir

Geliştirmede de çalışır: `.venv\Scripts\python.exe launcher.py`

### Yol çözümü

`app/paths.py` iki kökü ayırır. Karıştırılmamalı:

| | Nerede | İçinde ne var |
|---|---|---|
| `bundle_dir()` | pakette `_internal`, geliştirmede proje kökü | statik dosyalar, modeller — salt okunur |
| `data_dir()` | pakette exe'nin yanı, geliştirmede proje kökü | `songs/`, `stems/` — yazılabilir |

## Kaynaktan kurmak

```
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m pip install --no-deps -r requirements-nodeps.txt
```

İkinci satır `--no-deps` olmak zorunda: basic-pitch'in meta verisi
TensorFlow istiyor ve numpy'yi 1.26'ya düşürüp torch'u bozuyor. Biz ONNX
modelini kullanıyoruz; gereken bağımlılıklar `requirements.txt`'te.

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

- **Taşınabilir paket** — `build.py` ile tek klasör + ZIP, Python gerekmez,
  modeller gömülü, internetsiz çalışır

**Sırada**

- Akor şeridi — dalga formu boyunca akor dizisi
- Bölüm işaretleri (intro / verse / solo) ve döngüleri kaydetme
- Sayım metronomu
- Kanal ayarlarını şarkı başına hatırlama
- İsteğe bağlı: Inno Setup ile kurulum dosyası (Başlat menüsü, kaldırma)
