// NOCLIP - every surface is drawn into a canvas at boot: wallpaper, damp carpet,
// acoustic ceiling, pool tile, concrete, scrawl decals. No image assets to load.

import * as THREE from 'three';

const cache = new Map();

// Glancing-angle moire on the long walls is a mip-filtering problem, so the
// textures take whatever anisotropy the card actually supports.
let MAX_ANISO = 4;
export function setAnisotropy(n) { MAX_ANISO = Math.max(1, n | 0); }

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function hash2(x, y, s) {
  let n = x * 374761393 + y * 668265263 + s * 1442695040888963407;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// Periodic value noise. Without wrapping the lattice the texture does not tile,
// and a wall repeating every 2.4 m shows the seam immediately.
function vnoise(x, y, s, px, py) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (n, p) => (p ? ((n % p) + p) % p : n);
  const x0 = w(xi, px), x1 = w(xi + 1, px), y0 = w(yi, py), y1 = w(yi + 1, py);
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s);
  const c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, s, oct, lac, gain, px, py) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * freq, y * freq, s + i * 977, px ? px * freq : 0, py ? py * freq : 0);
    norm += amp; amp *= gain; freq *= lac;
  }
  return sum / norm;
}

// Fill a canvas with per-pixel fbm-driven colour. cb(n, x, y) -> [r,g,b].
function grain(c, scale, seed, cb, oct = 4) {
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(c.width, c.height);
  const d = img.data;
  // lattice periods chosen so the noise repeats exactly once per canvas
  const px = Math.max(1, Math.round(c.width / scale));
  const py = Math.max(1, Math.round(c.height / scale));
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const n = fbm(x / scale, y / scale, seed, oct, 2.0, 0.5, px, py);
      const rgb = cb(n, x, y);
      const i = (y * c.width + x) * 4;
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return ctx;
}

function stains(ctx, w, h, count, seed, col, rmin, rmax, alpha) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  for (let k = 0; k < count * 9; k++) {
    const i = k % count;
    // draw every blot nine times, once per wrap offset, so nothing is cut at an edge
    const ox = ((k / count) | 0) % 3 - 1, oy = (((k / count) | 0) / 3 | 0) - 1;
    const x = hash2(i, 7, seed) * w + ox * w;
    const y = hash2(i, 19, seed) * h + oy * h;
    const r = rmin + hash2(i, 31, seed) * (rmax - rmin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = alpha * (0.5 + hash2(i, 43, seed) * 0.5);
    g.addColorStop(0, `rgba(${col},${a})`);
    g.addColorStop(0.55, `rgba(${col},${a * 0.45})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.6 + hash2(i, 57, seed) * 0.9), 0, 0, 6.283); ctx.fill();
  }
  ctx.restore();
}

function finish(c, rx, ry, clampT) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = clampT ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = MAX_ANISO;
  t.needsUpdate = true;
  return t;
}

/* ---------------------------------------------------------------- walls ---- */

// Wall canvases are drawn bottom-up in metres so the baseboard and any trim
// land at a physically correct height for that zone's ceiling.
function wallBase(h, px = 512) {
  const W = 256, H = px;
  const c = cv(W, H);
  const ppm = H / h;
  return { c, W, H, ppm, yOf: (m) => H - m * ppm };
}

function wallpaper(h, seed) {
  const { c, W, H, ppm, yOf } = wallBase(h);
  // Fine grain only. Anything with a feature size near the 2.4 m tile turns into
  // visible stripes and brown blotches once the wall repeats - the walls on the
  // tape are close to flat, and that is what sells the scale.
  const ctx = grain(c, 3.4, seed, (n) => {
    const v = 0.94 + n * 0.12;
    return [Math.min(255, 205 * v), Math.min(255, 190 * v), Math.min(255, 68 * v)];
  }, 3);

  // a slow, very low contrast drift so it is not mathematically uniform
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = fbm(x / 150, y / 150, seed + 900, 2, 2, 0.5, Math.round(W / 150), Math.round(H / 150));
    const k = 0.975 + n * 0.05;
    const i = (y * W + x) * 4;
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
  }
  ctx.putImageData(img, 0, 0);

  // scuffing along the bottom, where shoes and carts actually hit
  const scuffTop = yOf(0.5);
  ctx.globalAlpha = 0.05; ctx.fillStyle = '#8b8144';
  for (let i = 0; i < 30; i++) {
    const x = hash2(i, 5, seed) * W;
    const y = scuffTop + hash2(i, 9, seed) * (H - scuffTop);
    ctx.fillRect(x, y, 3 + hash2(i, 13, seed) * 14, 1);
  }
  ctx.globalAlpha = 1;

  // baseboard
  const bbH = 0.115 * ppm;
  ctx.fillStyle = '#bdb256'; ctx.fillRect(0, H - bbH, W, bbH);
  ctx.fillStyle = '#e0d689'; ctx.fillRect(0, H - bbH, W, Math.max(1, bbH * 0.22));
  ctx.fillStyle = '#8d8438'; ctx.fillRect(0, H - bbH - 1, W, 1);

  // ceiling trim shadow
  ctx.globalAlpha = 0.22; ctx.fillStyle = '#6d6530';
  ctx.fillRect(0, 0, W, Math.max(2, 0.045 * ppm));
  ctx.globalAlpha = 1;
  return c;
}

function officeWall(h, seed) {
  const { c, W, H, ppm } = wallBase(h);
  const ctx = grain(c, 34, seed, (n) => {
    const v = 0.88 + n * 0.20;
    return [Math.min(255, 214 * v), Math.min(255, 214 * v), Math.min(255, 206 * v)];
  });
  stains(ctx, W, H, 5, seed + 5, '138,138,132', 8, 22, 0.09);
  ctx.globalAlpha = 0.14; ctx.fillStyle = '#7c7c74';
  for (let i = 0; i < 30; i++) {
    const x = hash2(i, 3, seed) * W, y = H * 0.55 + hash2(i, 8, seed) * H * 0.45;
    ctx.fillRect(x, y, 2 + hash2(i, 12, seed) * 20, 1);
  }
  ctx.globalAlpha = 1;
  const bbH = 0.10 * ppm;
  ctx.fillStyle = '#41403c'; ctx.fillRect(0, H - bbH, W, bbH);
  ctx.fillStyle = '#5b5a54'; ctx.fillRect(0, H - bbH, W, Math.max(1, bbH * 0.18));
  return c;
}

function redWall(h, seed) {
  const { c, W, H, ppm } = wallBase(h);
  const ctx = grain(c, 22, seed, (n) => {
    const v = 0.72 + n * 0.40;
    return [Math.min(255, 128 * v), Math.min(255, 34 * v), Math.min(255, 30 * v)];
  });
  ctx.globalAlpha = 0.18;
  for (let y = 0; y < H; y += 14) { ctx.fillStyle = '#4a0f0d'; ctx.fillRect(0, y, W, 3); }
  for (let x = 0; x < W; x += 14) { ctx.fillStyle = '#5e1512'; ctx.fillRect(x, 0, 3, H); }
  ctx.globalAlpha = 1;
  stains(ctx, W, H, 6, seed + 2, '52,10,8', 8, 24, 0.20);
  const bbH = 0.11 * ppm;
  ctx.fillStyle = '#3a0c0a'; ctx.fillRect(0, H - bbH, W, bbH);
  ctx.fillStyle = '#6a1a15'; ctx.fillRect(0, H - bbH, W, Math.max(1, bbH * 0.2));
  return c;
}

function metalWall(h, seed) {
  const { c, W, H, ppm } = wallBase(h);
  const ctx = grain(c, 16, seed, (n) => {
    const v = 0.70 + n * 0.44;
    return [Math.min(255, 116 * v), Math.min(255, 108 * v), Math.min(255, 92 * v)];
  });
  // corrugation
  for (let x = 0; x < W; x += 16) {
    ctx.globalAlpha = 0.30; ctx.fillStyle = '#2f2b23'; ctx.fillRect(x, 0, 2, H);
    ctx.globalAlpha = 0.22; ctx.fillStyle = '#a49780'; ctx.fillRect(x + 3, 0, 3, H);
  }
  ctx.globalAlpha = 0.30;
  for (let i = 0; i < 70; i++) {
    const y = hash2(i, 4, seed) * H, x = 8 + Math.floor(hash2(i, 6, seed) * 16) * 16;
    ctx.fillStyle = '#39332a'; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;
  stains(ctx, W, H, 8, seed + 9, '92,54,20', 6, 20, 0.26);
  const bbH = 0.09 * ppm;
  ctx.fillStyle = '#2a251d'; ctx.fillRect(0, H - bbH, W, bbH);
  return c;
}

function concreteWall(h, seed) {
  const { c, W, H, ppm } = wallBase(h);
  const ctx = grain(c, 30, seed, (n) => {
    const v = 0.74 + n * 0.36;
    return [Math.min(255, 128 * v), Math.min(255, 126 * v), Math.min(255, 118 * v)];
  });
  ctx.globalAlpha = 0.20; ctx.strokeStyle = '#4d4b46'; ctx.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    let x = hash2(i, 2, seed) * W, y = hash2(i, 5, seed) * H;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (hash2(i, k + 20, seed) - 0.5) * 30; y += hash2(i, k + 40, seed) * 22; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // form-tie holes and panel joints
  ctx.globalAlpha = 0.26; ctx.fillStyle = '#3c3a35';
  for (let y = 0; y < H; y += Math.max(20, 1.2 * ppm)) ctx.fillRect(0, y, W, 2);
  for (let i = 0; i < 26; i++) {
    ctx.beginPath(); ctx.arc(hash2(i, 71, seed) * W, hash2(i, 73, seed) * H, 2.4, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;
  stains(ctx, W, H, 9, seed + 4, '58,54,44', 8, 26, 0.20);
  return c;
}

function tileWall(h, seed) {
  const { c, W, H, ppm } = wallBase(h);
  const ctx = grain(c, 40, seed, (n) => {
    const v = 0.90 + n * 0.16;
    return [Math.min(255, 226 * v), Math.min(255, 233 * v), Math.min(255, 228 * v)];
  });
  const t = Math.max(12, 0.22 * ppm);
  ctx.globalAlpha = 0.45; ctx.fillStyle = '#9db3ad';
  for (let y = H; y > -t; y -= t) ctx.fillRect(0, y, W, 1.6);
  for (let x = 0; x <= W; x += t) ctx.fillRect(x, 0, 1.6, H);
  ctx.globalAlpha = 1;
  // discoloured tiles
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 70; i++) {
    const gx = Math.floor(hash2(i, 3, seed) * (W / t)) * t;
    const gy = H - Math.floor(hash2(i, 8, seed) * (H / t) + 1) * t;
    ctx.fillStyle = hash2(i, 12, seed) > 0.5 ? '#7d9c94' : '#c9d8bd';
    ctx.fillRect(gx + 1, gy + 1, t - 2, t - 2);
  }
  ctx.globalAlpha = 1;
  stains(ctx, W, H, 6, seed + 6, '96,120,110', 7, 20, 0.16);
  return c;
}

/* ---------------------------------------------------------------- floors --- */

function carpet(seed) {
  const c = cv(512, 512);
  // Dense fibre noise and nothing else. The old low-frequency wear layer had a
  // feature size larger than the 2 m tile, so it tiled into diagonal banding.
  const ctx = grain(c, 1.9, seed, (n) => {
    const v = 0.86 + n * 0.24;
    return [Math.min(255, 178 * v), Math.min(255, 158 * v), Math.min(255, 48 * v)];
  }, 3);
  const img = ctx.getImageData(0, 0, 512, 512), d = img.data;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const n = fbm(x / 190, y / 190, seed + 500, 2, 2, 0.5, Math.round(512 / 190), Math.round(512 / 190));
    const k = 0.97 + n * 0.06;
    const i = (y * 512 + x) * 4;
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function redCarpet(seed) {
  const c = cv(512, 512);
  const ctx = grain(c, 3.0, seed, (n) => {
    const v = 0.70 + n * 0.40;
    return [Math.min(255, 104 * v), Math.min(255, 26 * v), Math.min(255, 24 * v)];
  }, 3);
  stains(ctx, 512, 512, 10, seed + 31, '44,8,8', 10, 30, 0.18);
  return c;
}

function vinyl(seed) {
  const c = cv(512, 512);
  const ctx = grain(c, 60, seed, (n) => {
    const v = 0.72 + n * 0.44;
    return [Math.min(255, 40 * v), Math.min(255, 35 * v), Math.min(255, 30 * v)];
  });
  ctx.globalAlpha = 0.30; ctx.fillStyle = '#0d0c0b';
  for (let y = 0; y < 512; y += 128) ctx.fillRect(0, y, 512, 2);
  for (let x = 0; x < 512; x += 128) ctx.fillRect(x, 0, 2, 512);
  ctx.globalAlpha = 0.10; ctx.fillStyle = '#8b8478';
  for (let i = 0; i < 120; i++) {
    ctx.fillRect(hash2(i, 3, seed) * 512, hash2(i, 7, seed) * 512, 30 + hash2(i, 9, seed) * 90, 1);
  }
  ctx.globalAlpha = 1;
  return c;
}

function concreteFloor(seed) {
  const c = cv(512, 512);
  const ctx = grain(c, 26, seed, (n) => {
    const v = 0.72 + n * 0.40;
    return [Math.min(255, 112 * v), Math.min(255, 110 * v), Math.min(255, 102 * v)];
  });
  ctx.globalAlpha = 0.28; ctx.fillStyle = '#3a3833';
  for (let y = 0; y < 512; y += 170) ctx.fillRect(0, y, 512, 2.5);
  for (let x = 0; x < 512; x += 170) ctx.fillRect(x, 0, 2.5, 512);
  ctx.globalAlpha = 1;
  stains(ctx, 512, 512, 14, seed + 13, '52,48,40', 10, 32, 0.22);
  return c;
}

/* -------------------------------------------------------------- ceilings --- */

function acoustic(seed) {
  const c = cv(512, 512);
  const ctx = grain(c, 2.0, seed, (n) => {
    const v = 0.88 + n * 0.22;
    return [Math.min(255, 219 * v), Math.min(255, 213 * v), Math.min(255, 168 * v)];
  }, 2);
  const t = 256;
  ctx.globalAlpha = 0.55; ctx.fillStyle = '#8f8a63';
  for (let y = 0; y <= 512; y += t) ctx.fillRect(0, y - 1, 512, 3);
  for (let x = 0; x <= 512; x += t) ctx.fillRect(x - 1, 0, 3, 512);
  ctx.globalAlpha = 0.25; ctx.fillStyle = '#cec8a2';
  for (let y = 0; y <= 512; y += t) ctx.fillRect(0, y + 2, 512, 2);
  ctx.globalAlpha = 1;
  stains(ctx, 512, 512, 4, seed + 17, '150,143,110', 10, 30, 0.14);
  return c;
}

function metalCeil(seed) {
  const c = cv(512, 512);
  const ctx = grain(c, 14, seed, (n) => {
    const v = 0.62 + n * 0.44;
    return [Math.min(255, 92 * v), Math.min(255, 86 * v), Math.min(255, 74 * v)];
  });
  ctx.globalAlpha = 0.35; ctx.fillStyle = '#2b2720';
  for (let y = 0; y < 512; y += 32) ctx.fillRect(0, y, 512, 3);
  ctx.globalAlpha = 1;
  return c;
}

/* ------------------------------------------------------------- fixtures ---- */

function lampPanel() {
  const c = cv(128, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0b0a'; ctx.fillRect(0, 0, 128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 72);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#fff9e4'); g.addColorStop(0.86, '#e9dcae'); g.addColorStop(1, '#4a452e');
  ctx.fillStyle = g; ctx.fillRect(6, 6, 116, 116);
  ctx.globalAlpha = 0.35; ctx.strokeStyle = '#b9b08a'; ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(6, 6 + i * 29); ctx.lineTo(122, 6 + i * 29); ctx.stroke(); }
  ctx.globalAlpha = 1;
  return c;
}

function waterTex(seed) {
  const c = cv(256, 256);
  grain(c, 12, seed, (n) => {
    const v = 0.55 + n * 0.70;
    return [Math.min(255, 44 * v), Math.min(255, 110 * v), Math.min(255, 118 * v)];
  }, 3);
  return c;
}

/* --------------------------------------------------------------- scrawl ---- */

// Hand-drawn marker on transparent canvas: the eyes/nose face, tallies and words.
export function scrawlTexture(kind, text, seed) {
  const c = cv(256, 256);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(18,16,12,0.88)';
  ctx.fillStyle = 'rgba(18,16,12,0.88)';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  const wobble = (x, y, i) => [x + (hash2(i, 3, seed) - 0.5) * 5, y + (hash2(i, 9, seed) - 0.5) * 5];

  if (kind === 'face') {
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.ellipse(94, 104, 26, 13, -0.22, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.ellipse(166, 104, 26, 13, 0.22, 0, 6.283); ctx.fill();
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(64, 84); ctx.quadraticCurveTo(94, 70, 122, 86); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(138, 86); ctx.quadraticCurveTo(166, 70, 196, 84); ctx.stroke();
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(130, 126); ctx.lineTo(126, 160); ctx.lineTo(140, 158); ctx.stroke();
  } else if (kind === 'grid') {
    ctx.lineWidth = 6;
    ctx.strokeRect(52, 52, 152, 152);
    ctx.beginPath(); ctx.moveTo(128, 52); ctx.lineTo(128, 204); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(52, 128); ctx.lineTo(204, 128); ctx.stroke();
    ctx.lineWidth = 4;
    for (let i = 0; i < 7; i++) {
      const q = i % 4, ox = 60 + (q % 2) * 76, oy = 60 + ((q / 2) | 0) * 76;
      ctx.beginPath(); ctx.moveTo(ox + i * 3, oy + 6); ctx.lineTo(ox + i * 3 + 4, oy + 52); ctx.stroke();
    }
  } else if (kind === 'tally') {
    ctx.lineWidth = 6;
    for (let g = 0; g < 5; g++) {
      const bx = 26 + (g % 3) * 78, by = 60 + ((g / 3) | 0) * 96;
      for (let i = 0; i < 4; i++) {
        const [x1, y1] = wobble(bx + i * 12, by, g * 7 + i);
        const [x2, y2] = wobble(bx + i * 12, by + 52, g * 7 + i + 3);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(bx - 6, by + 48); ctx.lineTo(bx + 46, by + 4); ctx.stroke();
    }
  } else if (kind === 'arrow') {
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(36, 128); ctx.lineTo(206, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(206, 128); ctx.lineTo(154, 82); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(206, 128); ctx.lineTo(154, 174); ctx.stroke();
  } else {
    const t = (text || 'TOTAL').slice(0, 10);
    ctx.font = 'bold 62px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(128, 128); ctx.rotate((hash2(1, 1, seed) - 0.5) * 0.30);
    ctx.scale(1, 1.18 + hash2(2, 2, seed) * 0.25);
    ctx.fillText(t, 0, 0);
    ctx.restore();
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(40, 176); ctx.lineTo(216, 172); ctx.stroke();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = MAX_ANISO;
  return t;
}

/* ------------------------------------------------------------------ api ---- */

const WALLS = { wallpaper, office: officeWall, red: redWall, metal: metalWall, concrete: concreteWall, tile: tileWall };
const FLOORS = { carpet, redcarpet: redCarpet, vinyl, concrete: concreteFloor, tile: (s) => tileWall(2.0, s) };
const CEILS = { tile: acoustic, concrete: concreteFloor, metal: metalCeil };

export function wallTex(name, h, seed) {
  const k = `w:${name}:${h.toFixed(2)}`;
  if (!cache.has(k)) {
    const c = (WALLS[name] || wallpaper)(h, seed);
    // v spans the wall height exactly once; u repeats every 2.4 m of run.
    cache.set(k, finish(c, 1, 1, true));
  }
  return cache.get(k);
}

export function floorTex(name, seed) {
  const k = `f:${name}`;
  if (!cache.has(k)) cache.set(k, finish((FLOORS[name] || carpet)(seed), 1, 1, false));
  return cache.get(k);
}

export function ceilTex(name, seed) {
  const k = `c:${name}`;
  if (!cache.has(k)) cache.set(k, finish((CEILS[name] || acoustic)(seed), 1, 1, false));
  return cache.get(k);
}

export function lampTex() {
  if (!cache.has('lamp')) cache.set('lamp', finish(lampPanel(), 1, 1, true));
  return cache.get('lamp');
}

export function waterTexture(seed) {
  if (!cache.has('water')) cache.set('water', finish(waterTex(seed), 1, 1, false));
  return cache.get('water');
}

export function noiseTexture(size = 256) {
  if (cache.has('noise')) return cache.get('noise');
  const c = cv(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let i = 0; i < size * size; i++) {
    const v = (Math.random() * 255) | 0;
    d[i * 4] = v; d[i * 4 + 1] = (Math.random() * 255) | 0; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  cache.set('noise', t);
  return t;
}
