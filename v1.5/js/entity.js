// NOCLIP - The Entity. Procedural rig (no assets), BFS pathing on the cell grid and a
// five-state mind: dormant, aware, stalk, hunt, kill. The host owns it in multiplayer.

import * as THREE from 'three';
import { CELL, GRID_W, GRID_H, ENTITY } from './config.js';
import { cxOf, cyOf, wx, wz } from './level.js';
import { collideCircle } from './player.js';

const seg = (len, r0, r1, mat) => {
  const g = new THREE.CylinderGeometry(r0, r1, len, 7, 1);
  g.translate(0, -len / 2, 0);
  return new THREE.Mesh(g, mat);
};

export const STATE = { DORMANT: 0, AWARE: 1, STALK: 2, HUNT: 3, KILL: 4 };

export class Entity {
  constructor(level) {
    this.level = level;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.state = STATE.DORMANT;
    this.stateT = 0;
    this.t = 0;
    this.path = [];
    this.pathT = 0;
    this.target = null;
    this.lastSeen = new THREE.Vector3();
    this.lostFor = 99;
    this.gait = 0;
    this.jitter = 0;
    this.visible = false;
    this.rage = 0;
    this.spawnCooldown = 0;
    this._build();
    this.reset();
  }

  _build() {
    const skin = new THREE.MeshPhongMaterial({
      color: 0x131210, specular: 0x2e2c26, shininess: 22, emissive: 0x040403
    });
    this.mat = skin;
    const root = new THREE.Group();
    this.root = root;

    const hips = new THREE.Group();
    hips.position.y = 1.44;
    root.add(hips);
    this.hips = hips;

    const spine = new THREE.Group();
    hips.add(spine);
    this.spine = spine;
    const torso = seg(0.64, 0.21, 0.25, skin);
    torso.position.y = 0.62;
    torso.scale.set(1, -1, 1);
    spine.add(torso);

    const chest = new THREE.Group();
    chest.position.y = 0.62;
    spine.add(chest);
    this.chest = chest;

    const neck = new THREE.Group();
    neck.position.y = 0.04;
    chest.add(neck);
    this.neck = neck;
    const neckM = seg(0.26, 0.078, 0.068, skin);
    neckM.position.y = 0.26; neckM.scale.set(1, -1, 1);
    neck.add(neckM);

    const head = new THREE.Group();
    head.position.y = 0.26;
    neck.add(head);
    this.head = head;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), skin);
    skull.scale.set(0.86, 1.28, 1.02);
    skull.position.y = 0.09;
    head.add(skull);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.15), skin);
    jaw.position.set(0, 0.015, 0.055);
    head.add(jaw);
    this.jaw = jaw;

    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.235, 0.02, 0);
      chest.add(sh);
      sh.add(seg(0.60, 0.098, 0.074, skin));
      const fo = new THREE.Group();
      fo.position.y = -0.60;
      sh.add(fo);
      fo.add(seg(0.58, 0.074, 0.052, skin));
      const hand = new THREE.Group();
      hand.position.y = -0.58;
      fo.add(hand);
      for (let f = 0; f < 4; f++) {
        const fg = seg(0.24 - f * 0.02, 0.019, 0.008, skin);
        fg.position.set((f - 1.5) * 0.028, 0, 0);
        fg.rotation.z = (f - 1.5) * 0.10;
        fg.rotation.x = 0.20;
        hand.add(fg);
      }
      this.arms.push({ sh, fo, hand, side: s });
    }

    this.legs = [];
    for (const s of [-1, 1]) {
      const th = new THREE.Group();
      th.position.set(s * 0.135, -0.06, 0);
      hips.add(th);
      th.add(seg(0.70, 0.118, 0.085, skin));
      const sn = new THREE.Group();
      sn.position.y = -0.70;
      th.add(sn);
      sn.add(seg(0.68, 0.085, 0.060, skin));
      const ft = new THREE.Group();
      ft.position.y = -0.68;
      sn.add(ft);
      const fm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.065, 0.33), skin);
      fm.position.set(0, -0.028, 0.08);
      ft.add(fm);
      this.legs.push({ th, sn, ft, side: s });
    }

    root.visible = false;
  }

  // Place it a set distance from a point, not as far away as the map allows.
  placeNear(x, z, minM, maxM) {
    const L = this.level;
    let best = null, bestErr = 1e9;
    const want = (minM + maxM) * 0.5;
    for (let t = 0; t < 700; t++) {
      const cx = 2 + Math.floor(Math.random() * (GRID_W - 4));
      const cy = 2 + Math.floor(Math.random() * (GRID_H - 4));
      if (!L.isOpen(cx, cy)) continue;
      const px = wx(cx) + CELL / 2, pz = wz(cy) + CELL / 2;
      const d = Math.hypot(px - x, pz - z);
      if (d < minM || d > maxM) {
        const err = d < minM ? minM - d : d - maxM;
        if (err < bestErr && !best) { bestErr = err; best = [cx, cy]; }
        continue;
      }
      if (Math.abs(d - want) < bestErr) { bestErr = Math.abs(d - want); best = [cx, cy]; }
      if (bestErr < 6) break;
    }
    return best;
  }

  reset(fromX, fromZ) {
    const L = this.level;
    const ax = fromX == null ? L.spawnWorld.x : fromX;
    const az = fromZ == null ? L.spawnWorld.z : fromZ;
    let best = this.placeNear(ax, az, ENTITY.spawnMin, ENTITY.spawnMax);
    if (!best) best = L.exitCell;
    this.pos.set(wx(best[0]) + CELL / 2, 0, wz(best[1]) + CELL / 2);
    this.state = STATE.DORMANT;
    this.stateT = 0;
    this.lostFor = 99;
    this.path = [];
    this.rage = 0;
    this.hunger = 0;
    this.root.visible = false;
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    if (this.onState) this.onState(s);
  }

  /* --------------------------------------------------------------- path -- */

  repath(tx, tz) {
    const L = this.level;
    const sx = cxOf(this.pos.x), sy = cyOf(this.pos.z);
    const gx = cxOf(tx), gy = cyOf(tz);
    if (!L.isOpen(sx, sy) || !L.isOpen(gx, gy)) { this.path = []; return; }
    const N = GRID_W * GRID_H;
    if (!this._prev) { this._prev = new Int32Array(N); this._seen = new Int32Array(N); this._q = new Int32Array(N); this._stamp = 0; }
    this._stamp++;
    const prev = this._prev, seen = this._seen, q = this._q, st = this._stamp;
    let head = 0, tail = 0;
    const si = sy * GRID_W + sx, gi = gy * GRID_W + gx;
    q[tail++] = si; seen[si] = st; prev[si] = -1;
    let found = false;
    while (head < tail) {
      const c = q[head++];
      if (c === gi) { found = true; break; }
      const x = c % GRID_W, y = (c / GRID_W) | 0;
      if (L.isOpen(x + 1, y)) { const n = c + 1; if (seen[n] !== st) { seen[n] = st; prev[n] = c; q[tail++] = n; } }
      if (L.isOpen(x - 1, y)) { const n = c - 1; if (seen[n] !== st) { seen[n] = st; prev[n] = c; q[tail++] = n; } }
      if (L.isOpen(x, y + 1)) { const n = c + GRID_W; if (seen[n] !== st) { seen[n] = st; prev[n] = c; q[tail++] = n; } }
      if (L.isOpen(x, y - 1)) { const n = c - GRID_W; if (seen[n] !== st) { seen[n] = st; prev[n] = c; q[tail++] = n; } }
    }
    const out = [];
    if (found) {
      let c = gi;
      while (c !== -1 && out.length < 900) { out.push(c); c = prev[c]; }
      out.reverse();
    }
    this.path = out;
    this.pathI = 1;
  }

  hasLOS(tx, ty, tz) {
    const L = this.level;
    const ex = this.pos.x, ez = this.pos.z;
    const dx = tx - ex, dz = tz - ez;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1) return true;
    const steps = Math.ceil(dist / (CELL * 0.4));
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      if (L.isSolid(cxOf(ex + dx * k), cyOf(ez + dz * k))) return false;
    }
    return true;
  }

  /* ---------------------------------------------------------------- ai ---- */

  // targets: [{ pos, speed, crouching, alive, noise }]
  update(dt, t, targets, difficulty = 1) {
    this.t = t;
    this.stateT += dt;
    const E = ENTITY;
    const live = targets.filter(p => p.alive);
    if (!live.length) { this.root.visible = false; return; }

    let best = null, bestScore = -1e9;
    for (const p of live) {
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      const los = d < E.seeDist && this.hasLOS(p.pos.x, p.pos.y, p.pos.z);
      const noise = p.noise || 0;
      const heard = d < (noise > 0.6 ? E.hearRun : E.hearWalk) * (p.crouching ? 0.45 : 1);
      let s = -d;
      if (los) s += 40;
      if (heard) s += 26;
      if (s > bestScore) { bestScore = s; best = { p, d, los, heard }; }
    }
    this.target = best.p;
    const { d, los, heard } = best;

    if (los && d < E.seeDist) {
      this.lostFor = 0;
      this.lastSeen.copy(best.p.pos);
    } else this.lostFor += dt;

    switch (this.state) {
      case STATE.DORMANT:
        if (heard || (los && d < E.seeDist)) this.setState(STATE.AWARE);
        break;
      case STATE.AWARE:
        if (los && d < 22) this.setState(STATE.STALK);
        else if (this.lostFor > 16) this.setState(STATE.DORMANT);
        break;
      case STATE.STALK:
        if (d < 15 && los && this.stateT > 2.2) this.setState(STATE.HUNT);
        else if (this.lostFor > 11) this.setState(STATE.AWARE);
        break;
      case STATE.HUNT:
        if (d < E.killDist) this.setState(STATE.KILL);
        else if (this.lostFor > E.loseAfter) this.setState(STATE.STALK);
        break;
      case STATE.KILL:
        break;
    }

    this.rage = Math.min(1, this.rage + (this.state === STATE.HUNT ? dt * 0.06 : -dt * 0.1));

    let speed = 0, goal = null;
    if (this.state === STATE.DORMANT) {
      // Patience shrinks the ring it keeps you at, so it always arrives eventually.
      this.hunger = Math.min(1, this.hunger + dt / E.patience);
      const lurk = E.lurkFar + (E.lurkNear - E.lurkFar) * this.hunger;
      goal = best.p.pos;
      speed = d > lurk ? E.speedProwl * (0.75 + this.hunger * 0.6) : 0;
    } else {
      this.hunger = 0;
      if (this.state === STATE.AWARE) { speed = 2.4; goal = this.lastSeen; }
      else if (this.state === STATE.STALK) { speed = E.speedStalk * (1 + this.rage * 0.3); goal = best.p.pos; }
      else if (this.state === STATE.HUNT) {
        speed = (E.speedHunt + (E.speedRage - E.speedHunt) * this.rage) * difficulty;
        goal = los ? best.p.pos : this.lastSeen;
      }
    }

    this.pathT -= dt;
    if (goal && this.pathT <= 0) {
      this.pathT = E.repathEvery;
      this.repath(goal.x, goal.z);
    }

    // Inside a cell or two the path nodes run out - steer straight at the target
    // or it stalls a metre short and never closes.
    const closeIn = goal && d < CELL * 1.9 && (los || this.state === STATE.HUNT);
    if (speed > 0 && closeIn) {
      const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      const lunge = this.state === STATE.HUNT ? 1.25 : 1;
      this.vel.x += ((dx / l) * speed * lunge - this.vel.x) * Math.min(1, dt * 11);
      this.vel.z += ((dz / l) * speed * lunge - this.vel.z) * Math.min(1, dt * 11);
    } else if (speed > 0 && this.path && this.path.length > 1) {
      let next = null;
      while (this.pathI < this.path.length) {
        const c = this.path[this.pathI];
        const nx = wx(c % GRID_W) + CELL / 2, nz = wz((c / GRID_W) | 0) + CELL / 2;
        if (Math.hypot(nx - this.pos.x, nz - this.pos.z) < CELL * 0.55) { this.pathI++; continue; }
        next = [nx, nz]; break;
      }
      if (next) {
        const dx = next[0] - this.pos.x, dz = next[1] - this.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        this.vel.x += ((dx / l) * speed - this.vel.x) * Math.min(1, dt * 7);
        this.vel.z += ((dz / l) * speed - this.vel.z) * Math.min(1, dt * 7);
      } else { this.vel.multiplyScalar(0.85); }
    } else this.vel.multiplyScalar(1 - Math.min(1, dt * 5));

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    collideCircle(this.level, this.pos, E.radius, null);

    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.05) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      let dy = want - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * Math.min(1, dt * (this.state === STATE.HUNT ? 9 : 4));
    }

    this.animate(dt, sp, best.p);
    this.visible = this.state !== STATE.DORMANT || d < 40;
    this.root.visible = this.visible;
    return best;
  }

  animate(dt, sp, tgt) {
    const t = this.t;
    const hunting = this.state === STATE.HUNT;
    this.gait += dt * (sp * (hunting ? 1.65 : 2.35) + 0.4);
    const g = this.gait;
    const amp = Math.min(1.0, sp / 3.4 + 0.12);

    this.root.position.set(this.pos.x, 0, this.pos.z);
    this.root.rotation.y = this.yaw;

    // jitter escalates with the hunt - the wrongness is in the head and hands
    const jt = hunting ? 1 : (this.state === STATE.STALK ? 0.35 : 0.12);
    this.jitter += (jt - this.jitter) * Math.min(1, dt * 4);
    const jx = (Math.random() - 0.5) * 0.10 * this.jitter;
    const jy = (Math.random() - 0.5) * 0.14 * this.jitter;

    this.hips.position.y = 1.44 - Math.abs(Math.sin(g)) * 0.075 * amp - (hunting ? 0.10 : 0);
    this.hips.rotation.z = Math.sin(g) * 0.05 * amp;
    this.spine.rotation.x = (hunting ? 0.42 : 0.16) + Math.sin(g * 2) * 0.035 * amp;
    this.spine.rotation.z = Math.sin(g) * 0.05 * amp;
    this.chest.rotation.y = -Math.sin(g) * 0.20 * amp;

    // head tracks the target no matter where the body is pointed
    let hy = 0, hx = 0;
    if (tgt) {
      const dx = tgt.pos.x - this.pos.x, dz = tgt.pos.z - this.pos.z;
      const want = Math.atan2(dx, dz) - this.yaw;
      let w = want;
      while (w > Math.PI) w -= Math.PI * 2;
      while (w < -Math.PI) w += Math.PI * 2;
      hy = Math.max(-1.7, Math.min(1.7, w));
      const dy = (tgt.pos.y + 1.5) - 2.35;
      hx = Math.max(-0.6, Math.min(0.6, -Math.atan2(dy, Math.hypot(dx, dz))));
    }
    this.neck.rotation.y += (hy - this.neck.rotation.y) * Math.min(1, dt * (hunting ? 14 : 5));
    this.neck.rotation.x += (hx + 0.10 - this.neck.rotation.x) * Math.min(1, dt * 5);
    this.head.rotation.z = jx * 2.2;
    this.head.rotation.x = jy;
    this.jaw.position.y = 0.015 - (hunting ? 0.035 + Math.abs(Math.sin(t * 9)) * 0.03 : 0);

    for (const L of this.legs) {
      const ph = g + (L.side > 0 ? 0 : Math.PI);
      const s = Math.sin(ph), c = Math.cos(ph);
      L.th.rotation.x = s * (hunting ? 0.78 : 0.52) * amp + (hunting ? 0.16 : 0);
      L.sn.rotation.x = -Math.max(0, -c) * (hunting ? 1.10 : 0.80) * amp - 0.05;
      L.ft.rotation.x = (0.20 - s * 0.42) * amp;
    }
    for (const A of this.arms) {
      const ph = g + (A.side > 0 ? Math.PI : 0);
      const s = Math.sin(ph);
      const reach = hunting ? 1 : 0;
      A.sh.rotation.x = s * (hunting ? 1.05 : 0.34) * amp - reach * 0.55 + jy * 0.8;
      A.sh.rotation.z = A.side * (0.09 + reach * 0.16) + jx;
      A.fo.rotation.x = -(0.25 + Math.max(0, s) * (hunting ? 0.75 : 0.30) * amp) - reach * 0.5;
      A.hand.rotation.x = 0.18 + Math.sin(t * 7 + A.side) * 0.20 * this.jitter;
      A.hand.rotation.z = Math.sin(t * 5.3 + A.side * 2) * 0.16 * this.jitter;
    }
  }
}
