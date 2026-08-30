// NOCLIP - multiplayer. Host-authoritative: the host owns The Entity and the world
// events, guests stream their own transform. Transport is WebRTC with Firebase RTDB
// signalling; with no config it falls back to BroadcastChannel so two tabs can play.

import * as THREE from 'three';

// Paste the web config from the Firebase project on jerzysukiennik203 here.
export const FIREBASE_CONFIG = null;

const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

// The tape code is the room name AND the level seed, so the same code always
// rebuilds the same rooms on every machine.
export function tapeCode() {
  const m = location.hash.match(/tape=([A-Z0-9]{4,6})/i);
  return m ? m[1].toUpperCase() : null;
}

export function newTapeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}

export function setTapeCode(code) {
  history.replaceState(null, '', location.pathname + '#tape=' + code);
}

export function hashTape(code) {
  return [...String(code)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
}

/* ---------------------------------------------------------- avatars ------- */

export function makeAvatar(color) {
  const skin = new THREE.MeshLambertMaterial({ color: 0x2f3033 });
  const hi = new THREE.MeshLambertMaterial({ color });
  const g = new THREE.Group();
  const limb = (len, r0, r1, m) => {
    const c = new THREE.CylinderGeometry(r0, r1, len, 6, 1);
    c.translate(0, -len / 2, 0);
    return new THREE.Mesh(c, m);
  };
  const hips = new THREE.Group(); hips.position.y = 0.92; g.add(hips);
  const torso = limb(0.60, 0.17, 0.20, hi); torso.position.y = 0.60; torso.scale.y = -1; hips.add(torso);
  const chest = new THREE.Group(); chest.position.y = 0.60; hips.add(chest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), skin);
  head.position.y = 0.20; head.scale.set(0.9, 1.1, 1.0); chest.add(head);
  const neck = limb(0.10, 0.05, 0.05, skin); neck.position.y = 0.10; neck.scale.y = -1; chest.add(neck);
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.18, 0.02, 0); chest.add(sh);
    sh.add(limb(0.30, 0.055, 0.045, hi));
    const fo = new THREE.Group(); fo.position.y = -0.30; sh.add(fo);
    fo.add(limb(0.28, 0.045, 0.038, skin));
    arms.push({ sh, fo, side: s });
    const th = new THREE.Group(); th.position.set(s * 0.11, -0.10, 0); hips.add(th);
    th.add(limb(0.44, 0.08, 0.065, skin));
    const sn = new THREE.Group(); sn.position.y = -0.44; th.add(sn);
    sn.add(limb(0.44, 0.065, 0.05, skin));
    legs.push({ th, sn, side: s });
  }
  // the camcorder they are holding, and the light it throws
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.22), new THREE.MeshLambertMaterial({ color: 0x1b1b1d }));
  cam.position.set(0.09, -0.30, -0.12);
  arms[1].fo.add(cam);
  const lamp = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff3d0, toneMapped: false }));
  lamp.position.set(0, 0, -0.115); lamp.rotation.y = Math.PI;
  cam.add(lamp);
  const tag = new THREE.PointLight(color, 0.35, 4.5, 1.8);
  tag.position.set(0, 1.5, 0);
  g.add(tag);
  g.userData = { hips, chest, arms, legs, head, gait: 0, light: tag };
  return g;
}

export function animAvatar(av, dt, speed, crouch, yaw, pitch) {
  const d = av.userData;
  d.gait += dt * (speed * 2.6 + 0.4);
  const amp = Math.min(1, speed / 2.6);
  d.hips.position.y = (0.92 - crouch * 0.40) - Math.abs(Math.sin(d.gait)) * 0.05 * amp;
  d.hips.rotation.x = crouch * 0.34 + Math.min(0.2, speed * 0.03);
  d.chest.rotation.x = Math.max(-0.7, Math.min(0.7, -pitch * 0.55));
  d.head.rotation.x = Math.max(-0.7, Math.min(0.7, -pitch * 0.45));
  av.rotation.y = yaw;
  for (const L of d.legs) {
    const ph = d.gait + (L.side > 0 ? 0 : Math.PI);
    L.th.rotation.x = Math.sin(ph) * 0.62 * amp - crouch * 0.7;
    L.sn.rotation.x = -Math.max(0, -Math.cos(ph)) * 0.9 * amp - crouch * 0.9 - 0.03;
  }
  for (const A of d.arms) {
    if (A.side > 0) { A.sh.rotation.x = -1.05 + pitch * 0.4; A.sh.rotation.z = -0.28; A.fo.rotation.x = -0.85; continue; }
    const ph = d.gait + Math.PI;
    A.sh.rotation.x = Math.sin(ph) * 0.42 * amp;
    A.fo.rotation.x = -0.30 - Math.max(0, Math.sin(ph)) * 0.35 * amp;
  }
}

/* ------------------------------------------------------- transports ------- */

class LocalTransport {
  constructor(code, onMsg, onPeer) {
    this.ch = new BroadcastChannel('noclip-' + code);
    this.id = Math.random().toString(36).slice(2, 9);
    this.onMsg = onMsg; this.onPeer = onPeer;
    this.peers = new Set();
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.from === this.id) return;
      if (m.t === '__hello') {
        if (!this.peers.has(m.from)) { this.peers.add(m.from); this.onPeer('join', m.from); }
        this.ch.postMessage({ t: '__hi', from: this.id, to: m.from });
        return;
      }
      if (m.t === '__hi') {
        if (!this.peers.has(m.from)) { this.peers.add(m.from); this.onPeer('join', m.from); }
        return;
      }
      if (m.t === '__bye') { this.peers.delete(m.from); this.onPeer('leave', m.from); return; }
      if (m.to && m.to !== this.id) return;
      this.onMsg(m.from, m.d);
    };
    this.ch.postMessage({ t: '__hello', from: this.id });
    addEventListener('pagehide', () => this.ch.postMessage({ t: '__bye', from: this.id }));
  }
  send(to, d) { this.ch.postMessage({ t: 'd', from: this.id, to: to || null, d }); }
  close() { try { this.ch.postMessage({ t: '__bye', from: this.id }); this.ch.close(); } catch (e) { } }
}

class RtcTransport {
  constructor(code, cfg, onMsg, onPeer, onRole) {
    this.code = code; this.onMsg = onMsg; this.onPeer = onPeer; this.onRole = onRole;
    this.id = Math.random().toString(36).slice(2, 9);
    this.peers = new Map();
    this.isHost = false;
    this._start(cfg);
  }

  async _start(cfg) {
    const app = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const db = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
    this.db = db;
    const a = app.initializeApp(cfg);
    this.rt = db.getDatabase(a);
    const root = db.ref(this.rt, `noclip/${this.code}`);
    this.root = root;

    // first writer claims the host slot
    const hostRef = db.ref(this.rt, `noclip/${this.code}/host`);
    const res = await db.runTransaction(hostRef, (cur) => {
      if (cur === null || (Date.now() - (cur.ts || 0)) > 25000) return { id: this.id, ts: Date.now() };
      return undefined;
    });
    this.isHost = res.committed && res.snapshot.val() && res.snapshot.val().id === this.id;
    this.onRole(this.isHost);

    if (this.isHost) {
      this.beat = setInterval(() => db.set(hostRef, { id: this.id, ts: Date.now() }), 8000);
      db.onChildAdded(db.ref(this.rt, `noclip/${this.code}/offers`), (snap) => this._answer(snap.key, snap.val()));
    } else {
      this.hostId = res.snapshot.val().id;
      this._offer();
    }
    addEventListener('pagehide', () => this.close());
  }

  _wire(pc, id) {
    const p = { pc, dc: null, id };
    this.peers.set(id, p);
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        this.peers.delete(id); this.onPeer('leave', id);
      }
    };
    return p;
  }

  _bindDc(p, dc) {
    p.dc = dc;
    dc.onopen = () => this.onPeer('join', p.id);
    dc.onclose = () => { this.peers.delete(p.id); this.onPeer('leave', p.id); };
    dc.onmessage = (e) => { try { this.onMsg(p.id, JSON.parse(e.data)); } catch (err) { } };
  }

  async _offer() {
    const db = this.db;
    const pc = new RTCPeerConnection(ICE);
    const p = this._wire(pc, this.hostId);
    const dc = pc.createDataChannel('n', { ordered: false, maxRetransmits: 0 });
    this._bindDc(p, dc);
    const mine = db.ref(this.rt, `noclip/${this.code}/offers/${this.id}`);
    pc.onicecandidate = (e) => { if (e.candidate) db.push(db.ref(this.rt, `noclip/${this.code}/offers/${this.id}/ice`), e.candidate.toJSON()); };
    const off = await pc.createOffer();
    await pc.setLocalDescription(off);
    await db.set(db.ref(this.rt, `noclip/${this.code}/offers/${this.id}/sdp`), { type: off.type, sdp: off.sdp });
    db.onValue(db.ref(this.rt, `noclip/${this.code}/answers/${this.id}/sdp`), async (s) => {
      const v = s.val();
      if (v && !pc.currentRemoteDescription) await pc.setRemoteDescription(v);
    });
    db.onChildAdded(db.ref(this.rt, `noclip/${this.code}/answers/${this.id}/ice`), (s) => {
      pc.addIceCandidate(new RTCIceCandidate(s.val())).catch(() => { });
    });
    db.onDisconnect(mine).remove();
  }

  async _answer(gid, val) {
    if (this.peers.has(gid) || !val || !val.sdp) return;
    const db = this.db;
    const pc = new RTCPeerConnection(ICE);
    const p = this._wire(pc, gid);
    pc.ondatachannel = (e) => this._bindDc(p, e.channel);
    pc.onicecandidate = (e) => { if (e.candidate) db.push(db.ref(this.rt, `noclip/${this.code}/answers/${gid}/ice`), e.candidate.toJSON()); };
    await pc.setRemoteDescription(val.sdp);
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    await db.set(db.ref(this.rt, `noclip/${this.code}/answers/${gid}/sdp`), { type: ans.type, sdp: ans.sdp });
    db.onChildAdded(db.ref(this.rt, `noclip/${this.code}/offers/${gid}/ice`), (s) => {
      pc.addIceCandidate(new RTCIceCandidate(s.val())).catch(() => { });
    });
  }

  send(to, d) {
    const s = JSON.stringify(d);
    for (const [id, p] of this.peers) {
      if (to && id !== to) continue;
      if (p.dc && p.dc.readyState === 'open') { try { p.dc.send(s); } catch (e) { } }
    }
  }

  close() {
    clearInterval(this.beat);
    for (const [, p] of this.peers) { try { p.pc.close(); } catch (e) { } }
    if (this.isHost && this.db && this.rt) { try { this.db.remove(this.db.ref(this.rt, `noclip/${this.code}/host`)); } catch (e) { } }
  }
}

/* ------------------------------------------------------------- net -------- */

const COLORS = [0xe8d16a, 0x6ad1e8, 0xe86a8f, 0x8fe86a, 0xc06ae8, 0xe8a06a];

export class Net {
  constructor(scene, code) {
    this.scene = scene;
    this.code = code;
    this.players = new Map();
    this.isHost = true;
    this.local = true;
    this.seq = 0;
    this.onEvent = null;
    this.nick = 'CAM' + Math.floor(Math.random() * 90 + 10);

    const onMsg = (from, d) => this._recv(from, d);
    const onPeer = (kind, id) => kind === 'join' ? this._join(id) : this._leave(id);

    if (FIREBASE_CONFIG) {
      this.local = false;
      this.isHost = false;
      this.tp = new RtcTransport(code, FIREBASE_CONFIG, onMsg, onPeer, (host) => { this.isHost = host; });
    } else {
      this.tp = new LocalTransport(code, onMsg, onPeer);
      // in local mode the lower id hosts, so two tabs settle deterministically
      this.isHost = true;
      this._localVote();
    }
    this.id = this.tp.id;
  }

  _localVote() {
    setInterval(() => {
      const ids = [this.tp.id, ...this.tp.peers];
      ids.sort();
      this.isHost = ids[0] === this.tp.id;
    }, 1200);
  }

  count() { return this.players.size + 1; }

  _join(id) {
    if (this.players.has(id)) return;
    const idx = this.players.size % COLORS.length;
    const av = makeAvatar(COLORS[(idx + 1) % COLORS.length]);
    av.visible = false;
    this.scene.add(av);
    this.players.set(id, {
      id, av, pos: new THREE.Vector3(), tgt: new THREE.Vector3(),
      yaw: 0, tyaw: 0, pitch: 0, speed: 0, crouch: 0, alive: true, noise: 0, last: performance.now()
    });
    if (this.onEvent) this.onEvent('join', { id });
  }

  _leave(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.scene.remove(p.av);
    this.players.delete(id);
    if (this.onEvent) this.onEvent('leave', { id });
  }

  _recv(from, d) {
    if (!d) return;
    if (!this.players.has(from)) this._join(from);
    const p = this.players.get(from);
    p.last = performance.now();
    if (d.t === 'in') {
      p.tgt.set(d.p[0], d.p[1], d.p[2]);
      p.tyaw = d.y; p.pitch = d.i; p.speed = d.s; p.crouch = d.c; p.alive = !!d.a; p.noise = d.n;
    } else if (d.t === 'sn') {
      this.remoteSnapshot = d;
    } else if (d.t === 'ev') {
      if (this.onEvent) this.onEvent(d.k, d.v || {}, from);
    }
  }

  sendInput(player, noise) {
    this.tp.send(null, {
      t: 'in',
      p: [player.pos.x, player.pos.y, player.pos.z],
      y: player.yaw, i: player.pitch,
      s: player.speed, c: player.crouch,
      a: player.alive ? 1 : 0, n: noise
    });
  }

  sendSnapshot(ent, extra) {
    if (!this.isHost) return;
    this.tp.send(null, {
      t: 'sn',
      e: [ent.pos.x, ent.pos.z, ent.yaw, ent.state, ent.gait, ent.visible ? 1 : 0],
      x: extra || null
    });
  }

  event(kind, val) { this.tp.send(null, { t: 'ev', k: kind, v: val || {} }); }

  update(dt) {
    const now = performance.now();
    for (const [id, p] of this.players) {
      if (now - p.last > 9000) { this._leave(id); continue; }
      p.pos.lerp(p.tgt, Math.min(1, dt * 12));
      let dy = p.tyaw - p.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      p.yaw += dy * Math.min(1, dt * 12);
      p.av.visible = p.alive;
      p.av.position.copy(p.pos);
      animAvatar(p.av, dt, p.speed, p.crouch, p.yaw, p.pitch);
    }
  }

  close() { this.tp.close(); }
}
