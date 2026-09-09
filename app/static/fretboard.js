'use strict';

/* Gitar klavyesi: parmak pozisyonu secimi ve cizim.

   ASIL ZORLUK CIZIM DEGIL, POZISYON SECIMI.

   Bir E4 notasi gitarda 6 farkli tel/perde kombinasyonunda calinabilir.
   Her notayi tek basina degerlendirip "en dusuk perde" secmek (eski
   yaklasim) gecerli ama gercekci olmayan pozisyonlar uretir: el surekli
   klavyenin bir ucundan otekine zipllar. Ogrenme aracinda bu yanlis
   aliskanlik kazandirir.

   Cozum: notalari tek tek degil, TUM DIZI BOYUNCA BIR YOL olarak secmek.
   Her nota olayi icin olasi parmak pozisyonlari dugum, ardisik olaylar
   arasindaki el hareketi ise gecis maliyeti. Dinamik programlama ile
   toplam maliyeti en aza indiren yolu buluyoruz (Viterbi).
*/

// Standart akort, kalindan inceye. MIDI perde numaralari.
const TUNING = [40, 45, 50, 55, 59, 64];      // E2 A2 D3 G3 B3 E4
const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];
const MAX_FRET = 22;
const COMFORT_SPAN = 4;        // elin zorlanmadan kapsadigi perde araligi
const EVENT_WINDOW = 0.06;     // bu kadar yakin baslayan notalar ayni olay

const MAXF = {
  optionsPerEvent: 14,         // olay basina tutulan aday sayisi
  enumCap: 600,                // kombinasyon patlamasina karsi tavan
};

/* Bir perdeyi calabilecek tum tel/perde ciftleri. */
function candidates(pitch) {
  const out = [];
  for (let s = 0; s < 6; s++) {
    const f = pitch - TUNING[s];
    if (f >= 0 && f <= MAX_FRET) out.push([s, f]);
  }
  return out;
}

/* Bir olaydaki notalari farkli tellere dagitan tum kombinasyonlar. */
function fingerings(pitches) {
  const cand = pitches.map(candidates);
  if (cand.some((c) => !c.length)) return [];
  const res = [];
  const cur = [];
  const used = new Set();
  (function rec(i) {
    if (res.length >= MAXF.enumCap) return;
    if (i === pitches.length) { res.push(cur.slice()); return; }
    for (const [s, f] of cand[i]) {
      if (used.has(s)) continue;      // bir tel ayni anda tek nota calar
      used.add(s); cur.push([s, f]);
      rec(i + 1);
      cur.pop(); used.delete(s);
    }
  })(0);
  return res;
}

/* Elin bulundugu perde (bos teller sayilmaz - onlar eli baglamaz). */
function handPos(fg) {
  const fretted = fg.filter((x) => x[1] > 0).map((x) => x[1]);
  if (!fretted.length) return null;
  return fretted.reduce((a, b) => a + b, 0) / fretted.length;
}

/* Pozisyonun kendi zorlugu: gerilme ve bos tel kolayligi. */
function localCost(fg) {
  const fretted = fg.filter((x) => x[1] > 0).map((x) => x[1]);
  const open = fg.length - fretted.length;
  let c = -0.35 * open;                       // bos tel kolay, odullendir
  if (fretted.length > 1) {
    const span = Math.max(...fretted) - Math.min(...fretted);
    if (span > COMFORT_SPAN) c += (span - COMFORT_SPAN) * 3.5;
  }
  return c;
}

/* Notalari es zamanli gruplara ayir. Ayni anda basilan notalar tek bir
   parmak pozisyonu olusturur; ardisik notalar ayri olaylardir. */
function buildEvents(notes) {
  const sorted = notes.map((n, i) => ({ i, t: n[0], p: n[2] }))
    .sort((a, b) => a.t - b.t);
  const events = [];
  for (const n of sorted) {
    const last = events[events.length - 1];
    if (last && n.t - last.t <= EVENT_WINDOW) {
      if (!last.pitches.includes(n.p)) { last.pitches.push(n.p); last.idx.push(n.i); }
      else last.idx.push(n.i);
    } else {
      events.push({ t: n.t, pitches: [n.p], idx: [n.i] });
    }
  }
  return events;
}

/* Tum sarki icin parmak pozisyonlarini sec.

   Donen dizi notalarla ayni sirada: her nota icin [tel, perde] ya da null.
*/
function assignFingerings(notes) {
  const out = new Array(notes.length).fill(null);
  const events = buildEvents(notes);
  if (!events.length) return out;

  let prev = null;   // [{fg, pos, cost, back}]
  const table = [];

  for (const ev of events) {
    let opts = fingerings(ev.pitches)
      .map((fg) => ({ fg, pos: handPos(fg), lc: localCost(fg) }));
    if (!opts.length) { table.push([]); prev = null; continue; }
    opts.sort((a, b) => a.lc - b.lc);
    opts = opts.slice(0, MAXF.optionsPerEvent);

    const layer = opts.map((o) => {
      let best = o.lc, back = -1;
      if (prev) {
        best = Infinity;
        for (let k = 0; k < prev.length; k++) {
          const q = prev[k];
          // El hareketi maliyeti. Iki taraftan biri tamamen bos tellerse
          // el zaten serbest, hareket cezasi yok.
          const move = (o.pos === null || q.pos === null)
            ? 0 : Math.abs(o.pos - q.pos);
          const c = q.cost + o.lc + move * 1.0;
          if (c < best) { best = c; back = k; }
        }
      }
      return { fg: o.fg, pos: o.pos === null && prev && back >= 0
        ? prev[back].pos : o.pos, cost: best, back };
    });
    table.push(layer);
    prev = layer;
  }

  // Geriye dogru en iyi yolu coz
  let k = -1;
  for (let li = table.length - 1; li >= 0; li--) {
    const layer = table[li];
    if (!layer.length) { k = -1; continue; }
    if (k < 0 || k >= layer.length) {
      k = layer.reduce((bi, o, i) => (o.cost < layer[bi].cost ? i : bi), 0);
    }
    const chosen = layer[k];
    const ev = events[li];
    ev.pitches.forEach((p, pi) => {
      const pair = chosen.fg[pi];
      for (const ni of ev.idx) if (notes[ni][2] === p) out[ni] = pair;
    });
    k = chosen.back;
  }
  return out;
}

/* Bir anda gercekten duyulan pozisyonlar.

   Notalar tek tel kisitiyla ES ZAMANLI gruplar icinde secildi, ama uzun
   suren bir nota hala tinlarken yeni bir nota baslayabiliyor ve ikisi
   farkli gruplarda oldugu icin ayni tele dusebiliyor. Gitarda bu
   imkansiz degil - teli tekrar kullanmak onceki notayi susturur - ama
   klavyede iki nokta gostermek yanlis olur. Telde en SON baslayan nota
   duyuluyor demektir.
*/
function activeAt(notes, fings, pos) {
  const byString = new Map();
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n[0] > pos || pos >= n[1]) continue;
    const f = fings[i];
    if (!f) continue;
    const cur = byString.get(f[0]);
    if (!cur || n[0] > cur.start) byString.set(f[0], { string: f[0], fret: f[1], start: n[0], i });
  }
  return [...byString.values()];
}

/* ====================================================================
   ÇİZİM
   ==================================================================== */

const DOT_FRETS = [3, 5, 7, 9, 15, 17, 19, 21];   // tek nokta isaretleri
const DOUBLE_DOT = [12];                           // cift nokta

/* Gorunecek perde penceresi. Tum boyu (0-22) gostermek dar kolonda
   noktalari okunmaz hale getiriyor; calinan bolgeye yakinlasiyoruz. */
function fretWindow(active, span = 7) {
  const fretted = active.filter((a) => a.fret > 0).map((a) => a.fret);
  if (!fretted.length) return [0, span];
  const lo = Math.min(...fretted), hi = Math.max(...fretted);
  let from = Math.max(0, Math.min(lo - 1, 22 - span));
  let to = Math.max(from + span, hi + 1);
  if (to > MAX_FRET) { to = MAX_FRET; from = Math.max(0, to - span); }
  return [from, to];
}

function drawFretboard(cv, opts) {
  const { active = [], window: win = [0, 7], color = '#ffb347', dim = '#3a4152' } = opts;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const padL = 22, padR = 10, padT = 14, padB = 18;
  const [f0, f1] = win;
  const nF = Math.max(1, f1 - f0);
  const bw = (w - padL - padR) / nF;          // perde genisligi
  const bh = (h - padT - padB) / 5;           // tel araligi
  const yOf = (s) => padT + (5 - s) * bh;     // s=0 kalin E altta
  const xOf = (f) => padL + (f - f0) * bw;

  // perde isaretleri (nokta)
  c.fillStyle = '#242833';
  for (let f = f0 + 1; f <= f1; f++) {
    const cx = xOf(f) - bw / 2, cy = padT + bh * 2.5;
    if (DOUBLE_DOT.includes(f)) {
      c.beginPath(); c.arc(cx, cy - bh * 0.9, 4, 0, 7); c.fill();
      c.beginPath(); c.arc(cx, cy + bh * 0.9, 4, 0, 7); c.fill();
    } else if (DOT_FRETS.includes(f)) {
      c.beginPath(); c.arc(cx, cy, 4.5, 0, 7); c.fill();
    }
  }

  // perde telleri (dikey)
  for (let f = f0; f <= f1; f++) {
    const x = xOf(f);
    const nut = f === 0;
    c.strokeStyle = nut ? '#8a93a6' : '#333a49';
    c.lineWidth = nut ? 3 : 1.5;
    c.beginPath(); c.moveTo(x, padT - 4); c.lineTo(x, padT + bh * 5 + 4); c.stroke();
  }

  // teller (yatay) - kalin teller daha kalin cizgi
  for (let s = 0; s < 6; s++) {
    const y = yOf(s);
    c.strokeStyle = dim;
    c.lineWidth = 0.7 + (5 - s) * 0.32;
    c.beginPath(); c.moveTo(padL, y); c.lineTo(w - padR, y); c.stroke();
    c.fillStyle = '#5b6273';
    c.font = '10px ui-monospace,Consolas,monospace';
    c.textAlign = 'right'; c.textBaseline = 'middle';
    c.fillText(STRING_NAMES[s], padL - 6, y);
  }

  // perde numaralari
  c.fillStyle = '#4c5464';
  c.font = '9.5px ui-monospace,Consolas,monospace';
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (let f = f0 + 1; f <= f1; f++) {
    c.fillText(String(f), xOf(f) - bw / 2, padT + bh * 5 + 5);
  }

  // basili notalar
  for (const a of active) {
    const y = yOf(a.string);
    const x = a.fret === 0 ? padL - 1 : xOf(a.fret) - bw / 2;
    const r = Math.min(11, bh * 0.44, bw * 0.42);
    c.beginPath(); c.arc(x, y, r + 3, 0, 7);
    c.fillStyle = color + '33'; c.fill();          // hale
    c.beginPath(); c.arc(x, y, r, 0, 7);
    c.fillStyle = a.fret === 0 ? '#15171d' : color;
    c.strokeStyle = color; c.lineWidth = 2;
    c.fill(); c.stroke();
    if (r >= 7) {
      c.fillStyle = a.fret === 0 ? color : '#191308';
      c.font = `600 ${Math.round(r * 0.95)}px ui-sans-serif,Segoe UI,sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(a.fret), x, y + 0.5);
    }
  }
}

window.Fretboard = { TUNING, STRING_NAMES, MAX_FRET, assignFingerings,
                     activeAt, fretWindow, drawFretboard };
