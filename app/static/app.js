'use strict';

/* Kanallar. Sira mikserdeki soldan saga sirayla ayni; gitar basta cunku
   bu uygulamanin varlik sebebi o.

   SES MOTORU
   ----------
   Tek bir Signalsmith Stretch dugumu 12 kanal (6 stem x stereo) tasiyor.
   Tum kanallar ayni gerdirme hesabindan gectigi icin aralarinda kayma
   matematiksel olarak imkansiz - 6 ayri stretcher calistirsaydik kayma
   riski olurdu.

     stretch(12ch) -> splitter -> [merger -> analyser -> gain] x6 -> master

   Fader'lar gerdirmeden SONRA uygulaniyor, olcerler fader'dan once. */

const STEMS = [
  { id: 'gitar',  label: 'Gitar',  color: '#ffb347' },
  { id: 'vokal',  label: 'Vokal',  color: '#ff6b8b' },
  { id: 'davul',  label: 'Davul',  color: '#a78bfa' },
  { id: 'bas',    label: 'Bas',    color: '#4da3ff' },
  { id: 'piyano', label: 'Piyano', color: '#3ecfb2' },
  { id: 'diger',  label: 'Diğer',  color: '#78808f' },
];

// Davul perdesiz; nota cikarmak anlamsiz olurdu
const TRANSCRIBABLE = ['gitar', 'bas', 'vokal', 'piyano', 'diger'];

// Standart akort acik teller - piano roll'da yatay kilavuz cizgisi olarak
const OPEN_STRINGS = [['E', 40], ['A', 45], ['D', 50], ['G', 55], ['B', 59], ['e', 64]];

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/* Akor sozlugu. Gitarda gercekten karsilasilan tipler; nadir renkli
   akorlari koymuyoruz cunku her ek sablon yanlis eslesme riski demek. */
const CHORD_TYPES = [
  { suf: '',     pcs: [0, 4, 7] },
  { suf: 'm',    pcs: [0, 3, 7] },
  { suf: '5',    pcs: [0, 7] },            // power chord
  { suf: '7',    pcs: [0, 4, 7, 10] },
  { suf: 'm7',   pcs: [0, 3, 7, 10] },
  { suf: 'maj7', pcs: [0, 4, 7, 11] },
  { suf: 'sus2', pcs: [0, 2, 7] },
  { suf: 'sus4', pcs: [0, 5, 7] },
  { suf: 'dim',  pcs: [0, 3, 6] },
  { suf: 'aug',  pcs: [0, 4, 8] },
  { suf: '6',    pcs: [0, 4, 7, 9] },
  { suf: 'm6',   pcs: [0, 3, 7, 9] },
  { suf: 'add9', pcs: [0, 2, 4, 7] },
];

/* Ayni anda duyulan perdelerden akor adi cikar.

   Puanlama: eksik nota, fazla notadan daha agir cezalandiriliyor.
   Duyulmayan bir akor sesini varsaymak ("D var ama duymadim, yine de
   E7 diyeyim"), duyulan fazladan bir sesi gormezden gelmekten daha
   buyuk bir iddia. */
function nameChord(pitches) {
  const pcs = [...new Set(pitches.map((p) => ((p % 12) + 12) % 12))];
  if (pcs.length < 2) return null;
  const bass = ((Math.min(...pitches) % 12) + 12) % 12;

  let best = null;
  for (let root = 0; root < 12; root++) {
    for (const t of CHORD_TYPES) {
      const tpl = t.pcs.map((i) => (root + i) % 12);
      const matched = tpl.filter((p) => pcs.includes(p)).length;
      const missing = tpl.length - matched;
      const extra = pcs.filter((p) => !tpl.includes(p)).length;
      let score = matched * 2 - missing * 2.5 - extra * 1.2;
      if (root === bass) score += 0.6;      // kok bastaysa daha olasi
      score -= t.pcs.length * 0.05;          // esitlikte sade akoru sec
      if (!best || score > best.score) best = { score, root, t, matched, missing, extra };
    }
  }
  if (!best || best.matched < 2 || best.score < 2.5) return null;

  // Ters cevrilmis akor gosterimi (E/G#) BILEREK yok: transkripsiyon
  // cogu zaman en kalin teli kaciriyor, o zaman en pes duyulan nota
  // gercek bas sanilip yanlis etiket cikiyor. Notalarin tamami zaten
  // asagidaki ciplerde gorunuyor.
  return {
    label: PC[best.root] + best.t.suf,
    exact: best.missing === 0 && best.extra === 0,
    notes: best.t.pcs.map((i) => PC[(best.root + i) % 12]),
  };
}

const $ = (s) => document.querySelector(s);
const fmt = (t) => {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
};

/* ====================================================================
   KİTAPLIK
   ==================================================================== */

let pollTimer = null;
const jobStates = {};        // is anahtari -> son gorulen durum

/* Ilerleme yoklamasi /api/jobs'a gidiyor, /api/songs'a degil.

   /api/songs her istekte kutuphaneyi diskten yeniden kuruyor: sarki basina
   ~12 ms etiket ayristirma (olculdu). 100 sarkilik bir kutuphanede bu 1.3
   saniye eder ve 1.5 saniyede bir yoklamak CPU'yu surekli mesgul birakir.
   /api/jobs tamamen bellekte, ~3 ms, kutuphane boyutundan bagimsiz.
   Kutuphane listesi ise yalnizca bir is bittiginde tazelenir. */
/* Kutuphane bellekte tutuluyor; arama/siralama istemcide yapiliyor.
   Her tus vurusunda sunucuya gitmek yuzlerce sarkida gereksiz - liste
   zaten elimizde. */
const LIB = { songs: [], search: '', state: '', sort: 'name' };

const fmtSize = (b) => (!b ? '—'
  : b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB');

async function loadLibrary() {
  LIB.songs = await fetch('/api/songs').then((r) => r.json());
  renderLibrary();

  // jobStates'i BURADA tohumla. Yoksa pollJobs bir isi ilk kez gordugunde
  // "onceki durum" bilinmiyor ve bitis gecisi hic yakalanmiyordu: is,
  // kutuphane yuklendikten sonraki ilk 1.5 saniyede biterse satir
  // "ayriliyor" yazili asili kaliyordu.
  for (const s of LIB.songs) {
    for (const j of [s.job, s.analysis_job]) {
      if (j) jobStates[`${j.kind}:${j.stem || ''}:${j.song_id}`] = j.state;
    }
  }

  const busy = LIB.songs.some((s) => s.state === 'running' || s.state === 'queued');
  clearTimeout(pollTimer);
  if (busy) pollTimer = setTimeout(pollJobs, 1500);
}

function visibleSongs() {
  const q = LIB.search.trim().toLocaleLowerCase('tr');
  let out = LIB.songs.filter((s) => {
    if (LIB.state === 'busy') {
      if (s.state !== 'running' && s.state !== 'queued') return false;
    } else if (LIB.state && s.state !== LIB.state) return false;
    if (!q) return true;
    return [s.title, s.artist, s.file].filter(Boolean)
      .some((v) => v.toLocaleLowerCase('tr').includes(q));
  });
  const by = {
    name: (a, b) => (a.title || a.file).localeCompare(b.title || b.file, 'tr'),
    added: (a, b) => (b.mtime || 0) - (a.mtime || 0),
    duration: (a, b) => (b.duration || 0) - (a.duration || 0),
    size: (a, b) => (b.stem_bytes + b.src_bytes) - (a.stem_bytes + a.src_bytes),
  }[LIB.sort];
  return out.sort(by);
}

function renderLibrary() {
  const list = $('#song-list');
  list.innerHTML = '';
  const vis = visibleSongs();
  $('#library-empty').classList.toggle('hidden', LIB.songs.length > 0);
  $('#library-nomatch').classList.toggle(
    'hidden', LIB.songs.length === 0 || vis.length > 0);
  for (const s of vis) list.appendChild(songRow(s));

  const bytes = LIB.songs.reduce((a, s) => a + s.stem_bytes + s.src_bytes, 0);
  const n = LIB.songs.length;
  $('#lib-stats').textContent =
    `${vis.length < n ? vis.length + ' / ' : ''}${n} şarkı · ${fmtSize(bytes)}`;
}

/* ====================================================================
   ŞARKI KAYNAKLARI: bağlantıdan indirme ve sistem sesi kaydı
   Ikisi de istege bagli; bagimliligi yoksa dugme kapali ve sebep yaziyor.
   ==================================================================== */

const SRC = { poll: null, recording: false };

async function refreshSources() {
  let d;
  try { d = await fetch('/api/sources').then((r) => r.json()); } catch (e) { return; }
  const info = $('#src-info');
  const btnF = $('#src-fetch'), btnR = $('#src-rec'), url = $('#src-url');
  const parts = [];

  btnF.disabled = !d.fetch.available;
  url.disabled = !d.fetch.available;
  if (!d.fetch.available) parts.push(`<span class="warn">İndirme kapalı: ${d.fetch.reason}</span>`);
  else if (d.fetch.state === 'running') {
    parts.push(`İndiriliyor… ${Math.round(d.fetch.progress * 100)}%` +
      `<div class="src-prog"><i style="width:${d.fetch.progress * 100}%"></i></div>`);
  } else if (d.fetch.state === 'error') {
    parts.push(`<span class="warn">İndirme başarısız: ${d.fetch.error || ''}</span>`);
  } else if (d.fetch.state === 'done' && d.fetch.file) {
    parts.push(`İndirildi: <b>${d.fetch.file}</b>`);
  }

  btnR.disabled = !d.record.available;
  SRC.recording = d.record.state === 'recording';
  btnR.classList.toggle('rec-on', SRC.recording);
  btnR.innerHTML = `<span class="rec-dot"></span>${
    SRC.recording ? 'Kaydı durdur' : 'Sistem sesini kaydet'}`;
  if (!d.record.available) parts.push(`<span class="warn">Kayıt kapalı: ${d.record.reason}</span>`);
  else if (SRC.recording) parts.push(`Kaydediliyor — ${fmt(d.record.seconds)} · ${d.record.device || ''}`);
  else if (d.record.state === 'error') parts.push(`<span class="warn">Kayıt hatası: ${d.record.error}</span>`);
  else if (d.record.state === 'done' && d.record.file) parts.push(`Kaydedildi: <b>${d.record.file}</b>`);

  info.innerHTML = parts.join(' &nbsp;·&nbsp; ');

  // Is bittiginde kutuphaneyi bir kez tazele
  const busy = d.fetch.state === 'running' || SRC.recording;
  if (SRC.wasBusy && !busy) loadLibrary();
  SRC.wasBusy = busy;

  clearTimeout(SRC.poll);
  if (busy) SRC.poll = setTimeout(refreshSources, 700);
}

function initSources() {
  $('#src-fetch').onclick = async () => {
    const u = $('#src-url').value.trim();
    if (!u) return;
    const r = await fetch(`/api/fetch?url=${encodeURIComponent(u)}`, { method: 'POST' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      await confirmDialog('İndirilemedi', e.detail || 'Bilinmeyen hata', 'Tamam');
      return;
    }
    $('#src-url').value = '';
    refreshSources();
  };
  $('#src-url').onkeydown = (e) => { if (e.key === 'Enter') $('#src-fetch').click(); };

  $('#src-rec').onclick = async () => {
    const path = SRC.recording ? '/api/record/stop' : '/api/record/start';
    const r = await fetch(path, { method: 'POST' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      await confirmDialog('Kayıt başlatılamadı', e.detail || 'Bilinmeyen hata', 'Tamam');
      return;
    }
    refreshSources();
  };
}

/* Silme geri alinamaz; tek tikla olmamali. Promise<bool> donduruyor. */
function confirmDialog(title, bodyHTML, okText = 'Sil') {
  return new Promise((resolve) => {
    const box = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-body').innerHTML = bodyHTML;
    $('#confirm-yes').textContent = okText;
    box.classList.remove('hidden');
    const done = (v) => {
      box.classList.add('hidden');
      $('#confirm-yes').onclick = $('#confirm-no').onclick = null;
      document.removeEventListener('keydown', esc);
      resolve(v);
    };
    const esc = (e) => { if (e.key === 'Escape') done(false); };
    $('#confirm-yes').onclick = () => done(true);
    $('#confirm-no').onclick = () => done(false);
    document.addEventListener('keydown', esc);
  });
}

function closeMenus() {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
}

async function deleteSong(s, scope) {
  const name = s.title || s.file;
  const size = fmtSize(scope === 'all' ? s.stem_bytes + s.src_bytes : s.stem_bytes);
  const ok = await confirmDialog(
    scope === 'all' ? 'Şarkıyı tamamen sil' : 'Kanalları sil',
    scope === 'all'
      ? `<b>${name}</b> — kaynak dosya ve ayrılmış kanallar birlikte silinecek
         (${size}). Bu şarkı kütüphaneden kalkar.`
      : `<b>${name}</b> — ayrılmış kanallar, analiz ve notalar silinecek
         (${size}). Kaynak dosya kalır, istersen tekrar ayırabilirsin.`);
  if (!ok) return;
  const r = await fetch(`/api/songs/${s.id}?scope=${scope}`, { method: 'DELETE' });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    await confirmDialog('Silinemedi', e.detail || 'Bilinmeyen hata', 'Tamam');
    return;
  }
  loadLibrary();
}

async function scanOrphans() {
  const info = $('#orphan-info');
  info.textContent = 'taranıyor…';
  const d = await fetch('/api/library/orphans').then((r) => r.json());
  if (!d.items.length) { info.textContent = 'Öksüz kanal klasörü yok.'; return; }
  info.textContent = `${d.items.length} öksüz klasör · ${fmtSize(d.total_bytes)}`;
  const ok = await confirmDialog(
    'Öksüz kanalları sil',
    `Kaynak şarkısı artık bulunmayan <b>${d.items.length}</b> kanal klasörü var,
     toplam <b>${fmtSize(d.total_bytes)}</b>:<br><br>` +
    d.items.slice(0, 12).map((i) => `• ${i.name} <span style="color:var(--dimmer)">(${fmtSize(i.bytes)})</span>`).join('<br>') +
    (d.items.length > 12 ? `<br>• …ve ${d.items.length - 12} tane daha` : ''));
  if (!ok) return;
  const r = await fetch('/api/library/orphans', { method: 'DELETE' }).then((x) => x.json());
  info.textContent = `${r.removed.length} klasör silindi · ${fmtSize(r.freed_bytes)} boşaldı`;
  loadLibrary();
}

async function pollJobs() {
  clearTimeout(pollTimer);
  let jobs;
  try {
    jobs = await fetch('/api/jobs').then((r) => r.json());
  } catch (e) {
    pollTimer = setTimeout(pollJobs, 3000);
    return;
  }

  let busy = false, finished = false;
  for (const [key, j] of Object.entries(jobs)) {
    if (j.state === 'queued' || j.state === 'running') busy = true;
    const prev = jobStates[key];
    if (prev && prev !== j.state && (j.state === 'done' || j.state === 'error')) {
      finished = true;
    }
    jobStates[key] = j.state;
  }

  // Ilerleme cubugunu yerinde guncelle - liste yeniden kurulmuyor
  for (const j of Object.values(jobs)) {
    if (j.kind !== 'separate') continue;
    const row = document.querySelector(`.song[data-song="${j.song_id}"]`);
    if (!row) continue;
    const pct = Math.round((j.progress || 0) * 100);
    const bar = row.querySelector('.prog > i');
    if (bar) bar.style.width = pct + '%';
    const meta = row.querySelector('.song-meta');
    if (meta && j.state === 'running') meta.textContent = `${j.stage || ''} · %${pct}`;
  }

  // busy false ise: bu yoklama zaten "bir sey calisiyor" diye baslamisti,
  // artik calismiyorsa bitmis demektir. Tohumlama atlansa bile bu ikinci
  // koruma satirin asili kalmasini engelliyor.
  if (finished || !busy) { loadLibrary(); return; }   // loadLibrary yeniden zamanlar
  pollTimer = setTimeout(pollJobs, 1500);
}

function songRow(s) {
  const el = document.createElement('div');
  el.className = 'song';
  el.dataset.song = s.id;      // pollJobs ilerlemeyi bu satirda gunceller

  const label = {
    ready: 'hazır', raw: 'ayrılmadı', running: 'ayrılıyor',
    queued: 'sırada', error: 'hata',
  }[s.state] || s.state;

  const meta = [];
  if (s.artist) meta.push(s.artist);
  if (s.duration) meta.push(fmt(s.duration));
  if (s.state === 'ready') meta.push(s.stems.length + ' kanal');
  if (s.stem_bytes) meta.push(fmtSize(s.stem_bytes + s.src_bytes));

  const job = s.job || {};
  const pct = Math.round((job.progress || 0) * 100);

  el.innerHTML = `
    <div class="song-main">
      <div class="song-title"></div>
      <div class="song-meta"></div>
      ${s.state === 'running' || s.state === 'queued'
        ? `<div class="prog"><i style="width:${pct}%"></i></div>` : ''}
    </div>
    <span class="badge ${s.state}">${label}</span>
    <div class="song-act"></div>`;

  el.querySelector('.song-title').textContent = s.title || s.file;
  el.querySelector('.song-meta').textContent =
    s.state === 'running' ? `${job.stage || ''} · %${pct}` : meta.join(' · ');

  const act = el.querySelector('.song-act');
  if (s.state === 'ready') {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = 'Aç';
    b.onclick = () => openPlayer(s);
    act.appendChild(b);
  } else if (s.state === 'raw' || s.state === 'error') {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = 'Kanallara ayır';
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = 'başlatılıyor…';
      await fetch(`/api/songs/${s.id}/separate?mode=hybrid`, { method: 'POST' });
      loadLibrary();
    };
    act.appendChild(b);
  }

  // Silme ve klasor islemleri satir menusunde: ana eylemin yaninda
  // dogrudan bir "Sil" dugmesi kazara tiklanmaya cok acik olurdu
  const wrap = document.createElement('div');
  wrap.className = 'row-menu';
  const dots = document.createElement('button');
  dots.className = 'dots';
  dots.textContent = '⋯';
  dots.title = 'Daha fazla';
  dots.onclick = (e) => {
    e.stopPropagation();
    const open = wrap.querySelector('.menu');
    closeMenus();
    if (open) return;
    const m = document.createElement('div');
    m.className = 'menu';
    const hasStems = s.stems.length > 0;
    m.innerHTML = `
      ${hasStems ? '<button data-a="reanalyze">Analizi yenile</button>' : ''}
      ${hasStems ? '<div class="sep"></div>' : ''}
      ${hasStems ? '<button class="warn" data-a="stems">Kanalları sil (mp3 kalsın)</button>' : ''}
      <button class="warn" data-a="all">Şarkıyı tamamen sil</button>`;
    m.onclick = async (ev) => {
      const a = ev.target.dataset.a;
      if (!a) return;
      closeMenus();
      if (a === 'reanalyze') {
        await fetch(`/api/songs/${s.id}/analyze`, { method: 'POST' });
        loadLibrary();
      } else deleteSong(s, a);
    };
    wrap.appendChild(m);
  };
  wrap.appendChild(dots);
  act.appendChild(wrap);
  return el;
}

/* ====================================================================
   DURUM
   ==================================================================== */

const P = {
  ctx: null, node: null, master: null,
  gains: {}, analysers: {},
  duration: 0, playing: false,
  rate: 1, semitones: 0,
  loopA: null, loopB: null,
  vol: {}, mute: {}, solo: {},
  peaks: null, guitarEnv: null,
  lastInput: 0, lastInputAt: 0, raf: 0, song: null,
};

function anySolo() { return STEMS.some((s) => P.solo[s.id]); }

function applyGains() {
  const solo = anySolo();
  for (const s of STEMS) {
    const on = solo ? !!P.solo[s.id] : !P.mute[s.id];
    const g = P.gains[s.id];
    if (g) g.gain.setTargetAtTime(on ? P.vol[s.id] : 0, P.ctx.currentTime, 0.012);
    const ch = document.getElementById('ch-' + s.id);
    if (ch) ch.classList.toggle('silent', !on);
  }
}

function loopActive() {
  return P.loopA !== null && P.loopB !== null && P.loopB - P.loopA > 0.05;
}

/* Motoru guncelle.

   `input` bilerek atlaniyor: kutuphane, verilmediginde onceki segmentten
   devam noktasini kendi hesapliyor. Her hiz degisiminde input gondermek
   kucuk sicramalara yol acardi. Sadece seek'te aciktan veriyoruz. */
function push(extra) {
  if (!P.node) return;
  const msg = {
    active: P.playing,
    rate: P.rate,
    semitones: P.semitones,
    loopStart: loopActive() ? P.loopA : 0,
    loopEnd: loopActive() ? P.loopB : 0,
    ...extra,
  };
  P.node.schedule(msg);
}

function position() {
  let t = P.lastInput;
  if (P.playing) t += (P.ctx.currentTime - P.lastInputAt) * P.rate;
  if (loopActive()) {
    const len = P.loopB - P.loopA;
    if (t >= P.loopB) t = P.loopA + ((t - P.loopA) % len);
    if (t < P.loopA) t = P.loopA;
  }
  return Math.max(0, Math.min(t, P.duration));
}

async function play() {
  if (P.playing) return;
  if (P.ctx.state === 'suspended') await P.ctx.resume();
  let at = position();
  if (!loopActive() && at >= P.duration - 0.05) at = 0;
  P.playing = true;
  push({ input: at });
  P.lastInput = at;
  P.lastInputAt = P.ctx.currentTime;
  $('#btn-play').textContent = '❚❚';
}

function pause() {
  if (!P.playing) return;
  const at = position();
  P.playing = false;
  push({ input: at });
  P.lastInput = at;
  P.lastInputAt = P.ctx.currentTime;
  $('#btn-play').textContent = '▶';
}

function seek(t) {
  const at = Math.max(0, Math.min(t, P.duration));
  P.lastInput = at;
  P.lastInputAt = P.ctx.currentTime;
  push({ input: at });
  render();
}

function setRate(r) {
  P.rate = Math.max(0.25, Math.min(1.25, r));
  // Once konumu sabitle, sonra hizi degistir: aksi halde interpolasyon
  // eski hizla hesaplanmis kalir ve oynatma kafasi sicrar
  P.lastInput = position();
  P.lastInputAt = P.ctx.currentTime;
  push({});
  $('#rate-val').textContent = '%' + Math.round(P.rate * 100);
  $('#rate').value = P.rate;
  $('#btn-rate-reset').classList.toggle('set', Math.abs(P.rate - 1) > 0.001);
}

function setPitch(n) {
  P.semitones = Math.max(-6, Math.min(6, Math.round(n)));
  push({});
  $('#pitch-val').textContent = (P.semitones > 0 ? '+' : '') + P.semitones;
  $('#btn-pitch-reset').classList.toggle('set', P.semitones !== 0);
}

/* ====================================================================
   YÜKLEME
   ==================================================================== */

async function openPlayer(song) {
  P.song = song;
  showView('player');
  $('#now-title').textContent = song.title || song.file;
  $('#now-sub').textContent = [song.artist, song.file].filter(Boolean).join(' · ');
  $('#loading').classList.remove('hidden');
  $('#loading-bar').style.width = '0%';

  cancelAnimationFrame(P.raf);
  if (!P.ctx) {
    P.ctx = new (window.AudioContext || window.webkitAudioContext)();
    P.master = P.ctx.createGain();
    P.master.gain.value = parseFloat($('#master').value);
    P.master.connect(P.ctx.destination);
  }

  // Onceki sarkinin dugumunu tamamen birak; 900 MB'lik WASM belleginin
  // serbest kalmasi icin sart
  if (P.node) {
    try { P.node.schedule({ active: false }); P.node.disconnect(); } catch (e) { /* yok say */ }
    P.node = null;
  }
  P.playing = false;
  P.lastInput = 0;
  P.duration = 0;          // yoksa onceki (daha uzun) sarkinin suresi kalir
  P.loopA = P.loopB = null;
  $('#btn-play').textContent = '▶';

  const ch = STEMS.length * 2;
  P.node = await SignalsmithStretch(P.ctx, {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [ch],
  });
  P.node.onprocessorerror = () => {
    $('#loading-text').textContent = 'Ses motoru hatası — sayfayı yenile.';
    $('#loading').classList.remove('hidden');
  };

  buildMixer();

  // Stem'leri sirayla indir + coz. Es zamanli cozmek bellek tepesini
  // gereksiz yukseltiyor.
  const channels = [];
  const envs = [];
  for (let i = 0; i < STEMS.length; i++) {
    const s = STEMS[i];
    $('#loading-text').textContent = `${s.label} yükleniyor… (${i + 1}/${STEMS.length})`;
    $('#loading-bar').style.width = ((i / (STEMS.length + 1)) * 100) + '%';
    const ab = await fetch(`/audio/${song.id}/${s.id}`).then((r) => r.arrayBuffer());
    const buf = await P.ctx.decodeAudioData(ab);
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    channels.push(L, R);
    envs.push(envelopeOf(L, WAVE_BINS));   // dalga formunu simdi hesapla
    P.duration = Math.max(P.duration, buf.duration);
  }

  $('#loading-text').textContent = 'Ses motoruna aktarılıyor…';
  $('#loading-bar').style.width = ((STEMS.length / (STEMS.length + 1)) * 100) + '%';
  await P.node.addBuffers(channels);
  channels.length = 0;   // AudioBuffer referanslarini birak

  $('#loading-bar').style.width = '100%';
  await P.node.setUpdateInterval(0.05, (t) => {
    P.lastInput = t;
    P.lastInputAt = P.ctx.currentTime;
  });

  wireOutput(ch);
  loadAnalysis(song);          // beklemeye gerek yok, geldiginde yerine oturur
  buildNoteStems(song);
  loadNotes(song, N.stem);
  $('#t-dur').textContent = fmt(P.duration);
  computePeaks(envs);
  drawWave();
  applyGains();
  setRate(P.rate);
  setPitch(P.semitones);
  push({ input: 0 });
  $('#loading').classList.add('hidden');
  tick();
}

/* 12 kanali 6 stereo cifte ayir, her cifte olcer ve fader tak. */
function wireOutput(ch) {
  const split = P.ctx.createChannelSplitter(ch);
  P.node.connect(split);
  STEMS.forEach((s, i) => {
    const merge = P.ctx.createChannelMerger(2);
    split.connect(merge, i * 2, 0);
    split.connect(merge, i * 2 + 1, 1);
    merge.connect(P.analysers[s.id]);
    P.analysers[s.id].connect(P.gains[s.id]);
    P.gains[s.id].connect(P.master);
  });
}

function buildMixer() {
  const m = $('#mixer');
  m.innerHTML = '';
  for (const s of STEMS) {
    if (P.vol[s.id] === undefined) P.vol[s.id] = 1;
    P.mute[s.id] = false;
    P.solo[s.id] = false;

    const g = P.ctx.createGain();
    g.gain.value = P.vol[s.id];
    const a = P.ctx.createAnalyser();
    a.fftSize = 1024;
    P.gains[s.id] = g;
    P.analysers[s.id] = a;

    const el = document.createElement('div');
    el.className = 'ch';
    el.id = 'ch-' + s.id;
    el.style.setProperty('--c', `var(--${s.id})`);
    el.innerHTML = `
      <div class="ch-name">${s.label}</div>
      <div class="fader-row">
        <input type="range" class="fader" min="0" max="1.3" step="0.01" value="${P.vol[s.id]}">
        <div class="meter"><i></i></div>
      </div>
      <div class="ch-val">100%</div>
      <div class="ch-btns">
        <button class="sm b-s">S</button>
        <button class="sm b-m">M</button>
      </div>`;

    const fader = el.querySelector('.fader');
    const val = el.querySelector('.ch-val');
    fader.oninput = () => {
      P.vol[s.id] = parseFloat(fader.value);
      val.textContent = Math.round(P.vol[s.id] * 100) + '%';
      applyGains();
    };
    el.querySelector('.b-m').onclick = (e) => {
      P.mute[s.id] = !P.mute[s.id];
      e.target.classList.toggle('on-m', P.mute[s.id]);
      applyGains();
    };
    el.querySelector('.b-s').onclick = (e) => {
      P.solo[s.id] = !P.solo[s.id];
      e.target.classList.toggle('on-s', P.solo[s.id]);
      applyGains();
    };
    m.appendChild(el);
  }
}

/* ====================================================================
   ANALİZ ŞERİDİ  (ton / gam / pentatonik / tempo)
   ==================================================================== */

let analysisPoll = null;
const A = { data: null };

/* Librosa analizinin o ana denk gelen akoru. Transkripsiyondan cikardigimiz
   akorla karsilastirmak icin: iki bagimsiz yontem ayni seyi diyorsa guven
   yuksek demektir. */
function analysisChordAt(t) {
  if (!A.data || !A.data.chords) return null;
  for (const [a, b, c] of A.data.chords) if (t >= a && t < b) return c;
  return null;
}

function chips(notes, root) {
  return `<div class="chips">${notes.map((n) =>
    `<span class="chip${n === root ? ' root' : ''}">${n}</span>`).join('')}</div>`;
}

/* Korelasyon katsayisini kullaniciya ham sayi olarak vermek anlamsiz;
   ne kadar guvenilecegini kelimeyle soyluyoruz. */
function confWord(c) {
  if (c >= 0.75) return 'güçlü eşleşme';
  if (c >= 0.60) return 'orta eşleşme';
  return 'zayıf — kulağınla doğrula';
}

function renderAnalysis(d) {
  const el = $('#analysis');
  el.classList.remove('hidden');
  const k = d.key, sc = d.scale;
  const alt = d.alternatives && d.alternatives[0];
  const weak = k.confidence < 0.60 && alt;

  el.innerHTML = `
    <div class="acard">
      <div class="acap">Ton</div>
      <div class="aval">${k.label}</div>
      <div class="asub">${confWord(k.confidence)}${
        weak ? ` · belki ${alt.label}` : ''}</div>
    </div>
    <div class="acard wide">
      <div class="acap">Gam — ${sc.name}</div>
      ${chips(sc.notes, k.root)}
      <div class="asub">akrabası ${sc.relative}</div>
    </div>
    <div class="acard wide">
      <div class="acap">Pentatonik</div>
      ${chips(sc.pentatonic, k.root)}
      <div class="asub">solo çalışırken bu beş nota güvenli</div>
    </div>
    <div class="acard">
      <div class="acap">Tempo</div>
      <div class="aval">${d.tempo}<span class="unit">BPM</span></div>
      <div class="asub">${d.tempo_alt
        ? `yarısı/katı olabilir: ${d.tempo_alt}`
        : (d.common_chords || []).slice(0, 4).join(' · ')}</div>
    </div>`;
}

function renderAnalysisPending(song, job) {
  const el = $('#analysis');
  el.classList.remove('hidden');
  el.className = 'analysis-bar';
  if (job && (job.state === 'running' || job.state === 'queued')) {
    el.innerHTML = `<span>Ton ve gam analizi çalışıyor…</span>
      <div class="prog"><i style="width:${Math.round((job.progress || 0) * 100)}%"></i></div>`;
  } else {
    el.innerHTML = `<span>Bu şarkının ton/gam analizi yok.</span>
      <button class="btn sec" id="btn-analyze">Analiz et</button>`;
    $('#btn-analyze').onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'başlatılıyor…';
      await fetch(`/api/songs/${song.id}/analyze`, { method: 'POST' });
      loadAnalysis(song);
    };
  }
}

async function loadAnalysis(song) {
  clearTimeout(analysisPoll);
  const el = $('#analysis');
  el.className = 'analysis hidden';
  el.innerHTML = '';

  A.data = null;
  const res = await fetch(`/api/songs/${song.id}/analysis`);
  if (res.status === 200) {
    el.className = 'analysis';
    A.data = await res.json();
    renderAnalysis(A.data);
    return;
  }
  const body = await res.json();
  renderAnalysisPending(song, body.job);
  if (body.job && (body.job.state === 'running' || body.job.state === 'queued')) {
    analysisPoll = setTimeout(() => loadAnalysis(song), 2000);
  }
}

/* ====================================================================
   NOTA PANELİ  (piano roll)

   Basic-pitch izole kanaldan MIDI nota dizisi cikariyor. Cikarim ayri bir
   venv'de alt surec olarak kosuyor (TensorFlow ana ortami bozardi).
   ==================================================================== */

/* ====================================================================
   GAMLAR
   Muzik teorisi scales.js'te, cizim fretboard.js'te; burada sadece arayuz.
   ==================================================================== */

const SC = { root: 4, id: 'pentmin', box: null, boxes: null,
             chord: null, chords: null };   // varsayilan E minör pentatonik

function showView(name) {
  for (const v of ['library', 'player', 'scales']) {
    $('#' + v).classList.toggle('hidden', v !== name);
  }
}

function buildScaleUI() {
  const rr = $('#sc-roots');
  if (!rr.children.length) {
    Scales.PC.forEach((n, i) => {
      const b = document.createElement('button');
      b.className = 'sc-root';
      b.textContent = n;
      b.onclick = () => { SC.root = i; SC.box = null; SC.chord = null; renderScales(); };
      rr.appendChild(b);
    });
  }
  const sel = $('#sc-type');
  if (!sel.children.length) {
    let grp = null;
    for (const s of Scales.SCALES) {
      if (s.group !== grp) {
        grp = s.group;
        const og = document.createElement('optgroup');
        og.label = grp;
        sel.appendChild(og);
      }
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      sel.lastElementChild.appendChild(o);
    }
    sel.onchange = () => { SC.id = sel.value; SC.box = null; SC.chord = null; renderScales(); };
  }
}

function renderScales() {
  const sc = Scales.byId(SC.id);
  const rootName = Scales.PC[SC.root];

  document.querySelectorAll('.sc-root')
    .forEach((b, i) => b.classList.toggle('on', i === SC.root));
  $('#sc-type').value = SC.id;
  $('#sc-name').textContent = `${rootName} ${sc.name}`;
  $('#sc-desc').textContent = Scales.SCALE_NOTE[sc.id] || '';

  const names = Scales.noteNames(SC.root, sc.steps);
  const degs = Scales.degrees(sc.steps);
  $('#sc-notes').innerHTML = names.map((n, i) =>
    `<div class="sc-note-chip${i === 0 ? ' root' : ''}"><b>${n}</b><span>${degs[i]}</span></div>`)
    .join('');

  // Pentatonik kutulari sadece pentatonik/blues icin anlamli
  const bw = $('#sc-boxwrap');
  if (sc.caged) {
    SC.boxes = Scales.pentatonicBoxes(SC.root, sc.steps);
    bw.classList.remove('hidden');
    $('#sc-boxes').innerHTML =
      `<button class="sc-box${SC.box === null ? ' on' : ''}" data-b="">Tümü</button>` +
      SC.boxes.map((b, i) =>
        `<button class="sc-box${SC.box === i ? ' on' : ''}" data-b="${i}">Kutu ${b.n}` +
        `<small>${b.from}–${b.to}. perde</small></button>`).join('');
    $('#sc-boxes').onclick = (e) => {
      const t = e.target.closest('.sc-box');
      if (!t) return;
      SC.box = t.dataset.b === '' ? null : Number(t.dataset.b);
      renderScales();
    };
  } else {
    bw.classList.add('hidden');
    SC.box = null; SC.boxes = null;
  }

  const dc = Scales.diatonicChords(SC.root, sc);
  if (dc) {
    $('#sc-chordwrap').classList.remove('hidden');
    $('#sc-chords').innerHTML = dc.chords.map((c, i) =>
      `<div class="sc-chord ${c.quality}" data-c="${i}"><b>${c.name}</b><span>${c.roman}</span></div>`)
      .join('');
    SC.chords = dc.chords;
    $('#sc-chords').onclick = (e) => {
      const t = e.target.closest('.sc-chord');
      if (!t) return;
      const i = Number(t.dataset.c);
      SC.chord = SC.chord === i ? null : i;     // tekrar tiklayinca kapat
      renderVoicings();
    };
    renderVoicings();
    $('#sc-chordnote').textContent = dc.from
      ? `${rootName} ${dc.from} gamının akorları — pentatonikle solo yaparken altta bunlar çalar.`
      : 'Gamın her derecesi üstüne kurulan üçlüler.';
  } else {
    $('#sc-chordwrap').classList.add('hidden');
  }

  drawScaleBoard();
}

/* Secili akorun basilis sekilleri: klavye boyunca alternatif pozisyonlar. */
function renderVoicings() {
  const box = $('#sc-voicings');
  document.querySelectorAll('.sc-chord')
    .forEach((el, i) => el.classList.toggle('on', i === SC.chord));

  if (SC.chord === null || !SC.chords) { box.classList.add('hidden'); return; }
  const ch = SC.chords[SC.chord];
  const ivs = { major: [0, 4, 7], minor: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8] }[ch.quality];
  if (!ivs) { box.classList.add('hidden'); return; }

  const root = Scales.PC.indexOf(ch.name.match(/^[A-G]#?/)[0]);
  const vs = Scales.chordVoicings(root, ivs, 5);
  box.classList.remove('hidden');
  box.innerHTML =
    `<div class="vc-head"><b>${ch.name}</b>` +
    `<span>${vs.length} basılış · ${ch.roman}. derece</span></div>` +
    vs.map((v, i) => `
      <div class="vc">
        <canvas id="vc-${i}"></canvas>
        <div class="vc-txt">${Scales.voicingText(v.frets)}</div>
        <div class="vc-sub">${v.position === 0 ? 'açık' : v.position + '. perde'} · ${v.fingers} parmak${v.barre ? ' · barre' : ''}</div>
      </div>`).join('');

  vs.forEach((v, i) => Fretboard.drawChordDiagram($(`#vc-${i}`), v.frets, { barre: v.barre }));
}

function drawScaleBoard() {
  const sc = Scales.byId(SC.id);
  const box = (SC.boxes && SC.box !== null)
    ? [SC.boxes[SC.box].from, SC.boxes[SC.box].to] : null;
  Fretboard.drawFretboard($('#sc-fret'), {
    marks: Scales.fretMarks(SC.root, sc.steps, 15),
    box, window: [0, 15],
    // 0. perde noktalari tel adlarini ezmesin, alt tel perde
    // numaralarina degmesin diye genis dolgu
    pad: { l: 56, r: 14, t: 20, b: 30 },
  });
}

/* Acik sarkinin tonuna atla. Analiz yoksa dugme gizli kalir. */
function updateScaleFromSong() {
  const btn = $('#sc-fromsong');
  if (!A.data || !A.data.key) { btn.classList.add('hidden'); return; }
  const k = A.data.key;
  btn.classList.remove('hidden');
  btn.textContent = `Şarkının tonu: ${k.label}`;
  btn.onclick = () => {
    SC.root = Scales.PC.indexOf(k.root);
    SC.id = k.mode === 'minor' ? 'minor' : 'major';
    SC.box = null;
    renderScales();
  };
}

const N = { stem: 'gitar', data: null, poll: null, song: null,
            fing: null, win: [0, 7], winAt: 0 };

function buildNoteStems(song) {
  const box = $('#note-stems');
  box.innerHTML = '';
  for (const s of STEMS) {
    if (!TRANSCRIBABLE.includes(s.id)) continue;
    const b = document.createElement('button');
    b.className = 'nstem' + (s.id === N.stem ? ' on' : '') +
                  ((song.notes || []).includes(s.id) ? ' has' : '');
    b.style.setProperty('--nc', s.color);
    b.textContent = s.label;
    b.onclick = () => { N.stem = s.id; buildNoteStems(song); loadNotes(song, s.id); };
    box.appendChild(b);
  }
}

/* Dosya adinda sorun cikaracak karakterleri temizle */
function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, '_').trim() || 'stem';
}

async function loadNotes(song, stem) {
  clearTimeout(N.poll);
  N.song = song;
  N.stem = stem;
  N.data = null;
  N.fing = null;
  $('#note-midi').classList.add('hidden');
  $('#note-info').textContent = '';

  // Kanalin ses dosyasi her zaman hazir - notalar cikarilmis olmasa da
  const base = safeName(song.title || song.file.replace(/\.[^.]+$/, ''));
  const au = $('#stem-audio');
  au.href = `/audio/${song.id}/${stem}`;
  au.download = `${base} - ${stem}.mp3`;

  drawRoll();

  const res = await fetch(`/api/songs/${song.id}/notes/${stem}`);
  if (res.status === 200) {
    N.data = await res.json();
    // Parmak pozisyonlarini tum dizi boyunca bir yol olarak sec. Sunucunun
    // gonderdigi frets haritasi her notayi tek basina degerlendiriyor;
    // bu ise ardisik notalari birlikte dusunup el hareketini en aza
    // indiriyor. 1700 notada ~13 ms, onbelleklemeye gerek yok.
    N.fing = Fretboard.assignFingerings(N.data.notes);
    N.win = [0, 7]; N.winAt = 0;
    $('#note-empty').classList.add('hidden');
    $('#note-info').textContent =
      `${N.data.count} nota · ${N.data.low}–${N.data.high}`;
    const a = $('#note-midi');
    a.href = `/api/songs/${song.id}/midi/${stem}`;
    a.download = `${base} - ${stem}.mid`;
    a.classList.remove('hidden');
    drawRoll();
    return;
  }

  const body = await res.json();
  const job = body.job;
  const el = $('#note-empty');
  el.classList.remove('hidden');

  if (job && (job.state === 'running' || job.state === 'queued')) {
    el.innerHTML = `<span>${job.stage || 'sırada'}…</span>`;
    N.poll = setTimeout(() => loadNotes(song, stem), 2500);
  } else if (job && job.state === 'error') {
    el.innerHTML = '<span>Nota çıkarma başarısız oldu.</span>';
  } else if (body.available === false) {
    el.innerHTML = '<span>Nota çıkarma ortamı kurulu değil ' +
                   '(<code>.venv-transcribe</code>).</span>';
  } else {
    el.innerHTML = `<span>Bu kanalın notaları henüz çıkarılmadı.</span>
      <button class="btn sec" id="btn-transcribe">Notaları çıkar</button>`;
    $('#btn-transcribe').onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'başlatılıyor…';
      await fetch(`/api/songs/${song.id}/transcribe?stem=${stem}`, { method: 'POST' });
      loadNotes(song, stem);
    };
  }
}

/* Roll'un gosterdigi zaman araligi.

   Dongu aciksa oraya yakinlasiyoruz. Tum sarkiyi gostermek 1713 notayi
   900 piksele sikistiriyor ve nota degil doku gibi gorunuyor; asil
   calisma da zaten dongu icinde oldugu icin yakinlasmak dogru olan. */
function rollRange() {
  if (loopActive()) {
    const pad = (P.loopB - P.loopA) * 0.06;
    return [Math.max(0, P.loopA - pad), Math.min(P.duration, P.loopB + pad)];
  }
  return [0, P.duration];
}

/* Piano roll: x ekseni zaman, y ekseni perde. */
function drawRoll() {
  const cv = $('#roll');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  if (!N.data || !N.data.notes.length || !P.duration) return;

  const [t0, t1] = rollRange();
  const tspan = Math.max(t1 - t0, 0.1);
  const vis = N.data.notes.filter(([s, e]) => e >= t0 && s <= t1);

  // Perde eksenini GORUNEN notalara gore olcekle. Tum sarkinin araligini
  // kullanmak, dongude birkac yarim tonluk bir pasaj varken cubuklari
  // 3 piksele sikistiriyordu.
  const src = vis.length ? vis.map((n) => n[2]) : [N.data.low_midi, N.data.high_midi];
  const lo = Math.min(...src) - 1, hi = Math.max(...src) + 1;
  const span = Math.max(hi - lo, 6);
  const y = (p) => h - ((p - lo + 0.5) / span) * h;
  const rowH = Math.max(2, h / span);

  // Acik tel kilavuzlari - gitar/bas icin parmak yerini kestirmeye yarar
  if (N.stem === 'gitar' || N.stem === 'bas') {
    c.font = '9px "Segoe UI",sans-serif';
    for (const [name, p] of OPEN_STRINGS) {
      if (p < lo || p > hi) continue;
      const yy = y(p);
      c.strokeStyle = 'rgba(255,255,255,.07)';
      c.beginPath(); c.moveTo(0, yy); c.lineTo(w, yy); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.22)';
      c.fillText(name, 3, yy - 2);
    }
  }

  const color = (STEMS.find((s) => s.id === N.stem) || {}).color || '#ffb347';
  const zoomed = t1 - t0 < P.duration - 0.01;
  const barH = Math.max(rowH - 1, 2);

  for (const [st, en, p, amp] of vis) {
    const x0 = ((st - t0) / tspan) * w;
    const x1 = ((en - t0) / tspan) * w;
    c.globalAlpha = 0.35 + Math.min(0.65, amp);
    c.fillStyle = color;
    c.fillRect(x0, y(p) - barH / 2, Math.max(x1 - x0, 1.2), barH);
  }

  // Cubuk yeterince genis ve yuksekse nota adini uzerine yaz
  c.globalAlpha = 1;
  if (barH >= 7.5) {
    c.font = `700 ${Math.min(11, Math.round(barH + 1))}px "Segoe UI",sans-serif`;
    c.fillStyle = 'rgba(13,14,18,.9)';
    c.textBaseline = 'middle';
    for (const [st, en, p] of vis) {
      if ((en - st) / tspan * w < 20) continue;
      c.fillText(N.data.names[String(p)], ((st - t0) / tspan) * w + 4, y(p));
    }
  }
  $('#roll-zoom').textContent = zoomed
    ? `döngüye yakınlaşıldı · ${vis.length} nota` : '';
}

/* Gitar klavyesi: o anda basili olan pozisyonlari yakar. */
function drawFret(pos) {
  const cv = $('#fret');
  const hint = $('#fret-hint');
  if (!N.data || !N.fing) {
    Fretboard.drawFretboard(cv, { active: [], window: [0, 7], pad: { l: 40 } });
    hint.textContent = N.data ? '' : 'notalar çıkarılmadı';
    return;
  }
  const active = Fretboard.activeAt(N.data.notes, N.fing, pos);

  // Perde penceresini her karede kaydirmak gozu yoruyor; sadece calinan
  // nota pencerenin disina cikinca yeniden konumlandiriyoruz
  const fretted = active.filter((a) => a.fret > 0).map((a) => a.fret);
  if (fretted.length) {
    const lo = Math.min(...fretted), hi = Math.max(...fretted);
    if (lo < N.win[0] || hi > N.win[1]) N.win = Fretboard.fretWindow(active, 7);
  }
  Fretboard.drawFretboard(cv, { active, window: N.win, pad: { l: 40 } });
  hint.textContent = `perde ${N.win[0]}–${N.win[1]}`;
}

/* Oynatma kafasindaki notalar + bunlardan cikan akor adi. */
function renderNoteNow(pos) {
  const box = $('#note-now');
  const badge = $('#chord-badge');
  // Rozet hicbir zaman gizlenmiyor, sadece bosaliyor: gizlemek yuksekligi
  // degistirip panelin zipllamasina yol aciyordu
  const blank = () => { badge.className = 'chord empty'; badge.innerHTML = ''; };
  if (!N.data) { box.innerHTML = ''; blank(); return; }

  // Indisleri de tutuyoruz: parmak pozisyonu nota BASINA secildigi icin
  // (ayni perde farkli anlarda farkli telde calinabilir) perdeye gore
  // aranan bir harita yetmiyor
  const liveIdx = [];
  N.data.notes.forEach((n, i) => { if (n[0] <= pos && pos < n[1]) liveIdx.push(i); });
  const live = liveIdx.map((i) => N.data.notes[i]);
  const anChord = analysisChordAt(pos);

  if (!live.length) {
    box.innerHTML = '';
    // Nota yoksa bile analiz akorunu gosterelim - sustaki bir anda ya da
    // transkripsiyonun kacirdigi yerde tamamen bos kalmasin
    if (anChord) {
      badge.className = 'chord only-analysis';
      badge.innerHTML = `<span class="cname">${anChord}</span>
        <span class="csub">analiz</span>`;
    } else blank();
    return;
  }

  const ch = nameChord(live.map((n) => n[2]));
  if (ch) {
    // Kok notalari karsilastiriyoruz. Analiz sadece maj/min/5 uretebiliyor,
    // transkripsiyon 7'li ve sus'lu da bulabiliyor; tipleri kiyaslamak
    // "E7 vs E5" gibi aslinda uyusan durumlari uyusmaz gosterirdi.
    const root = (s) => (s.match(/^[A-G]#?/) || [''])[0];
    const agree = anChord && root(anChord) === root(ch.label);
    badge.className = 'chord' + (ch.exact ? '' : ' approx') + (agree ? ' agree' : '');
    badge.innerHTML = `<span class="cname">${ch.label}</span>
      <span class="csub">${ch.notes.join(' ')}${ch.exact ? '' : ' · yaklaşık'}${
        anChord ? (agree ? ' · analiz ✓' : ` · analiz: ${anChord}`) : ''}</span>`;
  } else {
    blank();
  }

  box.innerHTML = liveIdx.slice(0, 6).map((i) => {
    const p = N.data.notes[i][2];
    const fg = N.fing && N.fing[i];
    const f = fg ? { string: Fretboard.STRING_NAMES[fg[0]], fret: fg[1] }
                 : N.data.frets[String(p)];
    const pos2 = f ? `<small>${f.string}/${f.fret}</small>` : '';
    return `<span class="nn">${N.data.names[String(p)]}${pos2}</span>`;
  }).join('');
}

/* ====================================================================
   DALGA FORMU
   Toplam miksin zarfi + uzerine gitar kanalinin zarfi. Gitarin nerede
   calindigini gozle gormek, calisirken bolum bulmayi kolaylastiriyor.
   ==================================================================== */

const WAVE_BINS = 900;

function envelopeOf(data, bins) {
  const n = data.length;
  const per = Math.floor(n / bins) || 1;
  const out = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    let peak = 0;
    const start = i * per, end = Math.min(start + per, n);
    for (let j = start; j < end; j += 8) {
      const v = data[j] < 0 ? -data[j] : data[j];
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  return out;
}

function computePeaks(envs) {
  const mix = new Float32Array(WAVE_BINS);
  for (const e of envs) for (let i = 0; i < WAVE_BINS; i++) mix[i] += e[i];
  let max = 0;
  for (let i = 0; i < WAVE_BINS; i++) if (mix[i] > max) max = mix[i];
  if (max > 0) for (let i = 0; i < WAVE_BINS; i++) mix[i] /= max;
  P.peaks = mix;

  const gi = STEMS.findIndex((s) => s.id === 'gitar');
  const g = envs[gi];
  if (g && max > 0) {
    const gg = new Float32Array(WAVE_BINS);
    for (let i = 0; i < WAVE_BINS; i++) gg[i] = g[i] / max;
    P.guitarEnv = gg;
  } else P.guitarEnv = null;
}

function drawWave() {
  const cv = $('#wave');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  if (!P.peaks) return;

  const mid = h / 2, bw = w / WAVE_BINS;
  c.fillStyle = '#3a4152';
  for (let i = 0; i < WAVE_BINS; i++) {
    const a = Math.max(1, P.peaks[i] * (h * 0.46));
    c.fillRect(i * bw, mid - a, Math.max(bw - 0.35, 0.6), a * 2);
  }
  if (P.guitarEnv) {
    c.fillStyle = 'rgba(255,179,71,.75)';
    for (let i = 0; i < WAVE_BINS; i++) {
      const a = Math.max(0.7, P.guitarEnv[i] * (h * 0.46));
      c.fillRect(i * bw, mid - a, Math.max(bw - 0.35, 0.6), a * 2);
    }
  }
}

/* ====================================================================
   ÇİZİM DÖNGÜSÜ
   ==================================================================== */

const meterBuf = new Float32Array(1024);
const canvasSize = { wave: '', roll: '' };

/* Canvas'lar esnek kutularda; olculeri layout'a gore degisiyor. Yeniden
   cizim gerekip gerekmedigini boyut degisiminden anliyoruz - pencere
   resize'i tek basina yetmiyor (kolonlar birbirine gore uzayip kisaliyor). */
function checkCanvasSizes() {
  const w = $('#wave'), r = $('#roll');
  const ws = `${w.clientWidth}x${w.clientHeight}`;
  const rs = `${r.clientWidth}x${r.clientHeight}`;
  if (ws !== canvasSize.wave) { canvasSize.wave = ws; drawWave(); }
  if (rs !== canvasSize.roll) { canvasSize.roll = rs; drawRoll(); }
  // Klavye her karede zaten yeniden ciziliyor, boyut takibi gerekmiyor
}

function render() {
  const pos = position();
  $('#t-cur').textContent = fmt(pos);
  const w = $('.wave-wrap').clientWidth;
  const frac = P.duration ? pos / P.duration : 0;
  $('#playhead').style.left = (frac * w) + 'px';

  // Roll kendi araligini gosteriyor (dongu aciksa yakinlasmis)
  const [rt0, rt1] = rollRange();
  const rf = Math.max(0, Math.min(1, (pos - rt0) / Math.max(rt1 - rt0, 0.1)));
  $('#roll-head').style.left = (rf * $('.notes-body').clientWidth) + 'px';
  renderNoteNow(pos);
  drawFret(pos);

  const band = $('#loop-band');
  if (loopActive()) {
    band.classList.remove('hidden');
    // Kisa dongu uzun sarkida birkac piksel kaliyor; goze gorunur bir
    // taban genislik veriyoruz ki calisirken nerede oldugunu secebilesin.
    const x = (P.loopA / P.duration) * w;
    const raw = ((P.loopB - P.loopA) / P.duration) * w;
    const bw = Math.max(raw, 10);
    band.style.left = Math.max(0, Math.min(x - (bw - raw) / 2, w - bw)) + 'px';
    band.style.width = bw + 'px';
    $('#t-loop').textContent = `döngü ${fmt(P.loopA)} – ${fmt(P.loopB)}`;
  } else {
    band.classList.add('hidden');
    $('#t-loop').textContent = '';
  }
}

function tick() {
  checkCanvasSizes();
  render();
  for (const s of STEMS) {
    const a = P.analysers[s.id];
    const bar = document.querySelector(`#ch-${s.id} .meter > i`);
    if (!a || !bar) continue;
    a.getFloatTimeDomainData(meterBuf);
    let sum = 0;
    for (let i = 0; i < meterBuf.length; i++) sum += meterBuf[i] * meterBuf[i];
    const db = 20 * Math.log10(Math.max(Math.sqrt(sum / meterBuf.length), 1e-6));
    bar.style.height = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%';
  }
  if (P.playing && !loopActive() && position() >= P.duration - 0.05) pause();
  P.raf = requestAnimationFrame(tick);
}

/* ====================================================================
   KONTROLLER
   ==================================================================== */

function markLoop() {
  // A > B girildiyse sessizce takasla; kullaniciyi uyarmaya degmez
  if (P.loopA !== null && P.loopB !== null && P.loopA > P.loopB) {
    const t = P.loopA; P.loopA = P.loopB; P.loopB = t;
  }
  $('#btn-a').classList.toggle('set', P.loopA !== null);
  $('#btn-b').classList.toggle('set', P.loopB !== null);
  P.lastInput = position();
  P.lastInputAt = P.ctx.currentTime;
  push({});
  drawRoll();      // dongu degisti -> roll'un yakinlasma araligi da degisti
  render();
}

function initControls() {
  $('#btn-play').onclick = () => (P.playing ? pause() : play());
  $('#btn-back').onclick = () => seek(position() - 10);
  $('#btn-fwd').onclick = () => seek(position() + 10);

  $('#master').oninput = (e) => {
    if (P.master) P.master.gain.value = parseFloat(e.target.value);
  };

  $('#rate').oninput = (e) => setRate(parseFloat(e.target.value));
  $('#btn-rate-reset').onclick = () => setRate(1);
  $('#btn-pitch-dn').onclick = () => setPitch(P.semitones - 1);
  $('#btn-pitch-up').onclick = () => setPitch(P.semitones + 1);
  $('#btn-pitch-reset').onclick = () => setPitch(0);

  $('#btn-a').onclick = () => { P.loopA = position(); markLoop(); };
  $('#btn-b').onclick = () => { P.loopB = position(); markLoop(); };
  $('#btn-loop-clear').onclick = () => { P.loopA = P.loopB = null; markLoop(); };

  const seekFromClick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * P.duration);
  };
  $('.wave-wrap').onclick = seekFromClick;
  $('.notes-body').onclick = (e) => {
    // Bos panelde dugmeye basiliyorsa konum degistirme
    if (e.target.closest('button, a')) return;
    const r = e.currentTarget.getBoundingClientRect();
    const [t0, t1] = rollRange();
    seek(t0 + ((e.clientX - r.left) / r.width) * (t1 - t0));
  };

  $('#btn-library').onclick = () => {
    pause();
    clearTimeout(analysisPoll);
    clearTimeout(N.poll);
    showView('library');
    loadLibrary();
    refreshSources();
  };

  // Gamlar sayfasi calmayi durdurmuyor - sarki calarken gama bakabilirsin
  $('#btn-scales').onclick = () => {
    showView('scales');
    buildScaleUI();
    updateScaleFromSong();
    renderScales();
  };

  // Kutuphane suzme/siralama - hepsi istemcide, sunucuya gitmiyor
  $('#lib-search').oninput = (e) => { LIB.search = e.target.value; renderLibrary(); };
  $('#lib-state').onchange = (e) => { LIB.state = e.target.value; renderLibrary(); };
  $('#lib-sort').onchange = (e) => { LIB.sort = e.target.value; renderLibrary(); };
  $('#btn-orphans').onclick = scanOrphans;
  document.addEventListener('click', closeMenus);
  initSources();

  $('#file-input').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    await fetch('/api/upload', { method: 'POST', body: fd });
    e.target.value = '';
    loadLibrary();
  };

  window.addEventListener('resize', () => { drawWave(); drawRoll(); render(); });

  document.addEventListener('keydown', (e) => {
    if ($('#player').classList.contains('hidden')) return;
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    const n = parseInt(e.key, 10);

    if (e.code === 'Space') { e.preventDefault(); P.playing ? pause() : play(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(position() - 5); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seek(position() + 5); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setRate(P.rate - 0.05); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setRate(P.rate + 0.05); }
    else if (e.key === 'a' || e.key === 'A') { P.loopA = position(); markLoop(); }
    else if (e.key === 'b' || e.key === 'B') { P.loopB = position(); markLoop(); }
    else if (e.key === '-' || e.key === '_') setPitch(P.semitones - 1);
    else if (e.key === '+' || e.key === '=') setPitch(P.semitones + 1);
    else if (n >= 1 && n <= 6) {
      const s = STEMS[n - 1];
      const sel = e.shiftKey ? 'solo' : 'mute';
      P[sel][s.id] = !P[sel][s.id];
      const btn = document.querySelector(`#ch-${s.id} .${e.shiftKey ? 'b-s' : 'b-m'}`);
      btn.classList.toggle(e.shiftKey ? 'on-s' : 'on-m', P[sel][s.id]);
      applyGains();
    }
  });
}

initControls();
loadLibrary();
refreshSources();
