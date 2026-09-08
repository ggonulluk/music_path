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
  { id: 'gitar',  label: 'Gitar'  },
  { id: 'vokal',  label: 'Vokal'  },
  { id: 'davul',  label: 'Davul'  },
  { id: 'bas',    label: 'Bas'    },
  { id: 'piyano', label: 'Piyano' },
  { id: 'diger',  label: 'Diğer'  },
];

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

async function loadLibrary() {
  const songs = await fetch('/api/songs').then((r) => r.json());
  const list = $('#song-list');
  list.innerHTML = '';
  $('#library-empty').classList.toggle('hidden', songs.length > 0);

  let busy = false;
  for (const s of songs) {
    if (s.state === 'running' || s.state === 'queued') busy = true;
    list.appendChild(songRow(s));
  }

  clearTimeout(pollTimer);
  if (busy) pollTimer = setTimeout(loadLibrary, 1500);
}

function songRow(s) {
  const el = document.createElement('div');
  el.className = 'song';

  const label = {
    ready: 'hazır', raw: 'ayrılmadı', running: 'ayrılıyor',
    queued: 'sırada', error: 'hata',
  }[s.state] || s.state;

  const meta = [];
  if (s.artist) meta.push(s.artist);
  if (s.duration) meta.push(fmt(s.duration));
  if (s.state === 'ready') meta.push(s.stems.length + ' kanal');

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
  $('#library').classList.add('hidden');
  $('#player').classList.remove('hidden');
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

function render() {
  const pos = position();
  $('#t-cur').textContent = fmt(pos);
  const w = $('.wave-wrap').clientWidth;
  $('#playhead').style.left = (P.duration ? (pos / P.duration) * w : 0) + 'px';

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

  $('.wave-wrap').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * P.duration);
  };

  $('#btn-library').onclick = () => {
    pause();
    $('#player').classList.add('hidden');
    $('#library').classList.remove('hidden');
    loadLibrary();
  };

  $('#file-input').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    await fetch('/api/upload', { method: 'POST', body: fd });
    e.target.value = '';
    loadLibrary();
  };

  window.addEventListener('resize', () => { drawWave(); render(); });

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
