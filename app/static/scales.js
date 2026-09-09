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

window.Scales = {
  SCALES, SCALE_NOTE, PC: SC_PC, byId,
  noteNames, degrees, diatonicChords, pentatonicBoxes, fretMarks,
};
