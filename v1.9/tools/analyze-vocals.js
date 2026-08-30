// Dev-only: find the instrumental stretches of a track. Lead vocals sit in the
// centre of the stereo image, so mid-vs-side energy in the vocal band separates
// singing from backing far more reliably than loudness alone.
window.__vocals = async (url, opts = {}) => {
  const frame = opts.frame || 0.25;
  const lo = opts.lo || 300, hi = opts.hi || 3500;
  const ab = await (await fetch(url)).arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ctx.decodeAudioData(ab);
  const sr = buf.sampleRate, n = buf.length;
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;

  const band = async (make) => {
    const off = new OfflineAudioContext(1, n, sr);
    const b = off.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    make(d);
    const src = off.createBufferSource(); src.buffer = b;
    const f1 = off.createBiquadFilter(); f1.type = 'highpass'; f1.frequency.value = lo; f1.Q.value = 0.7;
    const f2 = off.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = hi; f2.Q.value = 0.7;
    src.connect(f1); f1.connect(f2); f2.connect(off.destination);
    src.start();
    return (await off.startRendering()).getChannelData(0);
  };

  const mid = await band(d => { for (let i = 0; i < n; i++) d[i] = (L[i] + R[i]) * 0.5; });
  const side = await band(d => { for (let i = 0; i < n; i++) d[i] = (L[i] - R[i]) * 0.5; });

  const w = Math.floor(sr * frame), frames = Math.floor(n / w);
  const rms = (a, k) => { let s = 0; for (let i = k * w; i < (k + 1) * w; i++) s += a[i] * a[i]; return Math.sqrt(s / w); };
  const score = new Float32Array(frames);
  for (let k = 0; k < frames; k++) {
    const m = rms(mid, k), sd = rms(side, k);
    score[k] = m / (sd + 1e-5);
  }
  // smooth over ~2 s so a single word does not fragment a region
  const win = Math.max(1, Math.round(2 / frame));
  const sm = new Float32Array(frames);
  for (let k = 0; k < frames; k++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, k - win); j <= Math.min(frames - 1, k + win); j++) { s += score[j]; c++; }
    sm[k] = s / c;
  }
  const sorted = Array.from(sm).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const thr = opts.thr || med;

  const regions = [];
  let start = null;
  for (let k = 0; k < frames; k++) {
    const quiet = sm[k] <= thr;
    if (quiet && start === null) start = k;
    if ((!quiet || k === frames - 1) && start !== null) {
      const a = start * frame, b = k * frame;
      if (b - a >= (opts.minLen || 8)) regions.push({ start: +a.toFixed(2), end: +b.toFixed(2), len: +(b - a).toFixed(2) });
      start = null;
    }
  }
  regions.sort((a, b) => b.len - a.len);
  return { duration: +buf.duration.toFixed(1), median: +med.toFixed(2), threshold: +thr.toFixed(2), regions: regions.slice(0, 8) };
};
'ready'
