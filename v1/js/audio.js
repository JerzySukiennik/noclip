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

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  async load(onProgress) {
    this.init();
    const names = Object.keys(SAMPLES);
    let done = 0;
    for (const n of names) {
      try {
        const url = await commonsUrl(SAMPLES[n].file);
        const r = await fetch(url, { mode: 'cors' });
        if (!r.ok) throw new Error(r.status);
        const ab = await r.arrayBuffer();
        this.buf[n] = await this.ctx.decodeAudioData(ab);
        this.fetched++;
      } catch (e) {
        this.failed.push(n);
        this.buf[n] = this.synth(n);
      }
      done++;
      if (onProgress) onProgress(done / names.length);
      await new Promise(r => setTimeout(r, 90));
    }
    this.stepSpots = this.buf.steps ? this.loudSpots(this.buf.steps, 0.30) : [];
    this.growlSpots = this.buf.growl ? this.loudSpots(this.buf.growl, 1.6) : [];
    this.growl2Spots = this.buf.growl2 ? this.loudSpots(this.buf.growl2, 1.6) : [];
    this.screamSpots = this.buf.scream ? this.loudSpots(this.buf.scream, 0.8) : [];
    this.breathSpots = this.buf.breath ? this.loudSpots(this.buf.breath, 1.2) : [];
    await this.loadLocalMusic();
    return { fetched: this.fetched, failed: this.failed.slice() };
  }

  async loadLocalMusic() {
    // Anything Jurek drops in audio/ wins over the synth beds.
    let man = null;
    try {
      const r = await fetch('audio/manifest.json', { cache: 'no-store' });
      if (r.ok) man = await r.json();
    } catch (e) { /* no manifest is fine */ }
    const probes = man ? man : {
      ambient: ['audio/ambient.mp3', 'audio/ambient.ogg', 'audio/ambient.wav'],
      chase: ['audio/chase.mp3', 'audio/chase.ogg', 'audio/chase.wav']
    };
    for (const slot of ['ambient', 'chase']) {
      const list = Array.isArray(probes[slot]) ? probes[slot] : (probes[slot] ? [probes[slot]] : []);
      for (const p of list) {
        try {
          const r = await fetch(p, { cache: 'no-store' });
          if (!r.ok) continue;
          const ab = await r.arrayBuffer();
          this.buf['music_' + slot] = await this.ctx.decodeAudioData(ab);
          break;
        } catch (e) { /* try next candidate */ }
      }
    }
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

  // Music beds: local file if present, otherwise a two-oscillator synth drone.
  setMusic(mode) {
    if (this.musicMode === mode) return;
    this.musicMode = mode;
    this.stopLoop('mus');
    if (this.droneNodes) { this.droneNodes.forEach(n => { try { n.stop(); } catch (e) { } }); this.droneNodes = null; }
    if (!mode) { this.busMus.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 1.2); return; }
    const key = 'music_' + mode;
    this.busMus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.busMus.gain.linearRampToValueAtTime(mode === 'chase' ? 0.62 : 0.34, this.ctx.currentTime + (mode === 'chase' ? 0.35 : 3.0));
    if (this.buf[key]) {
      const h = this.play(key, { loop: true, vol: 1, bus: 'mus' });
      if (h) this.loops['mus'] = h;
      return;
    }
    const c = this.ctx;
    const base = mode === 'chase' ? 46 : 36;
    const nodes = [];
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator();
      o.type = i === 2 ? 'sawtooth' : 'sine';
      o.frequency.value = base * (i === 0 ? 1 : i === 1 ? 1.5 : 2.005);
      const g = c.createGain();
      g.gain.value = i === 2 ? 0.05 : 0.14;
      const lfo = c.createOscillator(); lfo.frequency.value = mode === 'chase' ? 5.5 : 0.13;
      const lg = c.createGain(); lg.gain.value = mode === 'chase' ? 0.09 : 0.06;
      lfo.connect(lg); lg.connect(g.gain);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = mode === 'chase' ? 900 : 320;
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
