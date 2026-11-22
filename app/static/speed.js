/* Hiz calismasi: A-B dongusu ve turdan tura hizlanma.

   Yalnizca karar mantigi; sese ve sayfaya dokunmuyor (node'da test
   edilebilsin diye). Cagiran taraf zamani veriyor, donen komutu uyguluyor.
   Hizlar tam sayi yuzde: 0.05 toplamanin kayan nokta artiklari olmasin.
*/
(function (root) {
'use strict';

const MIN_LEN = 0.5;       // bundan kisa dongu kurulmaz (sn)
// mp3'te atlama A'nin birkac ms oncesine dusebiliyor; pay olmazsa surekli
// yeniden A'ya atlanir
const SLACK = 0.3;
const DEFAULTS = { from: 60, to: 100, step: 5, every: 2 };

/* Biten tur sayisindan o turun hizi. */
function rateAt(cfg, done) {
  const to = Math.max(cfg.from, cfg.to);
  return Math.min(to, cfg.from + Math.floor(done / cfg.every) * cfg.step);
}

/* t'ye en yakin olcu basi; after verilirse yalnizca ondan sonrakiler. */
function snapToBar(t, grid, down, perBar, after = -Infinity) {
  let best = null;
  for (let i = ((down % perBar) + perBar) % perBar; i < grid.length; i += perBar) {
    if (grid[i] < 0 || grid[i] < after + MIN_LEN) continue;
    if (best === null || Math.abs(grid[i] - t) < Math.abs(best - t)) best = grid[i];
  }
  return best;
}

class Trainer {
  constructor() {
    this.a = null; this.b = null;
    this.cfg = { ...DEFAULTS };
    this.on = false;
    this.done = 0;
    this.whole = false;    // bu tur A'dan beri kesintisiz mi
  }

  get looping() { return this.a !== null && this.b !== null; }
  get rate() { return rateAt(this.cfg, this.done); }
  get atTarget() { return this.rate >= Math.max(this.cfg.from, this.cfg.to); }

  setA(t) {
    this.stop();
    this.a = t;
    if (this.b !== null && this.b - t < MIN_LEN) this.b = null;
  }

  setB(t) {
    if (this.a === null || t - this.a < MIN_LEN) return false;
    this.stop();
    this.b = t;
    return true;
  }

  clear() { this.stop(); this.a = this.b = null; }

  start() {
    if (!this.looping) return false;
    this.on = true; this.done = 0; this.whole = true;
    return true;
  }

  stop() { this.on = false; }

  /* Kullanici atladi: yarim tur hiz artirmasin. */
  moved(t) { this.whole = this.looping && Math.abs(t - this.a) <= SLACK; }

  /* Calarken cagrilir. null ya da { seek, rate? }. */
  tick(t, ended = false) {
    if (!this.looping) return null;
    if (ended || t >= this.b) {
      const out = { seek: this.a };
      if (this.on && this.whole) {
        this.done++;
        out.rate = this.rate;
      }
      this.whole = true;
      return out;
    }
    if (t < this.a - SLACK) {
      this.whole = true;
      return { seek: this.a };
    }
    return null;
  }
}

const api = { Trainer, rateAt, snapToBar, DEFAULTS, MIN_LEN };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.Speed = api;
}(typeof window !== 'undefined' ? window : this));
