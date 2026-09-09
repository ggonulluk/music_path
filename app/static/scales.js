'use strict';

/* Gam kutuphanesi: tanimlar, derece etiketleri, diyatonik akorlar,
   pentatonik kutulari.

   Sadece veri ve muzik teorisi - cizim fretboard.js'te, arayuz app.js'te.
*/

const SC_PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_REF = [0, 2, 4, 5, 7, 9, 11];   // derece adlandirmasi icin olcut

const SCALES = [
  // --- temel: rock/blues calan birinin %90 kullandigi
  { id: 'major',   name: 'Majör',            steps: [0, 2, 4, 5, 7, 9, 11], group: 'Temel' },
  { id: 'minor',   name: 'Doğal minör',      steps: [0, 2, 3, 5, 7, 8, 10], group: 'Temel' },
  { id: 'pentmaj', name: 'Majör pentatonik', steps: [0, 2, 4, 7, 9],        group: 'Temel', parent: 'major', caged: true },
  { id: 'pentmin', name: 'Minör pentatonik', steps: [0, 3, 5, 7, 10],       group: 'Temel', parent: 'minor', caged: true },
  { id: 'blues',   name: 'Blues',            steps: [0, 3, 5, 6, 7, 10],    group: 'Temel', parent: 'minor', caged: true },
  // --- modlar (Ionian = majör, Aeolian = dogal minör zaten yukarida)
  { id: 'dorian',  name: 'Dorian',           steps: [0, 2, 3, 5, 7, 9, 10], group: 'Modlar' },
  { id: 'phryg',   name: 'Frigian',          steps: [0, 1, 3, 5, 7, 8, 10], group: 'Modlar' },
  { id: 'lydian',  name: 'Lidyan',           steps: [0, 2, 4, 6, 7, 9, 11], group: 'Modlar' },
  { id: 'mixo',    name: 'Miksolidyan',      steps: [0, 2, 4, 5, 7, 9, 10], group: 'Modlar' },
  { id: 'locrian', name: 'Lokrian',          steps: [0, 1, 3, 5, 6, 8, 10], group: 'Modlar' },
  // --- ileri
  { id: 'harmmin', name: 'Harmonik minör',   steps: [0, 2, 3, 5, 7, 8, 11], group: 'İleri' },
  { id: 'melmin',  name: 'Melodik minör',    steps: [0, 2, 3, 5, 7, 9, 11], group: 'İleri' },
  { id: 'phrydom', name: 'Frigian dominant', steps: [0, 1, 4, 5, 7, 8, 10], group: 'İleri' },
];

const SCALE_NOTE = {
  major: 'Neşeli, açık. Pop ve country\'nin temeli.',
  minor: 'Rock ve pop\'un minör tarafı. Doğal minör = Aeolian modu.',
  pentmaj: 'Majörün 5 notası; yarım ton gerilimleri yok, her akorun üstünde durur.',
  pentmin: 'Rock ve blues solosunun belkemiği. En çok kullanılan gam.',
  blues: 'Minör pentatonik + b5 "blue note". O tek nota tınıyı tamamen değiştirir.',
  dorian: 'Minör ama 6\'sı natürel — daha aydınlık. Santana, funk, modal caz.',
  phryg: 'b2 gerilimi. Metal ve İspanyol tınısı.',
  lydian: '#4 ile hayali, uçuk bir renk. Vai, Satriani.',
  mixo: 'Majör ama b7 — dominant akorların gamı. Blues-rock.',
  locrian: 'b2 ve b5 birlikte; kararsız. Nadiren tek başına kullanılır.',
  harmmin: 'Doğal minörün 7\'si yükseltilmiş. V akoru majör olur, çekim güçlenir.',
  melmin: 'Caz minörü. Minör ama 6 ve 7 natürel.',
  phrydom: 'Harmonik minörün 5. modu. İspanyol/Orta Doğu tınısının kaynağı.',
};

const byId = (id) => SCALES.find((s) => s.id === id);

/* Derece etiketleri: aralik -> "1", "b3", "#4"...

   7 notali gamlarda derece adi ARALIKTAN DEGIL GAMDAKI KONUMDAN gelir.
   Lokrian'in 8. yarim tonu b6'dir, #5 degil - cunku majörün 6. derecesinin
   pesleştirilmiş hali. Sadece araliga bakan bir kural burada yaniliyordu.
   Konumu majör olcutuyle karsilastirip isareti buradan cikariyoruz.

   Pentatonik ve blues 7 notali olmadigi icin konum-derece esleşmesi
   kurulamaz; orada araliga gore adlandiriyoruz. */
const IV_NAME = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];

function degreeMap(steps) {
  const m = new Map();
  if (steps.length === 7) {
    steps.forEach((s, i) => {
      const diff = s - MAJOR_REF[i];
      m.set(s, (diff < 0 ? 'b' : diff > 0 ? '#' : '') + (i + 1));
    });
  } else {
    const set = new Set(steps);
    for (const s of steps) {
      // 6. yarim ton: gamda 4'lu varsa b5 (blues), yoksa #4
      m.set(s, s === 6 && !set.has(5) ? '#4' : IV_NAME[s]);
    }
  }
  return m;
}

function noteNames(root, steps) {
  return steps.map((s) => SC_PC[(root + s) % 12]);
}

function degrees(steps) {
  const m = degreeMap(steps);
  return steps.map((s) => m.get(s));
}

/* Gamın diyatonik akorları: her derecenin üstüne gam içinden üçlü kur.

   Sadece 7 notali gamlar icin anlamli. Pentatonik ve blues icin
   `parent` alanindaki ana gamin akorlari kullanilir - pentatonikle
   solo yaparken altta calan akorlar zaten o gamdan gelir. */
function diatonicChords(root, scale) {
  const sc = scale.steps.length === 7 ? scale : byId(scale.parent || '');
  if (!sc || sc.steps.length !== 7) return null;
  const st = sc.steps;
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const out = [];
  for (let i = 0; i < 7; i++) {
    const r = (root + st[i]) % 12;
    const third = (st[(i + 2) % 7] - st[i] + 12) % 12;
    const fifth = (st[(i + 4) % 7] - st[i] + 12) % 12;

    let suf = '', rom = ROMAN[i], quality = 'major';
    if (third === 3 && fifth === 7) { suf = 'm'; rom = rom.toLowerCase(); quality = 'minor'; }
    else if (third === 3 && fifth === 6) { suf = 'dim'; rom = rom.toLowerCase() + '°'; quality = 'dim'; }
    else if (third === 4 && fifth === 8) { suf = 'aug'; rom = rom + '+'; quality = 'aug'; }
    else if (third !== 4 || fifth !== 7) { suf = 'sus'; quality = 'other'; }

    // Kromatik degisiklik: majör gama gore yarim ton asagi/yukari mi
    const diff = st[i] - MAJOR_REF[i];
    if (diff === -1) rom = 'b' + rom;
    else if (diff === 1) rom = '#' + rom;

    out.push({ name: SC_PC[r] + suf, roman: rom, quality, degree: i + 1 });
  }
  return { chords: out, from: sc.id !== scale.id ? sc.name : null };
}

/* Pentatonik kutulari (CAGED).

   Kutu 1 kalin E telinde kok notanin bulundugu perdede baslar; sonraki
   kutular gamın o teldeki sonraki notalarindan. A minör pentatonikte
   bu 5-8-10-12-15 verir, yani gitaristin ezberledigi klasik dizilim. */
function pentatonicBoxes(root, steps) {
  const LOW_E = 40;
  const set = new Set(steps.map((s) => (root + s) % 12));
  let start = 0;
  while (start < 12 && (LOW_E + start) % 12 !== ((root % 12) + 12) % 12) start++;
  const out = [];
  for (let f = start; f <= start + 16 && out.length < 5; f++) {
    if (set.has((LOW_E + f) % 12)) {
      out.push({ n: out.length + 1, from: f, to: Math.min(f + 3, 22) });
    }
  }
  return out;
}

/* Gamın klavye uzerindeki tum noktalari. */
function fretMarks(root, steps, maxFret = 15) {
  const TUN = [40, 45, 50, 55, 59, 64];
  const m = degreeMap(steps);
  const marks = [];
  for (let s = 0; s < 6; s++) {
    for (let f = 0; f <= maxFret; f++) {
      const iv = (((TUN[s] + f) - root) % 12 + 12) % 12;
      if (!m.has(iv)) continue;
      marks.push({ string: s, fret: f, label: m.get(iv), root: iv === 0 });
    }
  }
  return marks;
}

/* ====================================================================
   AKOR BASILIŞLARI (voicing)

   Bir akoru gitarda calmanin onlarca yolu var. Isin zorlugu hangilerinin
   GERCEKTEN BASILABILIR ve gitaristin taniyacagi sekiller oldugunu
   bulmak. Uc kisit birlikte calisiyor:

     1. Akorun butun sesleri bulunmali (kok, ucl u, besli)
     2. El acikligi 4 perdeyi gecmemeli
     3. Parmak sayisi 4'u gecmemeli - gecerse barre gerekir, barre de
        ancak bos tel yoksa ve en dusuk perdede birden fazla tel varsa
        mumkun

   Puanlama gercek gitar tercihlerini taklit ediyor: kok notanin basta
   olmasi, cok telin duymasi, bos tel kullanmak ve dusuk pozisyon iyi;
   ic susturma (ortadaki telin susturulmasi), cok parmak ve barre kotu.
   ==================================================================== */

const TUN6 = [40, 45, 50, 55, 59, 64];

/* Barre gerekiyor mu?

   Ayni perdeye basilmis iki telin ARASINDA daha yuksek perdeye basilmis
   bir tel varsa, o iki teli ayri parmaklarla tutmak mumkun degil -
   parmaklar birbirinin uzerinden gecmek zorunda kalir. Tek cozum isaret
   parmagini boydan boya yatirmak, yani barre. */
function barreFret(v) {
  const byFret = new Map();
  v.forEach((f, s) => {
    if (f === null || f === 0) return;
    if (!byFret.has(f)) byFret.set(f, []);
    byFret.get(f).push(s);
  });
  for (const [f, ss] of byFret) {
    for (let i = 0; i < ss.length - 1; i++) {
      for (let s = ss[i] + 1; s < ss[i + 1]; s++) {
        if (v[s] !== null && v[s] > f) return f;
      }
    }
  }
  return 0;
}

/* Parmak maliyeti. null = calinamaz. */
function fingerCost(v) {
  const fretted = v.filter((f) => f !== null && f > 0);
  if (!fretted.length) return { fingers: 0, barre: 0 };
  const minF = Math.min(...fretted);
  const bf = barreFret(v);

  if (bf) {
    // Barre ancak sekildeki EN DUSUK perdede kurulabilir - daha yukarida
    // kurulsa altindaki notalari susturur
    if (bf !== minF) return null;
    // Barre araliginda bos tel olamaz; isaret parmagi onu da bastirir
    const ss = [];
    v.forEach((f, s) => { if (f === bf) ss.push(s); });
    for (let s = ss[0]; s <= ss[ss.length - 1]; s++) {
      if (v[s] === 0) return null;
    }
    const above = fretted.filter((f) => f > bf).length;
    return 1 + above <= 4 ? { fingers: 1 + above, barre: bf } : null;
  }

  return fretted.length <= 4 ? { fingers: fretted.length, barre: 0 } : null;
}

function scoreVoicing(v, root, intervals) {
  const idx = [];
  for (let s = 0; s < 6; s++) if (v[s] !== null) idx.push(s);
  if (idx.length < 3) return null;

  const pcs = new Set(idx.map((s) => (TUN6[s] + v[s]) % 12));
  for (const i of intervals) if (!pcs.has((root + i) % 12)) return null;  // eksik ses

  const fc = fingerCost(v);
  if (!fc) return null;

  const fretted = idx.map((s) => v[s]).filter((f) => f > 0);
  if (fretted.length > 1 && Math.max(...fretted) - Math.min(...fretted) > 4) return null;

  // Ortadaki tellerin susturulmasi zor ve kulakta bosluk birakir
  const interiorMutes = (idx[idx.length - 1] - idx[0] + 1) - idx.length;

  const opens = idx.filter((s) => v[s] === 0).length;
  const minF = fretted.length ? Math.min(...fretted) : 0;
  const span = fretted.length > 1 ? Math.max(...fretted) - minF : 0;

  // Dolgunluk: 6 tel 5'ten belirgin iyi degil, ama 3 tel zayif
  let sc = [0, 0, 0, 0, 1.2, 2.4, 3.6][idx.length] ?? 0;
  if ((TUN6[idx[0]] + v[idx[0]]) % 12 === root % 12) sc += 3;   // kok basta
  sc -= interiorMutes * 3.5;                    // ortadaki teli susturmak zor, kulakta bosluk
  sc -= fc.fingers * 1.0;                       // az parmak cok deger
  sc -= span * 0.5;                             // gerilme: 502220 ile x02220 farki burada
  if (fc.barre) sc -= 0.2;                      // barre standart, agir cezalandirilmamali
  sc += opens * 0.5;

  // Bos telle yuksek perdeyi birlestirmek deyimsel degil: "875050" teknik
  // olarak basilabilir ama kimse C'yi boyle calmaz.
  if (opens && minF > 3) sc -= 6;

  return { score: sc, ...fc, strings: idx.length, span };
}

/* Bir akorun basilis sekilleri, iyiden kotuye. */
function chordVoicings(root, intervals, limit = 5) {
  const tones = new Set(intervals.map((i) => (root + i) % 12));
  const seen = new Set();
  const all = [];

  for (let p = 0; p <= 12; p++) {
    const cand = [];
    for (let s = 0; s < 6; s++) {
      const c = [null];
      if (tones.has(TUN6[s] % 12)) c.push(0);                  // bos tel
      for (let f = Math.max(p, 1); f <= p + 3; f++) {
        if (tones.has((TUN6[s] + f) % 12)) c.push(f);
      }
      cand.push(c);
    }
    const v = new Array(6);
    (function rec(s) {
      if (s === 6) {
        const r = scoreVoicing(v, root, intervals);
        if (!r) return;
        const key = v.join(',');
        if (seen.has(key)) return;
        seen.add(key);
        all.push({ frets: v.slice(), ...r });
        return;
      }
      for (const f of cand[s]) { v[s] = f; rec(s + 1); }
    })(0);
  }

  /* Once HER POZISYONUN kendi en iyisini sec, sonra pozisyonlari
     sirayla goster.

     "Genel olarak en iyi sekil" siralamasi kirilgandi: bir pozisyondaki
     kanonik sekil, baska pozisyondaki dolgun bir barre'a puan farkiyla
     yeniliyor ve listeden dusuyordu. Oysa amac zaten alternatif
     POZISYONLAR gostermek - her pozisyonda o pozisyonun dogru seklini
     secmek cok daha saglam bir karar. */
  const best = new Map();
  for (const v of all) {
    const fr = v.frets.filter((f) => f !== null && f > 0);
    const pos = fr.length ? Math.min(...fr) : 0;
    const cur = best.get(pos);
    if (!cur || v.score > cur.score) best.set(pos, { ...v, position: pos });
  }

  /* Perde boyunca yay, ama ONCE PUANA gore sec.

     En dusuk pozisyondan baslayip yaymak yanlisti: 0. pozisyondaki zayif
     bir yarim akor (orn. "xx000x") 2. perdedeki kanonik G'yi engelliyordu.
     Iyi olani once alip cevresini kapatmak dogru sonucu veriyor. */
  const taken = [];
  for (const v of [...best.values()].sort((a, b) => b.score - a.score)) {
    // Puan tabani: bir pozisyonda sadece kotu bir sekil varsa hic
    // gostermemek, "0-15-x-0-x-x" gibi kimsenin calmayacagi bir seyi
    // alternatif diye sunmaktan iyi
    if (v.score < -2) continue;
    if (taken.some((t) => Math.abs(t.position - v.position) < 3)) continue;
    taken.push(v);
    if (taken.length >= limit) break;
  }
  return taken.sort((a, b) => a.position - b.position);
}

/* Basilis sekli -> "x32010" gosterimi (10+ perdeler tire ile ayrilir). */
function voicingText(frets) {
  const s = frets.map((f) => (f === null ? 'x' : String(f)));
  return s.some((x) => x.length > 1) ? s.join('-') : s.join('');
}

window.Scales = {
  chordVoicings, voicingText,
  SCALES, SCALE_NOTE, PC: SC_PC, byId,
  noteNames, degrees, diatonicChords, pentatonicBoxes, fretMarks,
};
