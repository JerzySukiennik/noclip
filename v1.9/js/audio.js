// NOCLIP - audio engine. Real recordings are fetched from Wikimedia Commons direct
// URLs (CORS-open); every sample has a synthesised fallback so the tape never runs
// silent. Local files dropped in audio/ override the music beds.

const CM = (name) => name; // resolved to a hashed commons path at boot

const SAMPLES = {
  buzz:   { file: 'Fluorescent lamp-electronic ballast-sound ANr°0001.ogg', loop: true },
  mains:  { file: 'Mains hum 60 Hz.ogg', loop: true },
  growl:  { file: 'Monster growls.ogg' },
  growl2: { file: 'Monster growls 2.ogg' },
  scream: { file: 'Nick121087 - Demonic Woman Scream (cc0) (freesound).mp3' },
  wail:   { file: "UVB 76 'A WOMANS SCREAM'.ogg" },
  thud:   { file: 'Dull thud.ogg' },
  static: { file: 'White-noise-sound-20sec-mono-44100Hz.ogg', loop: true },
  breath: { file: 'Heavy breathing 3.ogg' },
  steps:  { file: 'Pasos en escalera de caracol.ogg' },
  chase:  { file: 'Creepy footsteps and screaming and growl.wav' }
};

async function md5hex(str) {
  // Commons stores files at /<m[0]>/<m[0:2]>/<name>; md5 in pure JS, no deps.
  const msg = new TextEncoder().encode(str);
  const K = new Int32Array(64), S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
    5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
    6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  for (let i = 0; i < 64; i++) K[i] = (Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  const len = msg.length;
  const withPad = new Uint8Array((((len + 8) >> 6) + 1) * 64);
  withPad.set(msg); withPad[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 8, bits >>> 0, true);
  dv.setUint32(withPad.length - 4, Math.floor(bits / 4294967296), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const rl = (x, c) => (x << c) | (x >>> (32 - c));
  for (let off = 0; off < withPad.length; off += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B; B = (B + rl(F, S[i])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const hex = (n) => { let s = ''; for (let i = 0; i < 4; i++) s += ((n >>> (i * 8)) & 255).toString(16).padStart(2, '0'); return s; };
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

async function commonsUrl(file) {
  const u = file.replace(/ /g, '_');
  const h = await md5hex(u);
  return `https://upload.wikimedia.org/wikipedia/commons/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(u)}`;
}

// Situational slots. A slot holds either one entry or a shuffled list of them.
export const SLOTS = ['menu', 'explore', 'stalk', 'hunt', 'resume', 'end'];

function entry(v) {
  if (!v) return null;
  const o = typeof v === 'string' ? { file: v } : v;
  if (!o.file) return null;
  return {
    url: 'audio/' + encodeURIComponent(o.file),
    start: typeof o.start === 'number' ? o.start : 0,
    end: typeof o.end === 'number' ? o.end : 0
  };
}

function normaliseManifest(man) {
  const out = {};
  for (const k of SLOTS) out[k] = k === 'menu' || k === 'hunt' || k === 'end' ? null : [];
  if (!man) return out;
  for (const k of SLOTS) {
    const v = man[k];
    if (Array.isArray(v)) out[k] = v.map(entry).filter(Boolean);
    else if (v) {
      const e = entry(v);
      out[k] = (k === 'explore' || k === 'stalk' || k === 'resume') ? (e ? [e] : []) : e;
    }
  }
  return out;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.buf = {};
    this.ready = false;
    this.muted = false;
    this.loops = {};
    this.fetched = 0;
    this.failed = [];
    this.musicMode = null;
    this.musicScale = 1;
    this.tracks = null;
    this.hasMusic = false;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(c.destination);
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.knee.value = 12;
    this.comp.connect(this.master);
    this.busAmb = c.createGain(); this.busAmb.gain.value = 0.55; this.busAmb.connect(this.comp);
    this.busSfx = c.createGain(); this.busSfx.gain.value = 1.0; this.busSfx.connect(this.comp);
    this.busMus = c.createGain(); this.busMus.gain.value = 0.0; this.busMus.connect(this.comp);
    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') {
      const p = this.ctx.resume();
      if (p && p.catch) p.catch(() => { /* another gesture will come */ });
    }
  }

  // A media element whose play() was rejected before the first gesture stays paused
  // for good unless it is asked again.
  kick() {
    if (!this.el || !this.musicMode || !this.hasMusic) return;
    if (!this.el.paused || !this.el.src) return;
    if (this.current && this.current.start) { try { this.el.currentTime = this.current.start; } catch (e) { } }
    const p = this.el.play();
    if (p && p.catch) p.catch(() => { });
  }

  async load(onProgress) {
    this.init();
    // Local music first: it is on disk and must never wait on a remote host.
    await this.loadLocalMusic();
    if (this.hasMusic && this.musicMode) { const m = this.musicMode; this.musicMode = null; this.setMusic(m); }

    const names = Object.keys(SAMPLES);
    let done = 0;
    for (const n of names) {
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const url = await commonsUrl(SAMPLES[n].file);
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 12000);
          const r = await fetch(url, { mode: 'cors', signal: ctl.signal });
          clearTimeout(timer);
          if (!r.ok) throw new Error(r.status);
          const ab = await r.arrayBuffer();
          this.buf[n] = await this.ctx.decodeAudioData(ab);
          this.fetched++;
          ok = true;
        } catch (e) {
          if (attempt === 0) await new Promise(r => setTimeout(r, 900));
        }
      }
      if (!ok) { this.failed.push(n); this.buf[n] = this.synth(n); }
      done++;
      if (onProgress) onProgress(done / names.length);
      await new Promise(r => setTimeout(r, 90));
    }
    this.stepSpots = this.buf.steps ? this.loudSpots(this.buf.steps, 0.30) : [];
    this.growlSpots = this.buf.growl ? this.loudSpots(this.buf.growl, 1.6) : [];
    this.growl2Spots = this.buf.growl2 ? this.loudSpots(this.buf.growl2, 1.6) : [];
    this.screamSpots = this.buf.scream ? this.loudSpots(this.buf.scream, 0.8) : [];
    this.breathSpots = this.buf.breath ? this.loudSpots(this.buf.breath, 1.2) : [];
    return { fetched: this.fetched, failed: this.failed.slice(), music: this.hasMusic };
  }

  // Music streams through an <audio> element instead of decodeAudioData: the
  // tracks run to minutes each, and decoding them all would cost hundreds of MB.
  async loadLocalMusic() {
    let man = null;
    try {
      const r = await fetch('audio/manifest.json', { cache: 'no-store' });
      if (r.ok) man = await r.json();
    } catch (e) { /* no manifest is fine - the synth beds take over */ }

    this.tracks = normaliseManifest(man);
    // The manifest is committed but the audio is gitignored, so a deployed build
    // routinely lists tracks that are not there. Probe once, up front.
    this.tracks = await this._pruneMissing(this.tracks);
    this.hasMusic = SLOTS.some(k => (Array.isArray(this.tracks[k]) ? this.tracks[k].length : this.tracks[k]));
    if (this.hasMusic) this._initPlayer();
    return this.hasMusic;
  }

  async _pruneMissing(t) {
    const exists = async (e) => {
      if (!e || !e.url) return false;
      try {
        const r = await fetch(e.url, { method: 'HEAD', cache: 'no-store' });
        return r.ok;
      } catch (err) { return false; }
    };
    const out = {};
    for (const k of SLOTS) {
      const v = t[k];
      if (Array.isArray(v)) {
        const keep = await Promise.all(v.map(exists));
        out[k] = v.filter((_, i) => keep[i]);
      } else {
        out[k] = (await exists(v)) ? v : null;
      }
    }
    return out;
  }

  _initPlayer() {
    const el = new window.Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    this.el = el;
    this.elSrc = this.ctx.createMediaElementSource(el);
    this.elGain = this.ctx.createGain();
    this.elGain.gain.value = 0;
    this.elSrc.connect(this.elGain);
    this.elGain.connect(this.busMus);
    this.queue = [];
    this.queueMode = null;
    this.musicFails = 0;
    // A sliced track has to wrap at its own end, not the file's.
    el.addEventListener('timeupdate', () => {
      const e = this.current;
      if (!e || !e.end) return;
      if (el.currentTime >= e.end - 0.06) {
        if (this._slotList(this.musicMode).length < 2) { try { el.currentTime = e.start; } catch (err) { } }
        else { this._nextTrack(); }
      }
    });
    el.addEventListener('ended', () => { this.musicFails = 0; this._nextTrack(); });
    // Tracks can simply be absent (they are gitignored), so a run of failures
    // must fall back to the synth bed instead of retrying forever.
    el.addEventListener('error', () => {
      this.musicFails++;
      if (this.musicFails > 6) { this._noMusic(); return; }
      this._nextTrack(true);
    });
  }

  _shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  _slotList(mode) {
    const v = this.tracks && this.tracks[mode];
    return Array.isArray(v) ? v : (v ? [v] : []);
  }

  _nextTrack(immediate) {
    const mode = this.musicMode;
    const list = this._slotList(mode);
    if (!list.length) { this._fallback(mode); return; }
    if (!this.queue.length || this.queueMode !== mode) { this.queue = this._shuffled(list); this.queueMode = mode; }
    const next = this.queue.shift();
    if (!next) { this._fallback(mode); return; }
    clearTimeout(this._gap);
    // one track slot loops seamlessly; a real playlist gets silence between tracks
    const gap = immediate || list.length < 2 ? 0 : 4000 + Math.random() * 9000;
    this._gap = setTimeout(() => {
      if (this.musicMode !== mode) return;
      this._playEntry(next, this._volFor(mode), immediate ? 0.4 : 2.6);
    }, gap);
  }

  setMusicScale(v) {
    this.musicScale = Math.max(0, Math.min(1, v)) * 2;
    if (this.elGain && this.musicMode) {
      const g = this.elGain.gain, n = this.ctx.currentTime;
      g.cancelScheduledValues(n);
      g.setValueAtTime(Math.max(0.0001, g.value), n);
      g.linearRampToValueAtTime(Math.max(0.0001, this._volFor(this.musicMode)), n + 0.25);
    }
  }

  _volFor(mode) {
    const base = mode === 'menu' ? 0.52 : (mode === 'stalk' ? 0.34 : (mode === 'end' ? 0.55 : 0.40));
    return base * (this.musicScale == null ? 1 : this.musicScale);
  }

  _fallback(mode) {
    this._stopFile(0.4);
    this._drone(mode === 'hunt' ? 'chase' : 'ambient');
  }

  _playEntry(e, vol, fade = 2.6) {
    if (!this.el || !e) return;
    this.current = e;
    this.el.src = e.url;
    // After an error the element stays failed until load() is called.
    this.el.load();
    const seek = () => {
      try { if (e.start) this.el.currentTime = e.start; } catch (err) { /* seek once metadata lands */ }
    };
    if (this.el.readyState >= 1) seek();
    else this.el.addEventListener('loadedmetadata', seek, { once: true });
    const p = this.el.play();
    if (p && p.catch) p.catch(() => { /* blocked until the first gesture */ });
    const g = this.elGain.gain, n = this.ctx.currentTime;
    g.cancelScheduledValues(n);
    g.setValueAtTime(Math.max(0.0001, g.value), n);
    g.linearRampToValueAtTime(vol, n + fade);
  }

  _stopFile(fade) {
    if (!this.el) return;
    clearTimeout(this._gap);
    const g = this.elGain.gain, n = this.ctx.currentTime;
    g.cancelScheduledValues(n);
    g.setValueAtTime(Math.max(0.0001, g.value), n);
    g.linearRampToValueAtTime(0.0001, n + fade);
    const el = this.el;
    setTimeout(() => { if (this.elGain.gain.value < 0.01) { try { el.pause(); } catch (e) { } } }, fade * 1000 + 80);
  }

  // Sliced one-shots must start on a loud moment or they read as silence.
  loudSpots(buf, minGap) {
    const d = buf.getChannelData(0), sr = buf.sampleRate;
    const win = Math.floor(sr * 0.02);
    const spots = [];
    let last = -99;
    let peak = 0;
    for (let i = 0; i < d.length; i += win) {
      let s = 0;
      for (let k = 0; k < win && i + k < d.length; k++) s += d[i + k] * d[i + k];
      const rms = Math.sqrt(s / win);
      if (rms > peak) peak = rms;
    }
    for (let i = 0; i < d.length; i += win) {
      let s = 0;
      for (let k = 0; k < win && i + k < d.length; k++) s += d[i + k] * d[i + k];
      const rms = Math.sqrt(s / win);
      const t = i / sr;
      if (rms > peak * 0.42 && t - last > minGap) { spots.push(Math.max(0, t - 0.01)); last = t; }
    }
    return spots;
  }

  /* ------------------------------------------------------------- synth --- */

  noiseBuf(sec, colour = 1) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + colour * 0.02 * w) / (1 + colour * 0.02);
      d[i] = colour > 1 ? last * 8 : w;
    }
    return b;
  }

  synth(name) {
    const c = this.ctx, sr = c.sampleRate;
    const mk = (sec, fn) => {
      const n = Math.floor(sr * sec), b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = fn(i / sr, i / n);
      return b;
    };
    switch (name) {
      case 'buzz': case 'mains':
        return mk(2.0, (t) => (Math.sin(t * 2 * Math.PI * 120) * 0.35 + Math.sin(t * 2 * Math.PI * 240) * 0.18
          + Math.sin(t * 2 * Math.PI * 360) * 0.09 + (Math.random() - 0.5) * 0.05) * 0.5);
      case 'static':
        return mk(2.0, () => (Math.random() - 0.5) * 0.8);
      case 'thud':
        return mk(0.7, (t, p) => Math.sin(t * 2 * Math.PI * (78 - p * 46)) * Math.exp(-p * 7) * 0.9
          + (Math.random() - 0.5) * Math.exp(-p * 26) * 0.3);
      case 'growl': case 'growl2':
        return mk(2.4, (t, p) => {
          const lfo = 1 + Math.sin(t * 7.3) * 0.35;
          return (Math.sin(t * 2 * Math.PI * 58 * lfo) * 0.5 + Math.sin(t * 2 * Math.PI * 41) * 0.3
            + (Math.random() - 0.5) * 0.45) * Math.min(1, p * 6) * Math.exp(-p * 1.1);
        });
      case 'scream': case 'wail':
        return mk(1.6, (t, p) => {
          const f = 780 - p * 320 + Math.sin(t * 31) * 90;
          const s = Math.sin(t * 2 * Math.PI * f) + Math.sin(t * 2 * Math.PI * f * 1.5) * 0.6;
          return Math.tanh(s * 2.4) * Math.exp(-p * 2.2) * 0.8 + (Math.random() - 0.5) * 0.25 * Math.exp(-p * 4);
        });
      case 'breath':
        return mk(2.6, (t, p) => {
          const env = Math.abs(Math.sin(p * Math.PI * 3));
          return (Math.random() - 0.5) * env * 0.5;
        });
      case 'steps': case 'chase':
        return mk(0.34, (t, p) => (Math.random() - 0.5) * Math.exp(-p * 16) * 0.9);
      default:
        return mk(0.4, (t, p) => (Math.random() - 0.5) * Math.exp(-p * 9));
    }
  }

  /* -------------------------------------------------------------- play --- */

  play(name, o = {}) {
    if (!this.ready || this.muted) return null;
    const b = this.buf[name];
    if (!b) return null;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = o.rate || 1;
    if (o.loop) { src.loop = true; if (o.loopStart != null) { src.loopStart = o.loopStart; src.loopEnd = o.loopEnd || b.duration; } }
    const g = c.createGain();
    const vol = o.vol == null ? 1 : o.vol;
    const dur = o.dur || (b.duration - (o.offset || 0));
    const now = c.currentTime;
    // sliced playback always gets a fade or it clicks
    if (o.dur) {
      const f = Math.min(0.03, dur * 0.25);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(vol, now + f);
      g.gain.setValueAtTime(vol, now + Math.max(f, dur - f));
      g.gain.linearRampToValueAtTime(0.0001, now + dur);
    } else g.gain.value = vol;
    let node = g;
    if (o.pan != null && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      g.connect(p); node = p;
    }
    if (o.lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = o.lp;
      node.connect(f); node = f;
    }
    src.connect(g);
    node.connect(o.bus === 'amb' ? this.busAmb : (o.bus === 'mus' ? this.busMus : this.busSfx));
    src.start(now, o.offset || 0, o.dur || undefined);
    return { src, gain: g };
  }

  loop(key, name, vol, rate) {
    if (!this.ready) return;
    if (this.loops[key]) return this.loops[key];
    const h = this.play(name, { loop: true, vol, rate: rate || 1, bus: 'amb' });
    if (h) this.loops[key] = h;
    return h;
  }

  setLoopVol(key, v, ramp = 0.4) {
    const h = this.loops[key];
    if (!h) return;
    h.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    h.gain.gain.linearRampToValueAtTime(Math.max(0.0001, v), this.ctx.currentTime + ramp);
  }

  stopLoop(key) {
    const h = this.loops[key];
    if (!h) return;
    try { h.src.stop(); } catch (e) { /* already stopped */ }
    delete this.loops[key];
  }

  // Long field recordings only work as stingers if we cut a loud moment out of them.
  sting(name, o = {}) {
    const spots = this[name + 'Spots'];
    const off = spots && spots.length ? spots[(Math.random() * spots.length) | 0] : 0;
    return this.play(name, Object.assign({ offset: off, dur: o.dur || 2.2 }, o, { offset: o.offset != null ? o.offset : off }));
  }

  step(intensity, wet) {
    if (wet) {
      this.play('static', { vol: 0.22 * intensity, dur: 0.20, offset: Math.random() * 8, lp: 2600, rate: 1.6 });
      return;
    }
    if (this.buf.steps && this.stepSpots && this.stepSpots.length) {
      const off = this.stepSpots[(Math.random() * this.stepSpots.length) | 0];
      this.play('steps', { vol: 0.34 + intensity * 0.30, offset: off, dur: 0.20, rate: 0.86 + Math.random() * 0.20, lp: 3400 });
    } else {
      this.play('steps', { vol: 0.3 + intensity * 0.3, rate: 0.9 + Math.random() * 0.2 });
    }
  }

  // One mode per situation. 'hunt' deliberately has no track by default: the music
  // stopping dead like a tape is more frightening than a chase cue.
  setMusic(mode, immediate) {
    if (!this.ready || this.musicMode === mode) return;
    this.musicMode = mode;
    this._killDrone();
    this.busMus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.busMus.gain.setValueAtTime(1, this.ctx.currentTime);

    if (!mode) { this._stopFile(1.2); return; }
    if (!this.hasMusic) { this._drone(mode === 'hunt' ? 'chase' : 'ambient'); return; }

    const list = this._slotList(mode);
    if (!list.length) {
      // an unfilled slot means "no music here" - hard cut, then the drone
      this._stopFile(mode === 'hunt' ? 0.28 : 1.0);
      this._drone(mode === 'hunt' ? 'chase' : 'ambient');
      return;
    }
    this.queue = [];
    this.queueMode = null;
    this._nextTrack(immediate || mode === 'hunt');
  }

  _fadeTo(v, sec) {
    const g = this.elGain.gain, n = this.ctx.currentTime;
    g.cancelScheduledValues(n);
    g.setValueAtTime(Math.max(0.0001, g.value), n);
    g.linearRampToValueAtTime(v, n + sec);
  }

  _killDrone() {
    if (!this.droneNodes) return;
    this.droneNodes.forEach(n => { try { n.stop(); } catch (e) { } });
    this.droneNodes = null;
  }

  _drone(kind) {
    const c = this.ctx;
    const base = kind === 'chase' ? 46 : 36;
    const nodes = [];
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator();
      o.type = i === 2 ? 'sawtooth' : 'sine';
      o.frequency.value = base * (i === 0 ? 1 : i === 1 ? 1.5 : 2.005);
      const g = c.createGain();
      g.gain.value = i === 2 ? 0.05 : 0.14;
      const lfo = c.createOscillator(); lfo.frequency.value = kind === 'chase' ? 5.5 : 0.13;
      const lg = c.createGain(); lg.gain.value = kind === 'chase' ? 0.09 : 0.06;
      lfo.connect(lg); lg.connect(g.gain);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'chase' ? 900 : 320;
      o.connect(g); g.connect(f); f.connect(this.busMus);
      o.start(); lfo.start();
      nodes.push(o, lfo);
    }
    this.droneNodes = nodes;
  }

  duckFor(sec) {
    const g = this.busAmb.gain, n = this.ctx.currentTime;
    g.cancelScheduledValues(n);
    g.setValueAtTime(g.value, n);
    g.linearRampToValueAtTime(0.05, n + 0.06);
    g.linearRampToValueAtTime(0.55, n + sec);
  }
}
