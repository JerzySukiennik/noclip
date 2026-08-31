// NOCLIP - first-person controller. Movement is a swept circle against the cell grid;
// everything that sells the walk (bob, sway, hand-held drift, landing dip, legs) lives here.

import * as THREE from 'three';
import { CELL, PLAYER } from './config.js?v=51398ca1788208342';
import { cxOf, cyOf, wx, wz } from './level.js?v=51398ca1788208342';

const TAU = Math.PI * 2;

export function collideCircle(level, pos, radius, props) {
  const cx = cxOf(pos.x), cy = cyOf(pos.z);
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) {
      if (!level.isSolid(x, y)) continue;
      const x0 = wx(x), x1 = x0 + CELL, z0 = wz(y), z1 = z0 + CELL;
      const qx = Math.max(x0, Math.min(pos.x, x1));
      const qz = Math.max(z0, Math.min(pos.z, z1));
      let dx = pos.x - qx, dz = pos.z - qz;
      let d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 < 1e-9) {
        const cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
        dx = pos.x - cxm; dz = pos.z - czm;
        if (Math.abs(dx) > Math.abs(dz)) { pos.x = dx > 0 ? x1 + radius : x0 - radius; }
        else { pos.z = dz > 0 ? z1 + radius : z0 - radius; }
        continue;
      }
      const d = Math.sqrt(d2), k = (radius - d) / d;
      pos.x += dx * k; pos.z += dz * k;
    }
  }
  if (props) {
    for (const b of props) {
      const dx0 = pos.x - b.x, dz0 = pos.z - b.z;
      if (dx0 * dx0 + dz0 * dz0 > 9) continue;
      const qx = Math.max(b.x - b.hw, Math.min(pos.x, b.x + b.hw));
      const qz = Math.max(b.z - b.hd, Math.min(pos.z, b.z + b.hd));
      let dx = pos.x - qx, dz = pos.z - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius || d2 < 1e-9) continue;
      const d = Math.sqrt(d2), k = (radius - d) / d;
      pos.x += dx * k; pos.z += dz * k;
    }
  }
}

function limb(len, r0, r1, mat) {
  const g = new THREE.CylinderGeometry(r0, r1, len, 7, 1);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mat);
  return m;
}

export class Player {
  constructor(level, camera) {
    this.level = level;
    this.camera = camera;
    this.pos = new THREE.Vector3(level.spawnWorld.x, PLAYER.fallFrom, level.spawnWorld.z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI * 0.25;
    this.pitch = 0;
    this.grounded = false;
    this.crouch = 0;
    this.crouching = false;
    this.stamina = PLAYER.staminaMax;
    this.exhausted = false;
    this.bobT = 0;
    this.stepPhase = 0;
    this.landDip = 0;
    this.landVel = 0;
    this.roll = 0;
    this.turnSway = 0;
    this.lastYaw = this.yaw;
    this.driftT = Math.random() * 100;
    this.speed = 0;
    this.inWater = 0;
    this.lookBack = 0;
    this.lookBackTarget = 0;
    this.falling = true;
    this.alive = true;
    this.breath = 0;
    this.headTilt = 0;
    this.onStep = null;
    this.onLand = null;
    this.input = { f: 0, s: 0, run: false, crouch: false, jump: false };
    this._buildLegs();
  }

  _buildLegs() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x26262a });
    const shoe = new THREE.MeshLambertMaterial({ color: 0x121111 });
    this.rig = new THREE.Group();
    const hips = new THREE.Group();
    hips.position.y = 0.92;
    this.rig.add(hips);
    this.hips = hips;
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.22, 0.17), mat);
    pelvis.position.set(0, -0.07, 0.02);
    hips.add(pelvis);
    this.legs = [];
    for (const s of [-1, 1]) {
      const thigh = new THREE.Group();
      thigh.position.set(s * 0.12, -0.14, 0);
      hips.add(thigh);
      thigh.add(limb(0.44, 0.085, 0.068, mat));
      const shin = new THREE.Group();
      shin.position.y = -0.44;
      thigh.add(shin);
      shin.add(limb(0.44, 0.068, 0.052, mat));
      const foot = new THREE.Group();
      foot.position.y = -0.44;
      shin.add(foot);
      const fm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.26), shoe);
      fm.position.set(0, -0.035, 0.06);
      foot.add(fm);
      this.legs.push({ thigh, shin, foot, side: s });
    }
    this.rig.visible = true;
  }

  respawnAt(x, z) {
    this.pos.set(x, PLAYER.fallFrom * 0.55, z);
    this.vel.set(0, 0, 0);
    this.falling = true;
    this.alive = true;
    this.stamina = PLAYER.staminaMax;
  }

  eyeHeight() {
    return PLAYER.eye + (PLAYER.eyeCrouch - PLAYER.eye) * this.crouch;
  }

  update(dt, t) {
    const P = PLAYER;
    const inp = this.input;

    this.crouching = inp.crouch && this.grounded;
    this.crouch += ((this.crouching ? 1 : 0) - this.crouch) * Math.min(1, dt * 11);

    let target = P.walk;
    const wantRun = inp.run && !this.crouching && !this.exhausted && (inp.f !== 0 || inp.s !== 0);
    if (this.crouching) target = P.crouch;
    else if (wantRun) target = P.run;
    if (this.inWater > 0.02) target *= 0.62;

    if (wantRun) {
      this.stamina -= dt * 1.0;
      if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; }
    } else {
      this.stamina = Math.min(P.staminaMax, this.stamina + dt * P.staminaRegen * (this.crouching ? 1.9 : 1));
      if (this.exhausted && this.stamina > P.staminaMax * 0.42) this.exhausted = false;
    }

    const yaw = this.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let dx = fx * inp.f + rx * inp.s;
    let dz = fz * inp.f + rz * inp.s;
    const len = Math.hypot(dx, dz);
    if (len > 0.0001) { dx /= len; dz /= len; }

    const wish = this.falling ? 0 : (len > 0.0001 ? target : 0);
    const airK = this.grounded ? 1 : 0.28;
    const ax = dx * wish - this.vel.x, az = dz * wish - this.vel.z;
    const rate = (wish > 0 ? P.accel : P.decel) * airK;
    this.vel.x += ax * Math.min(1, rate * dt);
    this.vel.z += az * Math.min(1, rate * dt);

    this.vel.y -= P.gravity * dt;
    if (inp.jump && this.grounded && !this.crouching && !this.falling) {
      this.vel.y = P.jump; this.grounded = false; inp.jump = false;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // Ground is a height field now: flat almost everywhere, but the Level 94 hills
    // are surfaces you walk over rather than scenery you pass through.
    const ground = this.level.groundAt ? this.level.groundAt(this.pos.x, this.pos.z) : 0;
    const wasAir = !this.grounded;
    if (this.pos.y <= ground) {
      const climbed = ground - this.pos.y;
      this.pos.y = ground;
      // a step up should not read as a landing impact
      if (wasAir && climbed > 0 && climbed < P.stepHeight) this.vel.y = 0;
      if (wasAir && climbed >= P.stepHeight) {
        const impact = Math.min(1, -this.vel.y / 16);
        if (impact > 0.05) {
          this.landVel = -impact * 5.2;
          if (this.onLand) this.onLand(impact, this.falling);
        }
      }
      this.falling = false;
      this.vel.y = 0;
      this.grounded = true;
    } else this.grounded = false;

    if (!this.falling) collideCircle(this.level, this.pos, P.radius, this.level.propBoxes);

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.inWater += ((this.level.waterAt(this.pos.x, this.pos.z) > 0 ? 1 : 0) - this.inWater) * Math.min(1, dt * 6);

    // ---- walk cycle -------------------------------------------------------
    const stride = this.crouching ? 3.9 : (this.speed > P.walk * 1.25 ? 2.28 : 2.75);
    if (this.grounded && this.speed > 0.25) {
      this.bobT += this.speed * dt * stride;
    } else {
      this.bobT += dt * 0.85;
    }
    const half = Math.floor(this.bobT / Math.PI);
    if (half !== this.stepPhase) {
      this.stepPhase = half;
      if (this.grounded && this.speed > 0.9 && this.onStep) {
        this.onStep(Math.min(1, this.speed / P.run), this.inWater > 0.4);
      }
    }

    const amp = Math.min(1, this.speed / P.walk);
    const runK = this.speed > P.walk * 1.2 ? 1.55 : 1;
    this.bobY = -Math.abs(Math.sin(this.bobT)) * 0.052 * amp * runK;
    this.bobX = Math.sin(this.bobT) * 0.036 * amp * runK;
    const bobRoll = Math.sin(this.bobT) * 0.018 * amp * runK;

    // turning weight
    let dyaw = this.yaw - this.lastYaw;
    while (dyaw > Math.PI) dyaw -= TAU;
    while (dyaw < -Math.PI) dyaw += TAU;
    this.lastYaw = this.yaw;
    this.turnSway += (-dyaw * 7.0 - this.turnSway) * Math.min(1, dt * 9);
    this.turnSway = Math.max(-0.09, Math.min(0.09, this.turnSway));

    // hand-held drift: two slow incommensurate sines per axis
    this.driftT += dt;
    const d = this.driftT;
    const breathK = this.exhausted ? 2.0 : (this.speed > P.walk * 1.2 ? 1.5 : 1);
    this.breath += dt * (this.exhausted ? 4.4 : (this.speed > 0.4 ? 2.4 : 1.5));
    const bq = Math.sin(this.breath);
    this.driftYaw = (Math.sin(d * 0.51) * 0.010 + Math.sin(d * 1.27) * 0.0045) * (1 + amp * 0.7);
    this.driftPitch = (Math.sin(d * 0.63) * 0.008 + Math.sin(d * 1.71) * 0.0035) * (1 + amp * 0.7)
      + bq * 0.004 * breathK;
    this.driftRoll = Math.sin(d * 0.41) * 0.011 + Math.sin(d * 1.13) * 0.005;

    // landing spring
    this.landDip += this.landVel * dt;
    this.landVel += (-this.landDip * 210 - this.landVel * 21) * dt;
    if (this.landDip < -0.42) this.landDip = -0.42;

    this.lookBack += (this.lookBackTarget - this.lookBack) * Math.min(1, dt * 8.5);

    this.roll += (bobRoll + this.turnSway + this.driftRoll - this.roll) * Math.min(1, dt * 14);

    // ---- camera -----------------------------------------------------------
    const eye = this.eyeHeight() + this.bobY + this.landDip + bq * 0.008 * breathK;
    const sx = Math.cos(this.yaw) * this.bobX, sz = -Math.sin(this.yaw) * this.bobX;
    this.camera.position.set(this.pos.x + sx, this.pos.y + eye, this.pos.z + sz);
    const lb = this.lookBack * Math.PI * 0.86;
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + this.driftYaw + lb;
    this.camera.rotation.x = Math.max(-1.16, Math.min(1.34, this.pitch + this.driftPitch));
    this.camera.rotation.z = this.roll;

    // ---- legs -------------------------------------------------------------
    const back = 0.10;
    this.rig.position.set(this.pos.x + Math.sin(this.yaw) * back, this.pos.y, this.pos.z + Math.cos(this.yaw) * back);
    this.rig.rotation.y = this.yaw;
    this.hips.position.y = (0.92 - this.crouch * 0.44) + this.bobY * 0.5 + this.landDip * 0.7;
    this.hips.rotation.x = this.crouch * 0.36 + Math.min(0.22, this.speed * 0.028);
    const swing = Math.min(1, this.speed / P.walk) * (this.crouching ? 0.42 : 0.8);
    for (const L of this.legs) {
      const ph = this.bobT + (L.side > 0 ? 0 : Math.PI);
      const s = Math.sin(ph), c = Math.cos(ph);
      L.thigh.rotation.x = s * 0.62 * swing - this.crouch * 0.72;
      L.shin.rotation.x = -Math.max(0, -c) * 0.92 * swing - this.crouch * 0.95 - 0.03;
      L.foot.rotation.x = (0.22 - s * 0.34) * swing + this.crouch * 0.5;
    }
  }

  addLook(dx, dy) {
    this.yaw -= dx;
    this.pitch -= dy;
    this.pitch = Math.max(-1.12, Math.min(1.30, this.pitch));
  }
}
