'use strict';

/* Kanallar. Sira mikserdeki soldan saga sirayla ayni; gitar basta cunku
   bu uygulamanin varlik sebebi o. */
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
    s.state === 'running'
      ? `${job.stage || ''} · %${pct}`
      : meta.join(' · ');

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
   SES MOTORU
   Her kanal:  AudioBufferSourceNode -> Analyser -> Gain -> Master
   Olcer fader'dan ONCE: kanali kissan bile icinde ne oldugunu gorursun.
   ==================================================================== */

const P = {
  ctx: null, buffers: {}, gains: {}, analysers: {}, sources: {},
  master: null, playing: false, startedAt: 0, offset: 0, duration: 0,
  loopA: null, loopB: null, song: null, raf: 0,
  vol: {}, mute: {}, solo: {}, peaks: null, guitarEnv: null,
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

function position() {
  if (!P.playing) return P.offset;
  const elapsed = P.ctx.currentTime - P.startedAt;
  if (loopActive()) {
    const len = P.loopB - P.loopA;
    const base = (P.offset >= P.loopA && P.offset < P.loopB) ? P.offset : P.loopA;
    return P.loopA + (((base - P.loopA) + elapsed) % len);
  }
  return Math.min(P.offset + elapsed, P.duration);
}

function startSources(at) {
  for (const s of STEMS) {
    const buf = P.buffers[s.id];
    if (!buf) continue;
    const src = P.ctx.createBufferSource();
    src.buffer = buf;
    if (loopActive()) {
      src.loop = true;
      src.loopStart = P.loopA;
      src.loopEnd = P.loopB;
    }
    src.connect(P.analysers[s.id]);
    src.start(0, at);
    P.sources[s.id] = src;
  }
}

function stopSources() {
  for (const id in P.sources) {
    try { P.sources[id].stop(); } catch (e) { /* zaten durmus */ }
    P.sources[id].disconnect();
  }
  P.sources = {};
}

async function play() {
  if (P.playing) return;
  if (P.ctx.state === 'suspended') await P.ctx.resume();
  let at = P.offset;
  if (loopActive() && (at < P.loopA || at >= P.loopB)) at = P.loopA;
  if (!loopActive() && at >= P.duration - 0.05) at = 0;
  P.offset = at;
  startSources(at);
  P.startedAt = P.ctx.currentTime;
  P.playing = true;
  $('#btn-play').textContent = '❚❚';
}

function pause() {
  if (!P.playing) return;
  P.offset = position();
  stopSources();
  P.playing = false;
  $('#btn-play').textContent = '▶';
}

function seek(t) {
  const was = P.playing;
  if (was) { stopSources(); P.playing = false; }
  P.offset = Math.max(0, Math.min(t, P.duration));
  if (was) play(); else render();
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

  if (!P.ctx) {
    P.ctx = new (window.AudioContext || window.webkitAudioContext)();
    P.master = P.ctx.createGain();
    P.master.gain.value = parseFloat($('#master').value);
    P.master.connect(P.ctx.destination);
  }

  stopSources();
  P.playing = false;
  P.offset = 0;
  P.loopA = P.loopB = null;
  P.buffers = {};

  buildMixer();

  // Kanallari sirayla indir + coz. Sirayla, cunku es zamanli cozme
  // bellek tepesini gereksiz yukseltiyor.
  for (let i = 0; i < STEMS.length; i++) {
    const s = STEMS[i];
    $('#loading-text').textContent = `${s.label} yükleniyor… (${i + 1}/${STEMS.length})`;
    $('#loading-bar').style.width = ((i / STEMS.length) * 100) + '%';
    const buf = await fetch(`/audio/${song.id}/${s.id}`).then((r) => r.arrayBuffer());
    P.buffers[s.id] = await P.ctx.decodeAudioData(buf);
  }
  $('#loading-bar').style.width = '100%';

  P.duration = Math.max(...STEMS.map((s) => P.buffers[s.id]?.duration || 0));
  $('#t-dur').textContent = fmt(P.duration);

  computePeaks();
  drawWave();
  applyGains();
  $('#loading').classList.add('hidden');

  cancelAnimationFrame(P.raf);
  tick();
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
    g.connect(P.master);
    const a = P.ctx.createAnalyser();
    a.fftSize = 1024;
    a.connect(g);
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
   Toplam miksin zarfi + uzerine gitar kanalinin zarfi.
   Gitarin nerede calindigini gozle gormek, calisirken bolum bulmayi
   ciddi kolaylastiriyor.
   ==================================================================== */

const WAVE_BINS = 900;

function envelopeOf(buffer, bins) {
  const data = buffer.getChannelData(0);
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

function computePeaks() {
  const envs = STEMS.map((s) => P.buffers[s.id] ? envelopeOf(P.buffers[s.id], WAVE_BINS) : null);
  const mix = new Float32Array(WAVE_BINS);
  for (const e of envs) {
    if (!e) continue;
    for (let i = 0; i < WAVE_BINS; i++) mix[i] += e[i];
  }
  let max = 0;
  for (let i = 0; i < WAVE_BINS; i++) if (mix[i] > max) max = mix[i];
  if (max > 0) for (let i = 0; i < WAVE_BINS; i++) mix[i] /= max;
  P.peaks = mix;

  const gi = STEMS.findIndex((s) => s.id === 'gitar');
  const g = envs[gi];
  if (g) {
    const gg = new Float32Array(WAVE_BINS);
    for (let i = 0; i < WAVE_BINS; i++) gg[i] = max > 0 ? g[i] / max : 0;
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
    const rms = Math.sqrt(sum / meterBuf.length);
    const db = 20 * Math.log10(Math.max(rms, 1e-6));
    bar.style.height = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%';
  }
  if (P.playing && !loopActive() && position() >= P.duration - 0.03) {
    pause();
    P.offset = 0;
  }
  P.raf = requestAnimationFrame(tick);
}

/* ====================================================================
   KONTROLLER
   ==================================================================== */

function initControls() {
  $('#btn-play').onclick = () => (P.playing ? pause() : play());
  $('#btn-back').onclick = () => seek(position() - 10);
  $('#btn-fwd').onclick = () => seek(position() + 10);

  $('#master').oninput = (e) => {
    if (P.master) P.master.gain.value = parseFloat(e.target.value);
  };

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
    else if (e.key === 'a' || e.key === 'A') { P.loopA = position(); markLoop(); }
    else if (e.key === 'b' || e.key === 'B') { P.loopB = position(); markLoop(); }
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

function markLoop() {
  // A > B girildiyse sessizce takasla; kullaniciyi uyarmaya degmez
  if (P.loopA !== null && P.loopB !== null && P.loopA > P.loopB) {
    const t = P.loopA; P.loopA = P.loopB; P.loopB = t;
  }
  $('#btn-a').classList.toggle('set', P.loopA !== null);
  $('#btn-b').classList.toggle('set', P.loopB !== null);
  // Dongu sinirlari degistiyse kaynaklari yeniden kur
  if (P.playing) { const t = position(); stopSources(); P.playing = false; P.offset = t; play(); }
  render();
}

initControls();
loadLibrary();
