// NOCLIP - BSP-partitioned level. Every leaf becomes a zone with its own room type,
// ceiling height, palette and interior generator. Geometry is merged per zone-chunk
// so the whole 78x78 grid draws in a few dozen calls.

import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, GRID_W, GRID_H, CHUNK, ROOM_TYPES, TYPE_BY_ID, SCRAWL, NOTES } from './config.js';
import { Rng } from './rng.js';
import { wallTex, floorTex, ceilTex, lampTex, waterTexture, scrawlTexture } from './tex.js';

export const OX = -GRID_W * CELL * 0.5;
export const OZ = -GRID_H * CELL * 0.5;
export const wx = (cx) => OX + cx * CELL;
export const wz = (cy) => OZ + cy * CELL;
export const cxOf = (x) => Math.floor((x - OX) / CELL);
export const cyOf = (z) => Math.floor((z - OZ) / CELL);

const SOLID = 1, OPEN = 0;

class Quads {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.v = 0; }
  quad(vs, uvs, nrm, cols) {
    const b = this.v;
    for (let k = 0; k < 4; k++) {
      this.p.push(vs[k][0], vs[k][1], vs[k][2]);
      this.n.push(nrm[0], nrm[1], nrm[2]);
      this.u.push(uvs[k][0], uvs[k][1]);
      const g = cols[k];
      this.c.push(g, g, g);
    }
    this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.v += 4;
  }
  geom() {
    if (!this.v) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

export class Level {
  constructor(seed) {
    this.rng = new Rng(seed);
    this.seed = seed;
    this.solid = new Uint8Array(GRID_W * GRID_H).fill(SOLID);
    this.zone = new Int16Array(GRID_W * GRID_H).fill(-1);
    this.protect = new Uint8Array(GRID_W * GRID_H);
    this.zones = [];
    this.fixtures = [];
    this.fixByCell = new Map();
    this.exitSigns = [];
    this.group = new THREE.Group();
    this.propBoxes = [];
    this.notes = [];
    this.water = [];
    this._build();
  }

  idx(cx, cy) { return cy * GRID_W + cx; }
  inB(cx, cy) { return cx >= 0 && cy >= 0 && cx < GRID_W && cy < GRID_H; }
  isSolid(cx, cy) { return !this.inB(cx, cy) || this.solid[this.idx(cx, cy)] === SOLID; }
  isOpen(cx, cy) { return this.inB(cx, cy) && this.solid[this.idx(cx, cy)] === OPEN; }
  zoneAt(cx, cy) { return this.inB(cx, cy) ? this.zones[this.zone[this.idx(cx, cy)]] || null : null; }
  zoneAtWorld(x, z) { return this.zoneAt(cxOf(x), cyOf(z)); }
  ceilAt(cx, cy) { const z = this.zoneAt(cx, cy); return z ? z.type.h : 2.7; }
  waterAt(x, z) { const zn = this.zoneAtWorld(x, z); return zn && zn.type.water ? zn.type.water : 0; }

  /* ------------------------------------------------------------- layout -- */

  _build() {
    this._partition();
    this._assignTypes();
    this._carve();
    this._doors();
    this._interiors();
    this._ensureL94Access();
    this._connect();
    this._placeSpawnExit();
    this._fixtures();
    this._geometry();
    this._decor();
  }

  _partition() {
    const R = this.rng;
    const MIN = 15, MAXLEAF = 26;
    const root = { x: 1, y: 1, w: GRID_W - 2, h: GRID_H - 2 };
    const leaves = [];
    const nodes = [];
    const split = (n, depth) => {
      const canV = n.w >= MIN * 2, canH = n.h >= MIN * 2;
      const big = n.w > MAXLEAF || n.h > MAXLEAF;
      if (depth > 5 || (!canV && !canH) || (!big && !R.chance(0.72))) { leaves.push(n); return; }
      let vert;
      if (canV && canH) vert = n.w / n.h > 1.22 ? true : (n.h / n.w > 1.22 ? false : R.chance(0.5));
      else vert = canV;
      if (vert) {
        const sx = n.x + R.int(MIN, n.w - MIN);
        const a = { x: n.x, y: n.y, w: sx - n.x, h: n.h };
        const b = { x: sx, y: n.y, w: n.x + n.w - sx, h: n.h };
        nodes.push({ vert: true, at: sx, lo: n.y, hi: n.y + n.h, a, b });
        split(a, depth + 1); split(b, depth + 1);
      } else {
        const sy = n.y + R.int(MIN, n.h - MIN);
        const a = { x: n.x, y: n.y, w: n.w, h: sy - n.y };
        const b = { x: n.x, y: sy, w: n.w, h: n.y + n.h - sy };
        nodes.push({ vert: false, at: sy, lo: n.x, hi: n.x + n.w, a, b });
        split(a, depth + 1); split(b, depth + 1);
      }
    };
    split(root, 0);
    this.leaves = leaves;
    this.nodes = nodes;
  }

  _assignTypes() {
    const R = this.rng;
    const pool = [];
    ROOM_TYPES.forEach(t => { for (let i = 0; i < t.weight; i++) pool.push(t); });
    // every type shows up at least once before any repeats
    const must = R.shuffle(ROOM_TYPES.slice());
    this.leaves.forEach((rect, i) => {
      const type = i < must.length ? must[i] : R.pick(pool);
      const z = {
        i, rect, type,
        cells: [],
        cx: rect.x + rect.w * 0.5, cy: rect.y + rect.h * 0.5,
        wx: wx(rect.x + rect.w * 0.5), wz: wz(rect.y + rect.h * 0.5),
        group: new THREE.Group()
      };
      this.zones.push(z);
    });
    // the entry zone is always the classic yellow lobby
    const lob = this.zones.find(z => z.type.id === 'lobby') || this.zones[0];
    this.entryZone = lob;

    // Level 94 has to be findable, not a needle in 78x78 cells: put it in the
    // biggest room that shares a wall with the room you land in.
    const touching = (a, b) => {
      const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const sideBySide = (a.x + a.w === b.x || b.x + b.w === a.x) && yOverlap >= 4;
      const stacked = (a.y + a.h === b.y || b.y + b.h === a.y) && xOverlap >= 4;
      return sideBySide || stacked;
    };
    const l94 = TYPE_BY_ID.l94;
    if (l94) {
      const current = this.zones.find(z => z.type.id === 'l94');
      const nbrs = this.zones.filter(z => z !== lob && touching(lob.rect, z.rect));
      nbrs.sort((a, b) => (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h));
      const target = nbrs[0];
      if (target && target.type.id !== 'l94') {
        const displaced = target.type;
        target.type = l94;
        if (current) current.type = displaced;
      }
      this.l94Zone = this.zones.find(z => z.type.id === 'l94') || null;
    }
  }

  _carve() {
    for (const z of this.zones) {
      const { x, y, w, h } = z.rect;
      for (let cy = y + 1; cy < y + h - 1; cy++)
        for (let cx = x + 1; cx < x + w - 1; cx++) {
          this.solid[this.idx(cx, cy)] = OPEN;
        }
      // every cell of the rect belongs to the zone, perimeter included
      for (let cy = y; cy < y + h; cy++)
        for (let cx = x; cx < x + w; cx++) this.zone[this.idx(cx, cy)] = z.i;
    }
  }

  _open(cx, cy) { if (this.inB(cx, cy)) { this.solid[this.idx(cx, cy)] = OPEN; this.protect[this.idx(cx, cy)] = 1; } }

  _punch(cx, cy, vert) {
    // Carry the opening through both perimeter rings and shield the cells behind it.
    this._open(cx, cy);
    if (vert) { this._open(cx - 1, cy); this.protect[this.idx(Math.max(0, cx - 2), cy)] = 1; this.protect[this.idx(Math.min(GRID_W - 1, cx + 1), cy)] = 1; }
    else { this._open(cx, cy - 1); this.protect[this.idx(cx, Math.max(0, cy - 2))] = 1; this.protect[this.idx(cx, Math.min(GRID_H - 1, cy + 1))] = 1; }
  }

  _doors() {
    const R = this.rng;
    this.doorCells = [];
    for (const n of this.nodes) {
      const span = n.hi - n.lo;
      const count = 1 + (span > 30 ? 1 : 0);
      const picks = [];
      for (let k = 0; k < count; k++) {
        for (let tries = 0; tries < 40; tries++) {
          const p = n.lo + 2 + R.int(0, Math.max(0, span - 5));
          if (picks.some(q => Math.abs(q - p) < 5)) continue;
          const ok = n.vert
            ? (this.zone[this.idx(n.at - 2, p)] >= 0 && this.zone[this.idx(n.at + 1, p)] >= 0)
            : (this.zone[this.idx(p, n.at - 2)] >= 0 && this.zone[this.idx(p, n.at + 1)] >= 0);
          if (!ok) continue;
          picks.push(p);
          if (n.vert) { this._punch(n.at, p, true); this.doorCells.push([n.at, p, true]); }
          else { this._punch(p, n.at, false); this.doorCells.push([p, n.at, false]); }
          break;
        }
      }
    }
  }

  _interiors() {
    for (const z of this.zones) {
      const R = new Rng(this.seed ^ (z.i * 2654435761));
      const g = z.type.gen;
      if (g === 'open') this._genOpen(z, R);
      else if (g === 'maze') this._genMaze(z, R);
      else this._genCells(z, R);
    }
  }

  _set(cx, cy, v) {
    if (!this.inB(cx, cy)) return;
    const i = this.idx(cx, cy);
    if (this.protect[i]) return;
    this.solid[i] = v;
  }

  _inner(z, pad = 1) {
    const { x, y, w, h } = z.rect;
    return { x0: x + pad, y0: y + pad, x1: x + w - 1 - pad, y1: y + h - 1 - pad };
  }

  // Open plan: freestanding pillars plus short partition runs, like the tape's first shot.
  _genOpen(z, R) {
    if (z.type.outdoor) return;   // hills and houses go in as props, not as walls
    const b = this._inner(z, 1);
    const pillar = z.type.id === 'ware' ? 0.34 : 0.5;
    for (let cy = b.y0 + 1; cy < b.y1; cy += 3) {
      for (let cx = b.x0 + 1; cx < b.x1; cx += 3) {
        if (!R.chance(pillar)) continue;
        const px = cx + R.int(0, 1), py = cy + R.int(0, 1);
        this._set(px, py, SOLID);
      }
    }
    const runs = Math.floor((b.x1 - b.x0) * (b.y1 - b.y0) / 34);
    for (let k = 0; k < runs; k++) {
      const vert = R.chance(0.5);
      const len = R.int(3, 8);
      let cx = R.int(b.x0, b.x1 - 1), cy = R.int(b.y0, b.y1 - 1);
      for (let i = 0; i < len; i++) {
        this._set(cx, cy, SOLID);
        if (vert) cy++; else cx++;
        if (cx > b.x1 || cy > b.y1) break;
      }
    }
  }

  // Randomised DFS on an odd lattice: corridors exactly one cell wide with
  // one-cell walls between them, which is what the endless hallway reads as.
  _genMaze(z, R) {
    const b = this._inner(z, 1);
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) this._set(x, y, SOLID);

    const cols = Math.floor((b.x1 - b.x0) / 2) + 1;
    const rows = Math.floor((b.y1 - b.y0) / 2) + 1;
    if (cols < 2 || rows < 2) { for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) this._set(x, y, OPEN); return; }
    const gx = (i) => b.x0 + i * 2, gy = (j) => b.y0 + j * 2;
    const seen = new Uint8Array(cols * rows);
    const stack = [[R.int(0, cols - 1), R.int(0, rows - 1)]];
    seen[stack[0][1] * cols + stack[0][0]] = 1;
    this._set(gx(stack[0][0]), gy(stack[0][1]), OPEN);
    while (stack.length) {
      const [ci, cj] = stack[stack.length - 1];
      const opts = [];
      if (ci > 0 && !seen[cj * cols + ci - 1]) opts.push([-1, 0]);
      if (ci < cols - 1 && !seen[cj * cols + ci + 1]) opts.push([1, 0]);
      if (cj > 0 && !seen[(cj - 1) * cols + ci]) opts.push([0, -1]);
      if (cj < rows - 1 && !seen[(cj + 1) * cols + ci]) opts.push([0, 1]);
      if (!opts.length) { stack.pop(); continue; }
      const [dx, dy] = R.pick(opts);
      const ni = ci + dx, nj = cj + dy;
      seen[nj * cols + ni] = 1;
      this._set(gx(ci) + dx, gy(cj) + dy, OPEN);
      this._set(gx(ni), gy(nj), OPEN);
      stack.push([ni, nj]);
    }

    // a perfect maze is all dead ends; knock a few walls out for loops
    const loops = Math.floor(cols * rows * 0.16);
    for (let k = 0; k < loops; k++) {
      const i = R.int(0, cols - 1), j = R.int(0, rows - 1);
      const [dx, dy] = R.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      if (i + dx < 0 || i + dx >= cols || j + dy < 0 || j + dy >= rows) continue;
      this._set(gx(i) + dx, gy(j) + dy, OPEN);
    }

    // doorways punched before generation must still reach the maze
    for (let y = b.y0 - 1; y <= b.y1 + 1; y++)
      for (let x = b.x0 - 1; x <= b.x1 + 1; x++) {
        if (!this.inB(x, y) || !this.protect[this.idx(x, y)] || !this.isOpen(x, y)) continue;
        let tx = b.x0 + Math.round((x - b.x0) / 2) * 2;
        let ty = b.y0 + Math.round((y - b.y0) / 2) * 2;
        tx = Math.max(b.x0, Math.min(b.x1, tx));
        ty = Math.max(b.y0, Math.min(b.y1, ty));
        let cx = x, cy = y;
        for (let g = 0; g < 40 && (cx !== tx || cy !== ty); g++) {
          if (cx !== tx) cx += Math.sign(tx - cx); else cy += Math.sign(ty - cy);
          this._set(cx, cy, OPEN);
        }
      }
  }

  // Grid of small rooms with doorways - admin, marks, red hall.
  _genCells(z, R) {
    const b = this._inner(z, 1);
    const step = R.int(4, 5);
    for (let x = b.x0 + step; x < b.x1; x += step) {
      const gaps = new Set();
      for (let g = 0; g < 1 + R.int(0, 1); g++) gaps.add(b.y0 + R.int(0, b.y1 - b.y0));
      for (let y = b.y0; y <= b.y1; y++) if (!gaps.has(y)) this._set(x, y, SOLID);
    }
    for (let y = b.y0 + step; y < b.y1; y += step) {
      const gaps = new Set();
      for (let g = 0; g < 1 + R.int(0, 1); g++) gaps.add(b.x0 + R.int(0, b.x1 - b.x0));
      for (let x = b.x0; x <= b.x1; x++) if (!gaps.has(x)) this._set(x, y, SOLID);
    }
  }

  // Doors are only punched along BSP split lines, so whether the entry room opens
  // directly into Level 94 was down to luck. Cut the openings explicitly.
  _ensureL94Access() {
    const lob = this.entryZone;
    const z94 = this.zones.find(z => z.type.id === 'l94');
    if (!lob || !z94) return;
    const a = lob.rect, b = z94.rect;
    const cuts = [];
    const vert = (a.y + a.h === b.y) ? b.y : ((b.y + b.h === a.y) ? a.y : null);
    const horiz = (a.x + a.w === b.x) ? b.x : ((b.x + b.w === a.x) ? a.x : null);

    if (horiz !== null) {
      const y0 = Math.max(a.y, b.y) + 2, y1 = Math.min(a.y + a.h, b.y + b.h) - 3;
      for (let y = y0; y <= y1; y++) cuts.push([horiz, y, true]);
    } else if (vert !== null) {
      const x0 = Math.max(a.x, b.x) + 2, x1 = Math.min(a.x + a.w, b.x + b.w) - 3;
      for (let x = x0; x <= x1; x++) cuts.push([x, vert, false]);
    }
    if (!cuts.length) return;

    // two openings, spread apart, each cleared two cells deep on both sides
    const picks = cuts.length < 4 ? [cuts[cuts.length >> 1]]
      : [cuts[Math.floor(cuts.length * 0.3)], cuts[Math.floor(cuts.length * 0.7)]];
    this.l94Doors = [];
    for (const [cx, cy, isVertical] of picks) {
      this._punch(cx, cy, isVertical);
      for (let k = -2; k <= 1; k++) {
        const x = isVertical ? cx + k : cx;
        const y = isVertical ? cy : cy + k;
        if (!this.inB(x, y)) continue;
        this.solid[this.idx(x, y)] = OPEN;
        this.protect[this.idx(x, y)] = 1;
      }
      this.l94Doors.push([cx, cy, isVertical]);
    }
  }

  /* --------------------------------------------------------- connectivity -- */

  bfsFrom(cx, cy) {
    const dist = new Int32Array(GRID_W * GRID_H).fill(-1);
    if (!this.isOpen(cx, cy)) return dist;
    const q = new Int32Array(GRID_W * GRID_H);
    let head = 0, tail = 0;
    q[tail++] = this.idx(cx, cy); dist[this.idx(cx, cy)] = 0;
    while (head < tail) {
      const c = q[head++]; const x = c % GRID_W, y = (c / GRID_W) | 0; const d = dist[c] + 1;
      const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of nb) {
        if (!this.isOpen(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (dist[ni] !== -1) continue;
        dist[ni] = d; q[tail++] = ni;
      }
    }
    return dist;
  }

  _anyOpenIn(z) {
    const { x, y, w, h } = z.rect;
    for (let cy = y + 1; cy < y + h - 1; cy++)
      for (let cx = x + 1; cx < x + w - 1; cx++) if (this.isOpen(cx, cy)) return [cx, cy];
    return null;
  }

  // Interior generators routinely seal pockets off. Label every component and
  // carve each one back to the main body until a single region remains.
  _connect() {
    const seedCell = this._anyOpenIn(this.entryZone) || this._anyOpen();
    for (let pass = 0; pass < 300; pass++) {
      const dist = this.bfsFrom(seedCell[0], seedCell[1]);
      let orphan = null;
      for (let cy = 1; cy < GRID_H - 1 && !orphan; cy++)
        for (let cx = 1; cx < GRID_W - 1; cx++) {
          const i = this.idx(cx, cy);
          if (this.solid[i] === OPEN && dist[i] === -1) { orphan = [cx, cy]; break; }
        }
      if (!orphan) break;
      // walk from the orphan toward the nearest reachable cell, opening as we go
      let [ox, oy] = orphan;
      let target = null, bd = 1e9;
      for (let cy = 1; cy < GRID_H - 1; cy++)
        for (let cx = 1; cx < GRID_W - 1; cx++) {
          if (dist[this.idx(cx, cy)] < 0) continue;
          const d = Math.abs(cx - ox) + Math.abs(cy - oy);
          if (d < bd) { bd = d; target = [cx, cy]; }
        }
      if (!target) break;
      for (let step = 0; step < 300; step++) {
        if (ox === target[0] && oy === target[1]) break;
        if (ox !== target[0]) ox += Math.sign(target[0] - ox);
        else oy += Math.sign(target[1] - oy);
        this.solid[this.idx(ox, oy)] = OPEN;
        if (this.zone[this.idx(ox, oy)] < 0) this.zone[this.idx(ox, oy)] = this.zone[this.idx(orphan[0], orphan[1])];
      }
    }
    const start = this._anyOpenIn(this.entryZone) || this._anyOpen();
    this.dist0 = this.bfsFrom(start[0], start[1]);
    this.start = start;
  }

  _anyOpen() {
    for (let cy = 1; cy < GRID_H - 1; cy++)
      for (let cx = 1; cx < GRID_W - 1; cx++) if (this.isOpen(cx, cy)) return [cx, cy];
    return [1, 1];
  }

  _placeSpawnExit() {
    const b = this._inner(this.entryZone, 2);
    let best = null;
    for (let t = 0; t < 400; t++) {
      const cx = this.rng.int(b.x0, b.x1), cy = this.rng.int(b.y0, b.y1);
      if (!this.isOpen(cx, cy)) continue;
      let free = 0;
      for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) if (this.isOpen(cx + a, cy + c)) free++;
      if (free === 9) { best = [cx, cy]; break; }
      if (!best) best = [cx, cy];
    }
    this.spawn = best || this.start;
    this.spawnWorld = new THREE.Vector3(wx(this.spawn[0]) + CELL / 2, 0, wz(this.spawn[1]) + CELL / 2);

    const dist = this.bfsFrom(this.spawn[0], this.spawn[1]);
    this.distSpawn = dist;
    let far = -1, cell = null;
    for (let i = 0; i < dist.length; i++) if (dist[i] > far) { far = dist[i]; cell = i; }
    this.exitCell = [cell % GRID_W, (cell / GRID_W) | 0];
    this.exitWorld = new THREE.Vector3(wx(this.exitCell[0]) + CELL / 2, 0, wz(this.exitCell[1]) + CELL / 2);
    this.maxDist = far;
  }

  /* ------------------------------------------------------------ fixtures -- */

  _fixtures() {
    for (const z of this.zones) {
      const t = z.type;
      if (!t.lightEvery) continue;
      const b = this._inner(z, 1);
      for (let cy = b.y0; cy <= b.y1; cy++)
        for (let cx = b.x0; cx <= b.x1; cx++) {
          if (!this.isOpen(cx, cy)) continue;
          if ((cx % t.lightEvery) || (cy % t.lightEvery)) continue;
          const f = {
            id: this.fixtures.length,
            cx, cy, zone: z,
            x: wx(cx) + CELL / 2, y: t.h - 0.055, z: wz(cy) + CELL / 2,
            color: t.lightColor, intensity: t.lightI, range: t.lightRange,
            on: 1, flick: 0, dead: this.rng.chance(0.045)
          };
          if (f.dead) f.on = 0;
          this.fixtures.push(f);
          this.fixByCell.set(cy * GRID_W + cx, f);
        }
    }
    // dead zones still get emergency signage so they read as rooms, not voids
    for (const z of this.zones) {
      if (!z.type.blackout) continue;
      const b = this._inner(z, 2);
      for (let k = 0; k < 5; k++) {
        const cx = this.rng.int(b.x0, b.x1), cy = this.rng.int(b.y0, b.y1);
        if (!this.isOpen(cx, cy)) continue;
        const sign = {
          id: this.fixtures.length, cx, cy, zone: z, exitSign: true,
          x: wx(cx) + CELL / 2, y: z.type.h - 0.42, z: wz(cy) + CELL / 2,
          color: 0x3bff7a, intensity: 0.55, range: 7.0, on: 1, flick: 0
        };
        this.fixtures.push(sign);
        this.exitSigns.push(sign);
      }
    }
  }

  /* ------------------------------------------------------------ geometry -- */

  _mat(z) {
    if (z._mats) return z._mats;
    const t = z.type, s = this.seed + z.i * 31;
    const mk = (map) => new THREE.MeshLambertMaterial({ map, vertexColors: true });
    // Sky must emit, not receive: lit as a surface it takes the hemisphere's ground
    // colour on the ceiling and comes out green.
    const sky = (map) => new THREE.MeshBasicMaterial({ map, toneMapped: true });
    const wall = wallTex(t.wall, t.h, s);
    const floor = floorTex(t.floor, s);
    const ceil = ceilTex(t.ceil, s);
    z._mats = {
      wall: t.outdoor ? sky(wall) : mk(wall),
      floor: mk(floor),
      ceil: t.outdoor ? sky(ceil) : mk(ceil),
      lamp: new THREE.MeshBasicMaterial({ map: lampTex(), color: t.lightColor, toneMapped: false }),
      prop: new THREE.MeshLambertMaterial({ color: t.id === 'office' ? 0xb9b9ae : (t.id === 'ware' ? 0x8a7550 : 0x9a9078), vertexColors: true })
    };
    return z._mats;
  }

  cornerAO(cx, cy) {
    let n = 0;
    if (this.isSolid(cx - 1, cy - 1)) n++;
    if (this.isSolid(cx, cy - 1)) n++;
    if (this.isSolid(cx - 1, cy)) n++;
    if (this.isSolid(cx, cy)) n++;
    return 1 - Math.min(0.34, n * 0.105);
  }

  _geometry() {
    const UW = 2.4, UF = 2.0;
    for (const z of this.zones) {
      const mats = this._mat(z);
      const h = z.type.h;
      const { x, y, w, hh } = { x: z.rect.x, y: z.rect.y, w: z.rect.w, hh: z.rect.h };
      const chunks = new Map();
      const ck = (cx, cy) => `${Math.floor(cx / CHUNK)},${Math.floor(cy / CHUNK)}`;
      const get = (cx, cy) => {
        const k = ck(cx, cy);
        if (!chunks.has(k)) chunks.set(k, { wall: new Quads(), floor: new Quads(), ceil: new Quads(), lamp: new Quads() });
        return chunks.get(k);
      };

      for (let cy = y; cy < y + hh; cy++) {
        for (let cx = x; cx < x + w; cx++) {
          if (!this.isOpen(cx, cy)) continue;
          if (this.zone[this.idx(cx, cy)] !== z.i) continue;
          const q = get(cx, cy);
          const x0 = wx(cx), x1 = wx(cx + 1), z0 = wz(cy), z1 = wz(cy + 1);
          const a00 = this.cornerAO(cx, cy), a10 = this.cornerAO(cx + 1, cy);
          const a01 = this.cornerAO(cx, cy + 1), a11 = this.cornerAO(cx + 1, cy + 1);

          q.floor.quad(
            [[x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0]],
            [[x0 / UF, z1 / UF], [x1 / UF, z1 / UF], [x1 / UF, z0 / UF], [x0 / UF, z0 / UF]],
            [0, 1, 0], [a01, a11, a10, a00]);

          const ca = 0.62 + 0.38;
          q.ceil.quad(
            [[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]],
            [[x0 / UF, z0 / UF], [x1 / UF, z0 / UF], [x1 / UF, z1 / UF], [x0 / UF, z1 / UF]],
            [0, -1, 0], [ca * a00, ca * a10, ca * a11, ca * a01]);

          const dk = 0.80, lt = 1.0;
          const cols = [dk, dk, lt, lt];
          if (this.isSolid(cx + 1, cy)) q.wall.quad(
            [[x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0]],
            [[z0 / UW, 0], [z1 / UW, 0], [z1 / UW, 1], [z0 / UW, 1]], [-1, 0, 0],
            [dk * a10, dk * a11, lt * a11, lt * a10]);
          if (this.isSolid(cx - 1, cy)) q.wall.quad(
            [[x0, 0, z1], [x0, 0, z0], [x0, h, z0], [x0, h, z1]],
            [[z1 / UW, 0], [z0 / UW, 0], [z0 / UW, 1], [z1 / UW, 1]], [1, 0, 0],
            [dk * a01, dk * a00, lt * a00, lt * a01]);
          if (this.isSolid(cx, cy + 1)) q.wall.quad(
            [[x1, 0, z1], [x0, 0, z1], [x0, h, z1], [x1, h, z1]],
            [[x1 / UW, 0], [x0 / UW, 0], [x0 / UW, 1], [x1 / UW, 1]], [0, 0, -1],
            [dk * a11, dk * a01, lt * a01, lt * a11]);
          if (this.isSolid(cx, cy - 1)) q.wall.quad(
            [[x0, 0, z0], [x1, 0, z0], [x1, h, z0], [x0, h, z0]],
            [[x0 / UW, 0], [x1 / UW, 0], [x1 / UW, 1], [x0 / UW, 1]], [0, 0, 1],
            [dk * a00, dk * a10, lt * a10, lt * a00]);

          // header filling the slot where a taller room opens onto a shorter one
          const nbs = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (const [nx, ny] of nbs) {
            if (!this.isOpen(nx, ny)) continue;
            const nz = this.zoneAt(nx, ny);
            if (!nz || nz.type.h >= h - 0.001) continue;
            const lo = nz.type.h;
            const vert = nx !== cx;
            const px = vert ? (nx > cx ? x1 : x0) : 0, pz = vert ? 0 : (ny > cy ? z1 : z0);
            const vs = vert
              ? [[px, lo, z0], [px, lo, z1], [px, h, z1], [px, h, z0]]
              : [[x0, lo, pz], [x1, lo, pz], [x1, h, pz], [x0, h, pz]];
            const n = vert ? [nx > cx ? -1 : 1, 0, 0] : [0, 0, ny > cy ? -1 : 1];
            const uvs = [[0, lo / h], [CELL / UW, lo / h], [CELL / UW, 1], [0, 1]];
            q.wall.quad(vs, uvs, n, [0.72, 0.72, 0.95, 0.95]);
            q.wall.quad([vs[3], vs[2], vs[1], vs[0]], [uvs[3], uvs[2], uvs[1], uvs[0]], [-n[0], -n[1], -n[2]], [0.5, 0.5, 0.5, 0.5]);
          }
        }
      }

      if (z.type.outdoor) { /* the sky needs no light fittings */ }
      for (const f of this.fixtures) {
        if (f.zone !== z || f.exitSign) continue;
        const q = get(f.cx, f.cy);
        const r = z.type.id === 'halls' ? 0.62 : 0.72, rz = z.type.id === 'halls' ? 1.35 : 0.72;
        const yy = h - 0.045;
        q.lamp.quad(
          [[f.x - r, yy, f.z - rz], [f.x + r, yy, f.z - rz], [f.x + r, yy, f.z + rz], [f.x - r, yy, f.z + rz]],
          [[0, 0], [1, 0], [1, 1], [0, 1]], [0, -1, 0], [1, 1, 1, 1]);
      }

      z.chunks = [];
      for (const [key, q] of chunks) {
        const parts = [];
        for (const kind of ['wall', 'floor', 'ceil', 'lamp']) {
          const g = q[kind].geom();
          if (!g) continue;
          const m = new THREE.Mesh(g, mats[kind === 'lamp' ? 'lamp' : kind]);
          m.frustumCulled = true;
          m.matrixAutoUpdate = false;
          m.updateMatrix();
          parts.push(m);
          z.group.add(m);
        }
        const [gx, gy] = key.split(',').map(Number);
        z.chunks.push({
          parts,
          x: wx(gx * CHUNK + CHUNK / 2), z: wz(gy * CHUNK + CHUNK / 2),
          r: CHUNK * CELL * 0.8
        });
      }
      this.group.add(z.group);

      if (z.type.water) this._buildWater(z);
      if (z.type.outdoor) this._buildOutdoors(z);
    }
  }

  // Level 94 in one frame: mown hills, a scatter of pale houses with dark roofs,
  // a white picket fence and a water tower on the ridge.
  _buildOutdoors(z) {
    const R = new Rng(this.seed ^ (z.i * 88675123));
    const g = new THREE.Group();
    const { x, y, w, h } = z.rect;
    const cxw = wx(x + w / 2), czw = wz(y + h / 2);
    const span = Math.min(w, h) * CELL;

    const grassMat = new THREE.MeshLambertMaterial({ color: 0x6f9b4a });
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xf0ead2 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a413a });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0xf6f4ee });
    const winMat = new THREE.MeshLambertMaterial({ color: 0x1b1f24 });
    const metalMat = new THREE.MeshLambertMaterial({ color: 0xb9c6cf });

    // rolling hills: wide flattened spheres sunk into the ground
    for (let k = 0; k < 7; k++) {
      const r = R.range(9, 20);
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), grassMat);
      m.scale.y = R.range(0.22, 0.40);
      m.position.set(cxw + R.range(-span * 0.42, span * 0.42), -r * m.scale.y * R.range(0.30, 0.60),
        czw + R.range(-span * 0.42, span * 0.42));
      g.add(m);
    }

    const house = (px, pz, s, ry) => {
      const hg = new THREE.Group();
      const bw = 4.4 * s, bh = 5.0 * s, bd = 3.4 * s;
      const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), wallMat);
      body.position.y = bh / 2;
      hg.add(body);
      // gable roof from a four-sided cone
      const roof = new THREE.Mesh(new THREE.ConeGeometry(bw * 0.80, 1.9 * s, 4), roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = bh + 0.95 * s;
      roof.scale.z = bd / bw;
      hg.add(roof);
      for (let r = 0; r < 2; r++) for (let c2 = 0; c2 < 2; c2++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8 * s, 1.0 * s), winMat);
        win.position.set((c2 - 0.5) * 1.9 * s, bh * (0.34 + r * 0.36), bd / 2 + 0.02);
        hg.add(win);
        const frame = new THREE.Mesh(new THREE.PlaneGeometry(0.95 * s, 1.15 * s), trimMat);
        frame.position.copy(win.position); frame.position.z -= 0.01;
        hg.add(frame);
      }
      hg.position.set(px, 0, pz);
      hg.rotation.y = ry;
      g.add(hg);
    };
    house(cxw + span * 0.16, czw - span * 0.05, 1.0, R.range(-0.4, 0.4));
    house(cxw - span * 0.22, czw + span * 0.18, 0.62, R.range(-0.5, 0.5));
    house(cxw - span * 0.34, czw - span * 0.28, 0.48, R.range(-0.5, 0.5));

    // white picket fence across the near ground
    const picket = [];
    const fz = czw + span * 0.30;
    for (let i = 0; i < 46; i++) {
      const p = new THREE.BoxGeometry(0.09, 1.0, 0.05);
      p.translate(cxw - span * 0.42 + i * (span * 0.84 / 45), 0.5, fz);
      picket.push(p);
    }
    for (const yy of [0.30, 0.78]) {
      const rail = new THREE.BoxGeometry(span * 0.86, 0.07, 0.04);
      rail.translate(cxw, yy, fz);
      picket.push(rail);
    }
    const fence = BGU.mergeGeometries(picket, false);
    if (fence) g.add(new THREE.Mesh(fence, trimMat));
    picket.forEach(p => p.dispose());

    // water tower on the ridge
    const tw = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 2.6, 14), metalMat);
    tank.position.y = 11.2;
    tw.add(tank);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.1, 14), metalMat);
    cap.position.y = 13.0;
    tw.add(cap);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 10.0, 6), metalMat);
      leg.position.set(Math.sin(a) * 1.5, 5.0, Math.cos(a) * 1.5);
      leg.rotation.z = Math.sin(a) * 0.06;
      leg.rotation.x = -Math.cos(a) * 0.06;
      tw.add(leg);
    }
    tw.position.set(cxw - span * 0.30, 2.4, czw - span * 0.36);
    g.add(tw);

    z.group.add(g);
    z.outdoorProps = g;
  }

  _buildWater(z) {
    const { x, y, w, h } = z.rect;
    const g = new THREE.PlaneGeometry((w - 2) * CELL, (h - 2) * CELL, 1, 1);
    g.rotateX(-Math.PI / 2);
    const tex = waterTexture(this.seed + 77);
    tex.repeat.set(w * 0.6, h * 0.6);
    const m = new THREE.MeshPhongMaterial({
      map: tex, color: 0x6fd4da, transparent: true, opacity: 0.80,
      shininess: 120, specular: 0xc8f6ff, depthWrite: false
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(wx(x + w / 2), z.type.water, wz(y + h / 2));
    mesh.renderOrder = 2;
    z.group.add(mesh);
    this.water.push({ mesh, tex, zone: z });
  }

  /* --------------------------------------------------------------- decor -- */

  _decor() {
    const R = new Rng(this.seed ^ 0x9e3779b9);
    const decals = new THREE.Group();
    this.group.add(decals);
    this.decals = decals;

    for (const z of this.zones) {
      if (!z.type.graffiti) continue;
      const b = this._inner(z, 1);
      for (let k = 0; k < 34; k++) {
        const cx = R.int(b.x0, b.x1), cy = R.int(b.y0, b.y1);
        if (!this.isOpen(cx, cy)) continue;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => this.isSolid(cx + dx, cy + dy));
        if (!dirs.length) continue;
        const [dx, dy] = R.pick(dirs);
        const kind = R.pick(['face', 'grid', 'tally', 'arrow', 'text', 'text']);
        const tex = scrawlTexture(kind, R.pick(SCRAWL), R.int(1, 9999));
        const s = kind === 'text' ? R.range(0.9, 1.5) : R.range(0.7, 1.25);
        const g = new THREE.PlaneGeometry(s, s);
        const m = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.12, depthWrite: false });
        const mesh = new THREE.Mesh(g, m);
        const px = wx(cx) + CELL / 2 + dx * (CELL / 2 - 0.02);
        const pz = wz(cy) + CELL / 2 + dy * (CELL / 2 - 0.02);
        mesh.position.set(px, R.range(0.9, 1.85), pz);
        mesh.lookAt(px - dx, mesh.position.y, pz - dy);
        mesh.renderOrder = 1;
        decals.add(mesh);
      }
    }

    // arrows in the marked zones actually point toward the way out
    const ex = this.exitWorld;
    for (const z of this.zones) {
      if (!z.type.graffiti) continue;
      const b = this._inner(z, 2);
      for (let k = 0; k < 3; k++) {
        const cx = R.int(b.x0, b.x1), cy = R.int(b.y0, b.y1);
        if (!this.isOpen(cx, cy)) continue;
        const tex = scrawlTexture('arrow', '', R.int(1, 9999));
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5),
          new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.12, depthWrite: false }));
        m.position.set(wx(cx) + CELL / 2, 0.02, wz(cy) + CELL / 2);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = -Math.atan2(ex.z - m.position.z, ex.x - m.position.x);
        m.renderOrder = 1;
        decals.add(m);
      }
    }

    this._props(R);
    this._exitDoor();
    this._notes(R);
  }

  _props(R) {
    const boxes = [];
    const push = (mesh, hw, hh, hd) => {
      this.group.add(mesh);
      boxes.push({ x: mesh.position.x, z: mesh.position.z, y: mesh.position.y, hw, hh, hd, rot: mesh.rotation.y });
    };
    for (const z of this.zones) {
      const p = z.type.props;
      if (!p) continue;
      const b = this._inner(z, 2);
      const mat = new THREE.MeshLambertMaterial({
        color: p === 'cabinets' ? 0xc9c9c0 : (p === 'crates' ? 0x8b6f42 : 0x6d6459)
      });
      const geoms = [];
      const count = p === 'pipes' ? 40 : 26;
      for (let k = 0; k < count; k++) {
        const cx = R.int(b.x0, b.x1), cy = R.int(b.y0, b.y1);
        if (!this.isOpen(cx, cy)) continue;
        const px = wx(cx) + CELL / 2 + R.range(-0.7, 0.7);
        const pz = wz(cy) + CELL / 2 + R.range(-0.7, 0.7);
        if (p === 'cabinets') {
          const g = new THREE.BoxGeometry(0.52, 1.34, 0.66);
          g.translate(px, 0.67, pz);
          const rot = new THREE.Matrix4().makeRotationY(R.chance(0.5) ? Math.PI / 2 : 0);
          geoms.push(g);
          boxes.push({ x: px, z: pz, hw: 0.33, hd: 0.36, top: 1.34 });
        } else if (p === 'crates') {
          const s = R.range(0.8, 1.25);
          const stack = R.int(1, 3);
          for (let i = 0; i < stack; i++) {
            const g = new THREE.BoxGeometry(s, s, s);
            g.translate(px + R.range(-0.1, 0.1), s * (i + 0.5), pz + R.range(-0.1, 0.1));
            geoms.push(g);
          }
          boxes.push({ x: px, z: pz, hw: s * 0.6, hd: s * 0.6, top: s * stack });
        } else {
          const len = R.range(2.5, 6.5);
          const vert = R.chance(0.5);
          const g = new THREE.CylinderGeometry(0.09, 0.09, len, 7, 1);
          g.rotateZ(Math.PI / 2);
          if (!vert) g.rotateY(Math.PI / 2);
          g.translate(px, z.type.h - R.range(0.14, 0.34), pz);
          geoms.push(g);
        }
      }
      if (geoms.length) {
        const merged = BGU.mergeGeometries(geoms, false);
        if (merged) {
          const mesh = new THREE.Mesh(merged, mat);
          mesh.matrixAutoUpdate = false;
          this.group.add(mesh);
        }
        geoms.forEach(g => g.dispose());
      }
    }
    this.propBoxes = boxes;
  }

  _exitDoor() {
    const [cx, cy] = this.exitCell;
    const z = this.zoneAt(cx, cy);
    const h = z ? z.type.h : 2.7;
    const g = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 2.35, 0.16),
      new THREE.MeshLambertMaterial({ color: 0x2b2a26 }));
    frame.position.y = 1.175;
    const hole = new THREE.Mesh(
      new THREE.PlaneGeometry(1.16, 2.1),
      new THREE.MeshBasicMaterial({ color: 0x000000 }));
    hole.position.set(0, 1.08, 0.1);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.86, 0.3),
      new THREE.MeshBasicMaterial({ color: 0x3bff7a, toneMapped: false }));
    sign.position.set(0, 2.62 > h - 0.2 ? h - 0.28 : 2.62, 0.12);
    g.add(frame, hole, sign);
    g.position.set(this.exitWorld.x, 0, this.exitWorld.z);
    // face the open side
    const dirs = [[1, 0, -Math.PI / 2], [-1, 0, Math.PI / 2], [0, 1, Math.PI], [0, -1, 0]];
    for (const [dx, dy, ry] of dirs) if (this.isSolid(cx + dx, cy + dy)) { g.rotation.y = ry; g.position.x += dx * (CELL / 2 - 0.1); g.position.z += dy * (CELL / 2 - 0.1); break; }
    this.group.add(g);
    this.exitObj = g;
    this.exitSign = sign;
  }

  _notes(R) {
    const cvs = [];
    for (let k = 0; k < NOTES.length; k++) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 176;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ddd8c4'; ctx.fillRect(0, 0, 256, 176);
      ctx.fillStyle = 'rgba(120,110,80,.25)';
      for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * 256, Math.random() * 176, 2, 2);
      ctx.fillStyle = '#22201a'; ctx.font = '15px "Courier New", monospace';
      const words = NOTES[k].split(' '); let line = '', y = 30;
      for (const w of words) {
        if ((line + w).length > 26) { ctx.fillText(line, 16, y); line = ''; y += 21; }
        line += w + ' ';
      }
      ctx.fillText(line, 16, y);
      cvs.push({ tex: new THREE.CanvasTexture(c), text: NOTES[k] });
    }
    this.noteObjs = [];
    const pool = this.zones.filter(z => !z.type.water);
    for (let k = 0; k < cvs.length; k++) {
      const z = R.pick(pool);
      const b = this._inner(z, 2);
      let cx, cy, ok = false;
      for (let t = 0; t < 60; t++) { cx = R.int(b.x0, b.x1); cy = R.int(b.y0, b.y1); if (this.isOpen(cx, cy)) { ok = true; break; } }
      if (!ok) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.29),
        new THREE.MeshLambertMaterial({ map: cvs[k].tex, side: THREE.DoubleSide }));
      m.position.set(wx(cx) + CELL / 2 + R.range(-0.8, 0.8), 0.012, wz(cy) + CELL / 2 + R.range(-0.8, 0.8));
      m.rotation.x = -Math.PI / 2; m.rotation.z = R.range(0, 6.28);
      this.group.add(m);
      this.noteObjs.push({ mesh: m, text: cvs[k].text, taken: false });
    }
  }

  /* ------------------------------------------------------------- runtime -- */

  // Joining someone else's tape means a different seed, so the old level has to go.
  dispose() {
    const seen = new Set();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        // textures live in the tex.js cache and are shared with the next level
        mat.dispose();
      }
    });
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  cullChunks(px, pz, far) {
    const f2 = far * far;
    for (const z of this.zones) {
      for (const c of z.chunks) {
        const dx = c.x - px, dz = c.z - pz;
        const vis = dx * dx + dz * dz < f2 + c.r * c.r;
        for (const p of c.parts) p.visible = vis;
      }
    }
  }

  nearFixtures(px, pz, radiusCells, out) {
    out.length = 0;
    const cx = cxOf(px), cy = cyOf(pz);
    for (let y = cy - radiusCells; y <= cy + radiusCells; y++) {
      for (let x = cx - radiusCells; x <= cx + radiusCells; x++) {
        const f = this.fixByCell.get(y * GRID_W + x);
        if (f && f.on) out.push(f);
      }
    }
    for (const f of this.exitSigns) {
      if (!f.on) continue;
      const dx = f.x - px, dz = f.z - pz;
      if (dx * dx + dz * dz < 260) out.push(f);
    }
    return out;
  }
}
