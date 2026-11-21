/* Tab ekrani: sarki calarken gitar tabi, ustunde akorlar ve nota adlari akar.

   ANA OYNATICIDAN BAGIMSIZ. Ses motoru (SignalsmithStretch, 6 kanal) yerine
   tek bir <audio> ogesi kullaniyor: tarayicinin kendi hiz degistirmesi
   perdeyi koruyor (preservesPitch) ve 6 kanali bellege cozmek gerekmiyor.
   Ana ekrandan yalnizca fretboard.js'in parmak pozisyonu secimi (ayni
   tel/perde kararlari) ve sunucunun API'si paylasiliyor.

   Zaman ekseni sola akiyor; oynatma cizgisi sabit. Tab'daki sayilar
   modelin notalarinin GERCEK zamanlari (kuantize edilmemis); olcu
   cizgileri vurus izgarasindan. MusicXML disa aktarimi ise notalari
   bu izgaraya oturtuyor (musicxml.js).

   Kendi kapsaminda: fretboard.js'in global fonksiyonlarini (buildEvents
   vb.) ezmemesi icin.
*/
(function () {
'use strict';

const $ = (s) => document.querySelector(s);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (p) => NAMES[p % 12] + (Math.floor(p / 12) - 1);
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const T = {
  song: null, notes: [], fings: [], events: [], chords: [], key: null,
  beatsRaw: null, downRaw: 0,
  grid: null, down: 0,                          // ayarlar uygulanmis izgara
  perBar: 4, tempoMul: 1, shift: 0,
  au: new Audio(), mode: 'source', mixUrl: null, modeReq: 0,
  pps: 160, names: true,
  clock: { t: 0, at: 0, seen: -1 },
  raf: 0, poll: null,
};
T.au.preload = 'auto';
T.au.preservesPitch = true;
window.GgTab = T;            // hata ayiklama: konsoldan durumu gormek icin

const api = (u, o) => fetch(u, o);

/* ------------------------------------------------------------ ayarlar */

function settingsKey() { return 'ggmix-tab-' + T.song.id; }

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(settingsKey()) || '{}');
    if ([3, 4].includes(s.perBar)) T.perBar = s.perBar;
    if ([0.5, 1, 2].includes(s.tempoMul)) T.tempoMul = s.tempoMul;
    if (Number.isInteger(s.shift)) T.shift = s.shift;
  } catch (e) { /* tarayici depolamasi kapali olabilir */ }
  $('#tb-meter').value = String(T.perBar);
  $('#tb-tempo').value = String(T.tempoMul);
}

function saveSettings() {
  try {
    localStorage.setItem(settingsKey(),
      JSON.stringify({ perBar: T.perBar, tempoMul: T.tempoMul, shift: T.shift }));
  } catch (e) { /* yok say */ }
}

/* Ham vurus izgarasina tempo ve olcu basi ayarlarini uygula. */
function rebuildGrid() {
  if (!T.beatsRaw) return;
  let grid = T.beatsRaw, down = T.downRaw;
  if (T.tempoMul === 0.5) {
    // Olcu basini koruyarak her ikinci vurusu al
    const par = down % 2;
    grid = grid.filter((_, i) => i % 2 === par);
    down = (down - par) / 2;
  } else if (T.tempoMul === 2) {
    const g = [];
    grid.forEach((b, i) => { g.push(b); if (i < grid.length - 1) g.push((b + grid[i + 1]) / 2); });
    grid = g;
    down *= 2;
  }
  const n = T.perBar;
  T.grid = grid;
  T.down = (((down + T.shift) % n) + n) % n;
}

/* ------------------------------------------------------------ saat */

/* audio.currentTime kaba guncellenebiliyor; aradaki kareleri
   performance.now ile dolduruyoruz ki tab titremeden aksin. */
function now() {
  const ct = T.au.currentTime;
  const c = T.clock;
  const wall = performance.now() / 1000;
  if (ct !== c.seen) { c.seen = ct; c.t = ct; c.at = wall; }
  if (T.au.paused) return ct;
  const t = c.t + (wall - c.at) * T.au.playbackRate;
  return Math.abs(t - ct) > 0.3 ? ct : t;
}

/* ------------------------------------------------------------ ses */

function srcFor(mode) {
  const id = T.song.id;
  if (mode === 'gitar') return `/audio/${id}/gitar`;
  if (mode === 'nogitar') return T.mixUrl;
  return `/api/tab/${id}/source`;
}

async function setMode(mode) {
  // Miks hazirlanirken (10-20 sn) baska bir secim yapilirsa, bitince
  // o secimi ezmesin: yalnizca son istek uygulanir
  const req = ++T.modeReq;
  if (mode === 'nogitar' && !T.mixUrl) {
    status('Gitarsız miks hazırlanıyor… (10-20 saniye)');
    const g = 'vokal:1,davul:1,bas:1,piyano:1,diger:1,gitar:0';
    const r = await api(`/api/songs/${T.song.id}/mix.mp3?g=${g}`);
    if (!r.ok) {
      if (req === T.modeReq) { status('<span class="warn">Gitarsız miks hazırlanamadı.</span>'); $('#tb-mode').value = T.mode; }
      return;
    }
    T.mixUrl = URL.createObjectURL(await r.blob());
    status('');                    // miks hazir; sonraki secimde beklemeden acilir
    if (req !== T.modeReq) return;
  }
  const t = T.au.currentTime, wasPlaying = !T.au.paused;
  T.mode = mode;
  T.au.src = srcFor(mode);
  T.au.addEventListener('loadedmetadata', () => {
    T.au.currentTime = Math.min(t, T.au.duration || t);
    T.au.playbackRate = parseFloat($('#tb-rate').value);
    if (wasPlaying) T.au.play();
  }, { once: true });
}

function togglePlay() {
  if (!T.au.src) return;
  if (T.au.paused) T.au.play(); else T.au.pause();
}

function seek(t) {
  T.au.currentTime = Math.max(0, Math.min(t, T.au.duration || t));
}

/* ------------------------------------------------------------ cizim */

/* Ayni anda baslayan notalari tek etiket olarak gostermek icin grupla. */
function buildEvents() {
  const ev = [];
  T.notes.forEach((n) => {
    const last = ev[ev.length - 1];
    if (last && n[0] - last.t <= 0.06) last.p.push(n[2]);
    else ev.push({ t: n[0], p: [n[2]] });
  });
  ev.forEach((e) => { e.label = [...new Set(e.p)].sort((a, b) => a - b).map(noteName).join(' '); });
  T.events = ev;
}

function firstFrom(arr, t, key) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (key(arr[m]) < t) lo = m + 1; else hi = m; }
  return lo;
}

function draw() {
  const cv = $('#tb-canvas');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const t = now();
  const gut = 34;
  const playX = gut + (w - gut) * 0.25;
  const x = (s) => playX + (s - t) * T.pps;
  const t0 = t - (playX - gut) / T.pps, t1 = t + (w - playX) / T.pps;

  const chordY = 8, chordH = 28;
  const nameY = 54;
  const tabTop = T.names ? 86 : 62, tabBot = h - 26;
  const gap = (tabBot - tabTop) / 5;
  const lineY = (s) => tabTop + (5 - s) * gap;      // s=5 (ince e) en ustte

  const css = getComputedStyle(document.body);
  const ACC = css.getPropertyValue('--accent').trim() || '#ffb347';
  const FG = '#e8eaf0', DIM = '#8c93a5', LINE = '#262a35', PANEL = '#15171d';

  // ---- olcu ve vurus cizgileri
  if (T.grid) {
    const g = T.grid;
    let i = Math.max(0, firstFrom(g, t0, (b) => b) - 1);
    c.font = '10px Segoe UI, system-ui, sans-serif';
    for (; i < g.length && g[i] <= t1; i++) {
      const bx = x(g[i]);
      if (bx < gut) continue;
      const bar = ((i - T.down) % T.perBar + T.perBar) % T.perBar === 0;
      c.strokeStyle = bar ? '#4a5263' : '#20242d';
      c.lineWidth = bar ? 1.5 : 1;
      c.beginPath(); c.moveTo(bx, tabTop - (bar ? 8 : 0)); c.lineTo(bx, tabBot); c.stroke();
      if (bar) {
        c.fillStyle = DIM;
        c.fillText(String(Math.floor((i - origin()) / T.perBar) + 1), bx + 3, tabTop - 4);
      }
    }
  }

  // ---- teller
  c.strokeStyle = '#3a4152'; c.lineWidth = 1;
  for (let s = 0; s < 6; s++) {
    c.beginPath(); c.moveTo(gut, lineY(s)); c.lineTo(w, lineY(s)); c.stroke();
  }
  c.fillStyle = DIM; c.font = '600 12px Segoe UI, system-ui, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  Fretboard.STRING_NAMES.forEach((n, s) => c.fillText(n, gut / 2, lineY(s)));

  // ---- akorlar
  c.font = '600 13px Segoe UI, system-ui, sans-serif';
  let ci = Math.max(0, firstFrom(T.chords, t0, (ch) => ch[1]));
  for (; ci < T.chords.length && T.chords[ci][0] <= t1; ci++) {
    const [s, e, name] = T.chords[ci];
    const a = Math.max(gut, x(s)), b = x(e);
    if (b <= gut) continue;
    const on = s <= t && t < e;
    c.fillStyle = on ? '#2f2716' : '#1b1e26';
    c.strokeStyle = on ? '#6b5420' : LINE;
    c.beginPath(); c.roundRect(a + 1, chordY, Math.max(2, b - a - 2), chordH, 6); c.fill(); c.stroke();
    if (b - a > 24) {
      c.fillStyle = on ? ACC : FG; c.textAlign = 'left';
      c.save(); c.beginPath(); c.rect(a, chordY, b - a - 4, chordH); c.clip();
      c.fillText(name, a + 8, chordY + chordH / 2 + 1);
      c.restore();
    }
  }

  // ---- nota adlari (ust uste binmesin diye carpisanlar atlaniyor)
  if (T.names) {
    c.font = '11px Segoe UI, system-ui, sans-serif'; c.textAlign = 'left';
    let lastEnd = -Infinity;
    let ei = Math.max(0, firstFrom(T.events, t0 - 0.5, (e) => e.t));
    for (; ei < T.events.length && T.events[ei].t <= t1; ei++) {
      const e = T.events[ei];
      const ex = x(e.t);
      const tw = c.measureText(e.label).width;
      if (ex < gut || ex < lastEnd + 6) continue;
      c.fillStyle = Math.abs(e.t - t) < 0.12 || (e.t <= t && t - e.t < 0.25) ? ACC : DIM;
      c.fillText(e.label, ex - 2, nameY);
      lastEnd = ex + tw;
    }
  }

  // ---- tab sayilari
  c.font = '600 13px Consolas, "Segoe UI Mono", monospace'; c.textAlign = 'center';
  let ni = Math.max(0, firstFrom(T.notes, t0 - 8, (n) => n[0]));
  for (; ni < T.notes.length && T.notes[ni][0] <= t1; ni++) {
    const n = T.notes[ni], f = T.fings[ni];
    if (!f) continue;
    const xs = x(n[0]), xe = x(n[1]);
    if (xe < gut) continue;
    const y = lineY(f[0]);
    const on = n[0] <= t && t < n[1];
    const past = n[1] <= t;
    // tinlama suresi: ince serit
    c.fillStyle = on ? ACC : past ? '#3a4152' : '#5b6273';
    c.globalAlpha = on ? 0.55 : 0.45;
    c.fillRect(Math.max(gut, xs), y - 1.5, Math.max(0, xe - Math.max(gut, xs)), 3);
    c.globalAlpha = 1;
    if (xs < gut) continue;
    const label = String(f[1]);
    const bw = c.measureText(label).width + 8;
    c.fillStyle = on ? ACC : PANEL;
    c.beginPath(); c.roundRect(xs - bw / 2, y - 9, bw, 18, 4); c.fill();
    c.fillStyle = on ? '#141414' : past ? DIM : FG;
    c.fillText(label, xs, y + 1);
  }

  // ---- oynatma cizgisi
  c.strokeStyle = ACC; c.lineWidth = 2;
  c.beginPath(); c.moveTo(playX, chordY); c.lineTo(playX, h - 8); c.stroke();

  if (!T.notes.length) {
    c.fillStyle = DIM; c.font = '13px Segoe UI, system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText('Gitar notaları yok', (gut + w) / 2, (tabTop + tabBot) / 2 - 12);
  }

  // ---- alt cubuk
  const dur = T.au.duration || 0;
  $('#tb-time').textContent = `${fmt(t)} / ${fmt(dur)}`;
  const sk = $('#tb-seek');
  if (dur && document.activeElement !== sk) { sk.max = dur; sk.value = t; }
}

function loop() {
  draw();
  T.raf = requestAnimationFrame(loop);
}

/* ------------------------------------------------------------ veri */

function status(html) {
  const el = $('#tb-status');
  el.innerHTML = html;
  el.classList.toggle('hidden', !html);
}

async function loadNotes() {
  clearTimeout(T.poll);
  const r = await api(`/api/songs/${T.song.id}/notes/gitar`);
  if (r.status === 200) {
    const d = await r.json();
    T.notes = d.notes;
    T.fings = Fretboard.assignFingerings(T.notes);
    buildEvents();
    status('');
    $('#tb-sub').textContent = [T.song.artist, `${d.count} nota · ${d.low}–${d.high}`]
      .filter(Boolean).join(' · ');
    updateXmlButton();
    return;
  }
  const body = await r.json().catch(() => ({}));
  const job = body.job;
  if (job && (job.state === 'queued' || job.state === 'running')) {
    status(`Gitar notaları çıkarılıyor… ${job.stage || 'sırada'}`);
    T.poll = setTimeout(loadNotes, 2500);
  } else if (body.available === false) {
    status('<span class="warn">Nota çıkarma modeli bulunamadı.</span>');
  } else {
    const failed = job && job.state === 'error';
    status(`${failed ? '<span class="warn">Nota çıkarma başarısız oldu.</span>' : 'Bu şarkının gitar notaları henüz çıkarılmadı.'}
      <button id="tb-transcribe" class="btn sec">Gitar notalarını çıkar</button>`);
    $('#tb-transcribe').onclick = async (e) => {
      e.target.disabled = true;
      await api(`/api/songs/${T.song.id}/transcribe?stem=gitar`, { method: 'POST' });
      loadNotes();
    };
  }
}

async function loadChords() {
  const r = await api(`/api/songs/${T.song.id}/analysis`);
  if (r.status !== 200) return;          // analiz yoksa akor seridi bos kalir
  const d = await r.json();
  T.chords = d.chords || [];
  T.key = d.key || null;
}

async function loadBeats() {
  $('#tb-xml').title = 'Vuruşlar hesaplanıyor…';
  const r = await api(`/api/tab/${T.song.id}/beats`);
  if (!r.ok) { $('#tb-xml').title = 'Vuruş ızgarası hesaplanamadı'; return; }
  const d = await r.json();
  T.beatsRaw = d.beats;
  T.downRaw = d.downbeat;
  rebuildGrid();
  $('#tb-xml').title = 'Guitar Pro, TuxGuitar, MuseScore açar';
  updateXmlButton();
}

function updateXmlButton() {
  $('#tb-xml').disabled = !(T.notes.length && T.grid);
}

/* 1. olcunun basladigi izgara indeksi. Ilk olcu basindan once kalan
   notalar kaybolmasin diye bir olcu geriden baslatiliyor (eksi olabilir);
   ekrandaki olcu numaralari da MusicXML'dekilerle ayni olsun diye ortak. */
function origin() { return T.down > 0 ? T.down - T.perBar : 0; }

function exportXml() {
  const xml = MusicXML.build({
    title: T.song.title || T.song.file,
    notes: T.notes, fings: T.fings,
    beats: T.grid, downbeat: origin(), perBar: T.perBar,
    chords: T.chords, key: T.key,
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }));
  a.download = `${(T.song.title || T.song.file).replace(/[\\/:*?"<>|]/g, '_')} - gitar.musicxml`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ------------------------------------------------------------ sayfalar */

async function showPicker() {
  $('#tb-pick').classList.remove('hidden');
  const songs = await api('/api/songs').then((r) => r.json());
  const ready = songs.filter((s) => s.stems && s.stems.includes('gitar'));
  const list = $('#tb-list');
  if (!ready.length) {
    list.innerHTML = '<p class="tb-dim">Henüz kanallara ayrılmış şarkı yok. Ana ekranda bir şarkıyı ayır.</p>';
    return;
  }
  list.innerHTML = '';
  for (const s of ready) {
    const row = document.createElement('div');
    row.className = 'tb-item';
    const has = s.notes && s.notes.includes('gitar');
    row.innerHTML = '<div><b></b><span class="tb-dim"></span></div><a class="btn sec">Aç</a>';
    row.querySelector('b').textContent = s.title || s.file;
    row.querySelector('.tb-dim').textContent = has ? 'gitar notaları hazır' : 'notalar çıkarılmadı';
    row.querySelector('a').href = `?song=${s.id}`;
    list.appendChild(row);
  }
}

async function openSong(id) {
  const r = await api(`/api/songs/${id}`);
  if (!r.ok) { showPicker(); return; }
  T.song = await r.json();
  document.title = `${T.song.title || T.song.file} — GgMix Tab`;
  $('#tb-view').classList.remove('hidden');
  $('#tb-title').textContent = T.song.title || T.song.file;
  if (!T.song.stems || !T.song.stems.includes('gitar')) {
    status('<span class="warn">Bu şarkı henüz kanallara ayrılmamış.</span> Ana ekranda ayır, sonra buraya dön.');
    return;
  }
  loadSettings();
  T.au.src = srcFor('source');
  $('#tb-play').disabled = false;
  $('#tb-seek').disabled = false;
  loop();
  await Promise.all([loadNotes(), loadChords(), loadBeats()]);
}

function wire() {
  $('#tb-play').onclick = togglePlay;
  T.au.addEventListener('play', () => { $('#tb-play').textContent = '❚❚'; });
  T.au.addEventListener('pause', () => { $('#tb-play').textContent = '▶'; });
  $('#tb-seek').oninput = (e) => seek(parseFloat(e.target.value));
  $('#tb-mode').onchange = (e) => setMode(e.target.value);
  $('#tb-rate').onchange = (e) => { T.au.playbackRate = parseFloat(e.target.value); };
  $('#tb-zoom').oninput = (e) => { T.pps = parseFloat(e.target.value); };
  $('#tb-names').onchange = (e) => { T.names = e.target.checked; };
  $('#tb-meter').onchange = (e) => { T.perBar = parseInt(e.target.value, 10); rebuildGrid(); saveSettings(); };
  $('#tb-tempo').onchange = (e) => { T.tempoMul = parseFloat(e.target.value); T.shift = 0; rebuildGrid(); saveSettings(); };
  $('#tb-shift-l').onclick = () => { T.shift--; rebuildGrid(); saveSettings(); };
  $('#tb-shift-r').onclick = () => { T.shift++; rebuildGrid(); saveSettings(); };
  $('#tb-xml').onclick = exportXml;

  $('#tb-canvas').onclick = (e) => {
    const cv = e.currentTarget, rect = cv.getBoundingClientRect();
    const gut = 34, playX = gut + (rect.width - gut) * 0.25;
    seek(now() + (e.clientX - rect.left - playX) / T.pps);
  };
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') && e.target.type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowLeft') seek(now() - 5);
    else if (e.code === 'ArrowRight') seek(now() + 5);
  });
}

wire();
const id = new URLSearchParams(location.search).get('song');
if (id) openSong(id); else showPicker();
}());
