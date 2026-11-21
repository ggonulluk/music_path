/* Nota dizisinden MusicXML (gitar tabi) uretir.

   Guitar Pro 7/8, TuxGuitar ve MuseScore MusicXML aciyor; tel/perde
   bilgisi <technical><string>/<fret> ile tasiniyor. .gp5'i dogrudan
   yazan kutuphane (PyGuitarPro) LGPL oldugu icin kullanilmadi, ayrica
   MusicXML'i daha cok program okuyor.

   ASIL IS KUANTIZASYON. Model notalari saniye olarak veriyor; tab ise
   olcu ve nota suresi ister. Her zaman, vurus izgarasinda kesirli bir
   vurus konumuna cevriliyor (iki vurus arasi dogrusal) ve onaltiliga
   yuvarlaniyor. Vurus = dortluk varsayiliyor.

   Basitlestirmeler (bilincli):
   - Tek ses (voice). Ayni onaltiliga dusen notalar akor oluyor; akorun
     suresi bir sonraki olaya kadar.
   - Olcu turu sabit (4/4 ya da 3/4), tempo sabit (izgaranin ortanca
     araligi). Tempo degisen kayitlarda Guitar Pro'nun calmasi kayar ama
     notalar dogru olcude durur.

   Saf fonksiyon, DOM kullanmiyor: Node'da da test edilebiliyor. Kendi
   kapsaminda: fretboard.js ile ayni sayfada isim cakismasin (TUNING vb.).
*/
(function () {
'use strict';

const DIV = 4;                        // dortluk basina birim (onaltilik)
const STEP = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
const ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
// Sure (birim) -> [tip, noktali mi]. Listede olmayanlar bagla bolunur.
const TYPES = [[16, 'whole', 0], [12, 'half', 1], [8, 'half', 0], [6, 'quarter', 1],
               [4, 'quarter', 0], [3, 'eighth', 1], [2, 'eighth', 0], [1, '16th', 0]];
const TUNING = [40, 45, 50, 55, 59, 64];   // fretboard.js ile ayni
const FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
                 F: -1, 'A#': -2, 'D#': -3, 'G#': -4 };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Saniye -> izgaradaki kesirli vurus indeksi. */
function beatPos(t, beats) {
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  let lo = 0, hi = beats.length - 1;
  if (t >= beats[hi]) return hi + (t - beats[hi]) / (beats[hi] - beats[hi - 1]);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid; else hi = mid;
  }
  return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
}

/* Bir sureyi yazilabilir parcalara bol (buyukten kucuge). */
function splitDur(d) {
  const out = [];
  while (d > 0) {
    const t = TYPES.find((x) => x[0] <= d);
    out.push(t);
    d -= t[0];
  }
  return out;
}

/* SADELESTIRME: tabdaki kalabalik yigilmalari azaltir.

   Olculdu (Tarantula, Yagdir Gunahlari): notalarin ~%9'u 4+ notali
   es zamanli gruplarda. Iki kaynak var ve ikisi de burada ele aliniyor:
     1. Zayif notalar - ayni anda baslayan grubun en guclu notasinin cok
        altinda kalanlar. Cogunlukla sizinti ya da harmonik, calinan nota
        degil.
     2. Hayalet notalar - hem cok kisa hem zayif olanlar.
   Ucuncu kaynak (birbirine yakin notalarin ayni onaltiliga yuvarlanip
   akor olmasi) yalnizca MusicXML'de olusuyor; onu quantize'daki
   maxChord siniri ele aliyor.

   Saf fonksiyon: ham notalara dokunmaz, yeni dizi doner. Ekran ve
   disa aktarim ayni sonucu kullanir ki gorulen ile inen ayni olsun.
*/
const SIMPLE = {
  window: 0.06,       // bu kadar yakin baslayanlar ayni grup (fretboard.js ile ayni)
  relAmp: 0.75,       // grubun en guclusunun bu oranindan zayiflar atilir
  maxChord: 4,        // grup basina en fazla nota (en gucluler kalir)
  ghostDur: 0.09,     // bundan kisa VE...
  ghostAmp: 0.45,     // ...bundan zayif notalar hayalet sayilir
};

function simplify(notes, o = SIMPLE) {
  const out = [];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const top = Math.max(...group.map((n) => n[3]));
    const seen = new Set();
    group
      .filter((n) => n[3] >= top * o.relAmp)
      .filter((n) => !(n[1] - n[0] < o.ghostDur && n[3] < o.ghostAmp))
      .sort((a, b) => b[3] - a[3])
      .filter((n) => !seen.has(n[2]) && seen.add(n[2]))
      .slice(0, o.maxChord)
      .forEach((n) => out.push(n));
    group = [];
  };
  for (const n of notes) {
    if (group.length && n[0] - group[0][0] > o.window) flush();
    group.push(n);
  }
  flush();
  return out.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
}

/* Notalari izgaraya oturt: [{q, len, notes:[{pitch, string, fret}]}] (birim).
   maxChord: ayni onaltiliga dusen notalardan en fazla kacinin kalacagi. */
function quantize(notes, fings, beats, origin, maxChord = Infinity) {
  const byQ = new Map();
  notes.forEach((n, i) => {
    const f = fings[i];
    if (!f) return;
    const q = Math.round((beatPos(n[0], beats) - origin) * DIV);
    const e = Math.round((beatPos(n[1], beats) - origin) * DIV);
    if (q < 0) return;
    let ev = byQ.get(q);
    if (!ev) { ev = { q, len: 1, notes: [] }; byQ.set(q, ev); }
    ev.len = Math.max(ev.len, e - q, 1);
    // Ayni tel ayni anda tek nota calar: celisirse guclu olan kalir
    const amp = n[3] || 0;
    const clash = ev.notes.filter((x) => x.string === f[0] || x.pitch === n[2]);
    if (clash.some((x) => x.amp > amp)) return;
    ev.notes = ev.notes.filter((x) => !clash.includes(x));
    ev.notes.push({ pitch: n[2], string: f[0], fret: f[1], amp });
  });
  const evs = [...byQ.values()].sort((a, b) => a.q - b.q);
  for (let i = 0; i < evs.length; i++) {
    const next = evs[i + 1];
    if (next) evs[i].len = Math.min(evs[i].len, next.q - evs[i].q);
    if (evs[i].notes.length > maxChord) {
      evs[i].notes = evs[i].notes.sort((a, b) => b.amp - a.amp).slice(0, maxChord);
    }
    evs[i].notes.sort((a, b) => a.string - b.string);
  }
  return evs;
}

function parseChord(name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(name || '');
  if (!m) return null;
  const kind = m[2] === '' ? 'major' : m[2] === 'm' ? 'minor' : m[2] === '5' ? 'power' : 'other';
  return { step: m[1][0], alter: m[1][1] === '#' ? 1 : m[1][1] === 'b' ? -1 : 0,
           kind, text: m[2] };
}

function noteXML(dur, type, dot, n, chord, tie) {
  const p = n.pitch;
  let x = '<note>';
  if (chord) x += '<chord/>';
  x += `<pitch><step>${STEP[p % 12]}</step>${ALTER[p % 12] ? '<alter>1</alter>' : ''}` +
       `<octave>${Math.floor(p / 12) - 1}</octave></pitch>`;
  x += `<duration>${dur}</duration>`;
  if (tie.stop) x += '<tie type="stop"/>';
  if (tie.start) x += '<tie type="start"/>';
  x += `<voice>1</voice><type>${type}</type>${dot ? '<dot/>' : ''}<notations>`;
  if (tie.stop) x += '<tied type="stop"/>';
  if (tie.start) x += '<tied type="start"/>';
  // MusicXML'de 1 = en ince tel; bizde 0 = en kalin
  x += `<technical><string>${6 - n.string}</string><fret>${n.fret}</fret></technical>`;
  return x + '</notations></note>';
}

/* opts: { title, notes, fings, beats, downbeat, perBar, chords, key, maxChord } */
function build(opts) {
  const { title = 'GgMix', notes, fings, beats, downbeat = 0,
          perBar = 4, chords = [], key = null, maxChord = Infinity } = opts;
  if (!beats || beats.length < 2) throw new Error('vuruş ızgarası yok');
  const barLen = perBar * DIV;
  const evs = quantize(notes, fings, beats, downbeat, maxChord);
  const last = evs.length ? evs[evs.length - 1] : { q: 0, len: 0 };
  const total = Math.max(1, Math.ceil((last.q + last.len) / barLen));

  // Akor degisimleri (birim konum), tekrar edenler atilarak
  const harm = [];
  for (const [t, , name] of chords) {
    const q = Math.round((beatPos(t, beats) - downbeat) * DIV);
    if (q < 0 || (harm.length && harm[harm.length - 1].name === name)) continue;
    harm.push({ q, name });
  }

  // Zaman cizelgesi: olay ya da sessizlik parcalari, olcu sinirinda bolunmus
  const timeline = [];
  let cur = 0;
  for (const ev of evs) {
    if (ev.q > cur) timeline.push({ q: cur, len: ev.q - cur, rest: true });
    timeline.push({ q: ev.q, len: ev.len, notes: ev.notes });
    cur = ev.q + ev.len;
  }
  if (cur < total * barLen) timeline.push({ q: cur, len: total * barLen - cur, rest: true });

  const step = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b);
  const bpm = Math.round(60 / step[step.length >> 1]);
  const fifths = key && FIFTHS[key.root] !== undefined
    ? FIFTHS[key.root] - (key.mode === 'minor' ? 3 : 0) : 0;

  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" ' +
    '"http://www.musicxml.org/dtds/partwise.dtd">\n' +
    '<score-partwise version="3.1">' +
    `<work><work-title>${esc(title)}</work-title></work>` +
    '<identification><encoding><software>GgMix</software></encoding></identification>' +
    '<part-list><score-part id="P1"><part-name>Gitar</part-name>' +
    '<score-instrument id="P1-I1"><instrument-name>Gitar</instrument-name></score-instrument>' +
    '<midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>26</midi-program></midi-instrument>' +
    '</score-part></part-list><part id="P1">';

  let ti = 0, hi = 0;
  for (let m = 0; m < total; m++) {
    const m0 = m * barLen, m1 = m0 + barLen;
    xml += `<measure number="${m + 1}">`;
    if (m === 0) {
      xml += `<attributes><divisions>${DIV}</divisions><key><fifths>${fifths}</fifths></key>` +
        `<time><beats>${perBar}</beats><beat-type>4</beat-type></time>` +
        '<clef><sign>TAB</sign><line>5</line></clef><staff-details><staff-lines>6</staff-lines>' +
        TUNING.map((p, i) => `<staff-tuning line="${i + 1}"><tuning-step>${STEP[p % 12]}</tuning-step>` +
          `<tuning-octave>${Math.floor(p / 12) - 1}</tuning-octave></staff-tuning>`).join('') +
        '</staff-details></attributes>' +
        `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>` +
        `<per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`;
    }
    let pos = m0;
    // Bu olcuye dusen parcalari olcu sinirinda kirparak yaz
    while (pos < m1 && ti < timeline.length) {
      const seg = timeline[ti];
      const segEnd = seg.q + seg.len;
      if (segEnd <= pos) { ti++; continue; }
      const a = Math.max(seg.q, pos), b = Math.min(segEnd, m1);

      // Olcu icindeki akor degisimleri; sessizligi o noktada bol
      while (hi < harm.length && harm[hi].q < b) {
        const h = harm[hi];
        const c = parseChord(h.name);
        if (c) {
          const off = Math.max(0, h.q - a);
          xml += `<harmony><root><root-step>${c.step}</root-step>` +
            (c.alter ? `<root-alter>${c.alter}</root-alter>` : '') + '</root>' +
            `<kind${c.kind === 'other' ? ` text="${esc(c.text)}"` : ''}>${c.kind}</kind>` +
            (off ? `<offset>${off}</offset>` : '') + '</harmony>';
        }
        hi++;
      }

      const parts = splitDur(b - a);
      parts.forEach(([d, type, dot], pi) => {
        if (seg.rest) {
          xml += b - a === barLen && a === m0
            ? `<note><rest measure="yes"/><duration>${d}</duration><voice>1</voice></note>`
            : `<note><rest/><duration>${d}</duration><voice>1</voice><type>${type}</type>${dot ? '<dot/>' : ''}</note>`;
          return;
        }
        const tie = { stop: a > seg.q || pi > 0, start: b < segEnd || pi < parts.length - 1 };
        seg.notes.forEach((n, ni) => { xml += noteXML(d, type, dot, n, ni > 0, tie); });
      });
      pos = b;
      if (b >= segEnd) ti++;
    }
    xml += '</measure>';
  }
  return xml + '</part></score-partwise>\n';
}

const MusicXML = { build, quantize, simplify, SIMPLE, beatPos, splitDur, DIV };
if (typeof module !== 'undefined') module.exports = MusicXML;
else window.MusicXML = MusicXML;
}());
