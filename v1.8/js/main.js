// NOCLIP - boot, the fall, the loop. No menu: the tape is already rolling when the
// page finishes building the level.

import * as THREE from 'three';
import { CELL, CAM, PLAYER, RES, GRID_W } from './config.js';
import { Level, cxOf, cyOf, wx, wz } from './level.js';
import { setAnisotropy } from './tex.js';
import { Player } from './player.js';
import { Entity, STATE } from './entity.js';
import { LightPool } from './lights.js';
import { Audio } from './audio.js';
import { FX } from './fx.js';
import { Hud } from './hud.js';
import { Net, tapeCode, newTapeCode, setTapeCode, hashTape } from './net.js';
import { createMenu } from './menu.js';
import { Touch, isTouchDevice } from './touch.js';

THREE.ColorManagement.enabled = true;

const hud = new Hud();
const audio = new Audio();
const clock = new THREE.Clock();

let renderer, scene, camera, fx, level, player, entity, lights, net;
let started = false, locked = false, over = false;
let T = 0, battery = 1, signal = 0, glitch = 0, hurt = 0, fadeK = 1;
let deaths = 0, notesRead = 0;
let dead = 0, deadT = 0, deathYaw = 0;
let fogCur = { c: new THREE.Color(0x4a4321), d: 0.04, a: new THREE.Color(0x2b2a13), ai: 0.6 };
const hemiSky = new THREE.Color(0xfff6d8), hemiGnd = new THREE.Color(0x6a5f28), hemiTarget = new THREE.Color();
let handOn = true;
let tape = null, menu = null, inMenu = true, menuT = 0, sens = 0.0022;
let menuAnchor = null;
let touch = null;
const isTouch = isTouchDevice();
const keys = Object.create(null);
const tmp = new THREE.Vector3();

/* --------------------------------------------------------------- boot ----- */

async function boot() {
  const canvas = document.getElementById('gl');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.domElement.style.touchAction = 'none';
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 1);
  setAnisotropy(renderer.capabilities.getMaxAnisotropy());

  hud.bootText('building level');
  await frame();

  tape = tapeCode() || newTapeCode();
  const seed = hashTape(tape);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x4a4321, 0.04);
  scene.background = new THREE.Color(0x0a0a08);

  camera = new THREE.PerspectiveCamera(CAM.fov, RES.w / RES.h, CAM.near, CAM.far);
  camera.rotation.order = 'YXZ';

  level = new Level(seed);
  scene.add(level.group);

  hud.bootText('threading tape');
  await frame();

  fx = new FX(renderer);
  lights = new LightPool(scene, 8);
  player = new Player(level, camera);
  scene.add(player.rig);
  entity = new Entity(level);
  scene.add(entity.root);

  buildPickups();

  player.onStep = (i, wet) => {
    audio.step(i, wet);
    noise = Math.max(noise, wet ? 0.75 : (i > 0.6 ? 0.9 : 0.35));
  };
  player.onLand = (impact, wasIntro) => {
    audio.play('thud', { vol: 0.35 + impact * 0.6, rate: 0.85 + Math.random() * 0.2 });
    hurt = Math.max(hurt, impact * 0.45);
    if (wasIntro) {
      hud.show();
      hud.say('camera is rolling. find a way out.', 5.0);
      setTimeout(() => { if (!over) hud.say('press T to copy this tape\u2019s link - others fall in with you', 5.0); }, 7000);
    }
    noise = Math.max(noise, impact);
  };
  entity.onState = onEntityState;

  hud.bootText('fetching audio');
  audio.load((p) => hud.bootText('fetching audio ' + Math.round(p * 100) + '%')).then((r) => {
    audio.loop('buzz', 'buzz', 0.0, 1.0);
    audio.loop('mains', 'mains', 0.0, 1.0);
    if (inMenu) { audio.setMusic(null); audio.setMusic('menu'); }
    if (r.failed.length) console.info('[noclip] synth fallback for:', r.failed.join(', '));
  });

  if (isTouch) {
    touch = new Touch({
      sens: 0.0042,
      onLook: (dx, dy) => { if (!inMenu && !over) player.addLook(dx, dy); },
      onLamp: () => { handOn = !handOn; }
    });
  }

  addEventListener('resize', onResize);
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKey);
  document.addEventListener('mousemove', onMouse);
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    document.body.classList.toggle('unlocked', !locked);
  });
  // Chrome refuses to start an AudioContext without a gesture, and the tape starts
  // on its own, so ANY interaction must unlock the sound - not just a canvas click.
  const unlock = () => {
    audio.init();
    audio.resume();
    audio.kick();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, unlock, { capture: true, passive: true });
  }
  canvas.addEventListener('mousedown', () => {
    unlock();
    if (!locked && !inMenu) canvas.requestPointerLock();
  });

  hud.hideBoot();
  started = true;
  clock.start();
  startHeartbeat();
  requestAnimationFrame(loop);
  openMenu();
}

const frame = () => new Promise(r => setTimeout(r, 0));

function onResize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

/* --------------------------------------------------------------- menu ---- */

// The menu sits over the live level, so the camera drifts through a real room
// behind the blur instead of a still frame.
function pickMenuAnchor() {
  const lob = level.zones.find(z => z.type.id === 'lobby') || level.zones[0];
  const b = { x0: lob.rect.x + 2, y0: lob.rect.y + 2, x1: lob.rect.x + lob.rect.w - 3, y1: lob.rect.y + lob.rect.h - 3 };
  for (let t = 0; t < 400; t++) {
    const cx = Math.floor(b.x0 + Math.random() * (b.x1 - b.x0));
    const cy = Math.floor(b.y0 + Math.random() * (b.y1 - b.y0));
    if (!level.isOpen(cx, cy)) continue;
    let free = 0;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) if (level.isOpen(cx + a, cy + c)) free++;
    if (free < 8) continue;
    return { x: wx(cx) + CELL / 2, z: wz(cy) + CELL / 2, yaw: Math.random() * Math.PI * 2 };
  }
  return { x: level.spawnWorld.x, z: level.spawnWorld.z, yaw: 0 };
}

function menuFrame(dt) {
  menuT += dt;
  const a = menuAnchor;
  const yaw = a.yaw + Math.sin(menuT * 0.055) * 0.55 + menuT * 0.012;
  const r = 1.1 + Math.sin(menuT * 0.09) * 0.5;
  camera.position.set(a.x + Math.sin(menuT * 0.07) * r, 1.62 + Math.sin(menuT * 0.21) * 0.035, a.z + Math.cos(menuT * 0.05) * r);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(Math.sin(menuT * 0.13) * 0.035 - 0.02, yaw, Math.sin(menuT * 0.11) * 0.012);
  lights.update(level, camera.position.x, camera.position.y, camera.position.z, T);
  lights.setHand(camera.position.x, camera.position.y, camera.position.z, 0);
  level.cullChunks(camera.position.x, camera.position.z, 58);
  const zn = level.zoneAtWorld(camera.position.x, camera.position.z);
  if (zn) {
    scene.fog.color.setHex(zn.type.fogColor);
    scene.fog.density = zn.type.fog;
    scene.background.setHex(zn.type.fogColor).multiplyScalar(0.35);
    lights.ambient.color.setHex(zn.type.ambient);
    lights.ambient.intensity = zn.type.ambientI;
    lights.setHemi(zn.type.hemiSky, zn.type.hemiGround, zn.type.hemiI);
  }
}

function applySettings(s) {
  sens = s.sens;
  if (audio.master) audio.master.gain.value = s.master;
  if (audio.ready) audio.setMusicScale(s.music);
  let q = s.quality === 'low' ? [384, 288] : (s.quality === 'high' ? [720, 540] : [512, 384]);
  if (isTouch) q = [Math.round(q[0] * 0.78), Math.round(q[1] * 0.78)];
  fx.setResolution(q[0], q[1]);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

function openMenu() {
  inMenu = true;
  if (touch) touch.show(false);
  menuAnchor = pickMenuAnchor();
  player.rig.visible = false;
  entity.root.visible = false;
  hud.hideHint();
  menu = createMenu({
    tape,
    onSettings: applySettings,
    onStart: (route, code) => startRun(route, code)
  });
  applySettings(menu.settings);
  audio.setMusic('menu');
}

async function rebuildLevel(seed) {
  hud.bootText('threading tape');
  hud.boot.removeAttribute('hidden');
  hud.boot.classList.remove('gone');
  await frame();
  level.dispose();
  for (const p of pickups) if (!p.taken) scene.remove(p.o);
  pickups.length = 0;
  level = new Level(seed);
  scene.add(level.group);
  player.level = level;
  entity.level = level;
  buildPickups();
  entity.reset(level.spawnWorld.x, level.spawnWorld.z);
  hud.hideBoot();
}

async function startRun(route, code) {
  if (route === 'join' && code && code !== tape) {
    tape = code;
    setTapeCode(tape);
    await rebuildLevel(hashTape(tape));
  } else {
    if (route !== 'join') tape = tape || newTapeCode();
    setTapeCode(tape);
  }

  net = new Net(scene, tape);
  net.onEvent = onNetEvent;
  hud.setTape(tape, 1);

  inMenu = false;
  player.rig.visible = true;
  player.respawnAt(level.spawnWorld.x, level.spawnWorld.z);
  player.pos.y = PLAYER.fallFrom;
  player.yaw = Math.random() * Math.PI * 2;
  player.pitch = 0;
  T = 0;
  audio.resume();
  audio.setMusic('explore');
  hud.show();
  if (touch) { touch.show(true); touch.lamp = handOn; }
  else {
    const canvas = renderer.domElement;
    if (!locked) canvas.requestPointerLock();
  }
  if (route === 'host') setTimeout(() => shareTape(), 1400);
}

/* -------------------------------------------------------------- input ---- */

function onKey(e) {
  if (inMenu) return;
  const down = e.type === 'keydown';
  const k = e.code;
  keys[k] = down;
  if (down && k === 'KeyF') { handOn = !handOn; hud.say(handOn ? 'lamp on' : 'lamp off', 1.4); }
  if (down && k === 'KeyR' && over) location.reload();
  if (down && k === 'KeyT') shareTape();
  if (k === 'Space' && down) player.input.jump = true;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(k)) e.preventDefault();
}

// No menu means no lobby: the invite is the URL, copied with one key.
function shareTape() {
  const url = location.origin + location.pathname + '#tape=' + net.code;
  const done = () => hud.say('link copied - anyone opening it falls into tape ' + net.code, 4.5);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => hud.say(url, 7));
  else hud.say(url, 7);
}

function onMouse(e) {
  if (!locked || !player || inMenu) return;
  player.addLook(e.movementX * sens, e.movementY * sens);
}

function readInput() {
  const i = player.input;
  i.f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  i.s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  i.run = !!(keys.ShiftLeft || keys.ShiftRight);
  i.crouch = !!(keys.KeyC || keys.ControlLeft);
  player.lookBackTarget = keys.KeyQ ? 1 : 0;
  if (touch && touch.enabled) {
    touch.apply(i);
    player.lookBackTarget = touch.lookBack ? 1 : 0;
  }
}

/* ------------------------------------------------------------ pickups ---- */

const pickups = [];
function buildPickups() {
  const g = new THREE.BoxGeometry(0.16, 0.09, 0.07);
  const m = new THREE.MeshBasicMaterial({ color: 0x7effc0, toneMapped: false });
  for (let k = 0; k < 14; k++) {
    for (let t = 0; t < 200; t++) {
      const cx = 2 + ((Math.random() * (GRID_W - 4)) | 0);
      const cy = 2 + ((Math.random() * (GRID_W - 4)) | 0);
      if (!level.isOpen(cx, cy)) continue;
      const o = new THREE.Mesh(g, m);
      o.position.set(wx(cx) + CELL / 2 + (Math.random() - 0.5), 0.06, wz(cy) + CELL / 2 + (Math.random() - 0.5));
      o.rotation.y = Math.random() * 6.28;
      scene.add(o);
      pickups.push({ o, taken: false });
      break;
    }
  }
}

/* ----------------------------------------------------------- director ---- */

let noise = 0;
let nextEvent = 22;
let breathT = 3;
let musicResume = 0;
let stepT = 0;
let nearBreathT = 0;
const fixScan = [];

function onEntityState(s) {
  if (s === STATE.STALK) {
    audio.sting('growl2', { vol: 0.55, rate: 0.70, lp: 900, dur: 2.6 });
    hud.say('...', 1.4);
  } else if (s === STATE.HUNT) {
    audio.setMusic('hunt');
    audio.sting('growl', { vol: 1.0, rate: 0.64, dur: 3.2 });
    audio.duckFor(2.2);
    hud.alert('RUN');
    glitch = Math.max(glitch, 0.55);
    if (net && net.isHost) net.event('hunt', {});
  } else if (s === STATE.AWARE) {
    audio.play('thud', { vol: 0.4, rate: 0.6 });
  } else if (s === STATE.DORMANT) {
    audio.setMusic('explore');
  }
  if (s === STATE.STALK || s === STATE.AWARE) audio.setMusic('stalk');
}

function director(dt) {
  nextEvent -= dt;
  if (nextEvent > 0) return;
  nextEvent = 26 + Math.random() * 44;
  const pick = Math.random();
  const zn = level.zoneAtWorld(player.pos.x, player.pos.z);

  if (pick < 0.24) {
    // a run of ceiling panels gives out around the player
    const near = level.nearFixtures(player.pos.x, player.pos.z, 7, []);
    let n = 0;
    for (const f of near) { if (Math.random() < 0.65) { f.flick = 1; n++; } }
    setTimeout(() => near.forEach(f => { f.flick = 0; }), 3400 + Math.random() * 3000);
    if (n) { audio.play('mains', { vol: 0.5, rate: 0.7, dur: 1.6 }); glitch = Math.max(glitch, 0.3); }
  } else if (pick < 0.44) {
    const pan = Math.random() * 2 - 1;
    audio.play('thud', { vol: 0.55, rate: 0.55 + Math.random() * 0.3, pan, lp: 1200 });
    hud.say('something moved.', 2.4);
  } else if (pick < 0.60) {
    // phantom steps directly behind, then nothing
    audio.play('chase', { vol: 0.5, offset: Math.random() * 12, dur: 3.6, lp: 2400, pan: Math.random() * 1.6 - 0.8 });
    hud.say('footsteps. not yours.', 3.0);
  } else if (pick < 0.74) {
    audio.play('wail', { vol: 0.40, rate: 0.8, lp: 1400, pan: Math.random() * 2 - 1, offset: 1 + Math.random() * 14, dur: 3.4 });
    glitch = Math.max(glitch, 0.42);
  } else if (pick < 0.88 && entity.state === STATE.DORMANT) {
    // put it briefly in view down a corridor, then take it away
    placeEntityInView();
    hud.say('...', 1.2);
    audio.sting('growl2', { vol: 0.32, rate: 0.58, lp: 700, dur: 2.4 });
  } else {
    if (zn) { hud.say(zn.type.name.toLowerCase(), 2.6); }
    audio.play('static', { vol: 0.28, dur: 0.7, offset: Math.random() * 8 });
    glitch = Math.max(glitch, 0.8);
  }
}

function placeEntityInView() {
  const yaw = player.yaw;
  const fx2 = -Math.sin(yaw), fz = -Math.cos(yaw);
  for (let d = 22; d > 8; d -= 2) {
    const x = player.pos.x + fx2 * d, z = player.pos.z + fz * d;
    const cx = cxOf(x), cy = cyOf(z);
    if (!level.isOpen(cx, cy)) continue;
    if (!entity.hasLOS(x, 0, z)) continue;
    entity.pos.set(wx(cx) + CELL / 2, 0, wz(cy) + CELL / 2);
    entity.root.visible = true;
    entity.setState(STATE.AWARE);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------- events ---- */

function onNetEvent(kind, val, from) {
  if (kind === 'join' || kind === 'leave') {
    hud.setTape(net.code, net.count());
    hud.say(kind === 'join' ? 'another camera joined the tape' : 'a camera went dark', 3.2);
    return;
  }
  if (kind === 'hunt' && !net.isHost) { audio.setMusic('hunt'); hud.alert('RUN'); }
  if (kind === 'kill') { audio.sting('scream', { vol: 0.5, rate: 0.9, dur: 2.0 }); hud.say('a camera stopped recording', 3.4); }
  if (kind === 'exit') { hud.say('someone found a way out', 4.0); }
  if (kind === 'flick') {
    const f = level.fixtures[val.i];
    if (f) { f.flick = 1; setTimeout(() => { f.flick = 0; }, 3000); }
  }
}

function kill() {
  if (dead) return;
  dead = 1; deadT = 0; deaths++;
  player.alive = false;
  // snap, do not turn: by the time you register it the thing is already on you
  deathYaw = Math.atan2(-(entity.pos.x - camera.position.x), -(entity.pos.z - camera.position.z));
  player.yaw = deathYaw;
  player.pitch = 0.10;
  player.vel.set(0, 0, 0);
  entity.root.visible = true;
  entity.setState(STATE.HUNT);
  audio.setMusic(null);
  musicResume = 6.0;
  audio.duckFor(2.4);
  audio.sting('scream', { vol: 1.0, rate: 1.06, dur: 1.5 });
  audio.sting('growl', { vol: 1.0, rate: 0.42, dur: 1.6 });
  audio.play('static', { vol: 0.7, dur: 0.9, offset: Math.random() * 8 });
  hurt = 1;
  glitch = 1;
  hud.alert('SIGNAL LOST');
  if (net) net.event('kill', { id: net.id });
}

function respawn() {
  const L = level;
  let best = null, bd = -1;
  for (let t = 0; t < 500; t++) {
    const cx = 2 + ((Math.random() * (GRID_W - 4)) | 0);
    const cy = 2 + ((Math.random() * (GRID_W - 4)) | 0);
    if (!L.isOpen(cx, cy)) continue;
    const d = Math.hypot(wx(cx) - entity.pos.x, wz(cy) - entity.pos.z);
    if (d > bd) { bd = d; best = [cx, cy]; }
    if (bd > 70) break;
  }
  const [cx, cy] = best || L.spawn;
  const px = wx(cx) + CELL / 2, pz = wz(cy) + CELL / 2;
  player.respawnAt(px, pz);
  // it restarts its approach from a fixed band around wherever you woke up
  entity.reset(px, pz);
  dead = 0;
  hurt = 0;
  battery = Math.min(1, battery + 0.18);
  entity.mat.emissive.setHex(0x030304);
  entity.mat.color.setHex(0x08080a);
  entity.neck.rotation.x = 0;
  entity.root.position.y = 0;
  hud.blackout(false);
  hud.say('tape resumes. you are somewhere else now.', 4.5);
  musicResume = 8.0;
}

function finish() {
  over = true;
  audio.setMusic('end');
  audio.play('static', { vol: 0.6, dur: 3.0, offset: 1 });
  hud.boot.removeAttribute('hidden');
  hud.boot.classList.remove('gone');
  const mins = Math.floor(T / 60), secs = Math.floor(T % 60);
  hud.boot.innerHTML = `END OF TAPE<br><small>${mins}m ${secs}s &nbsp;·&nbsp; ${notesRead} notes &nbsp;·&nbsp; ${deaths} incidents<br><br>press R to rewind</small>`;
  document.exitPointerLock();
  if (net) net.event('exit', {});
}

/* --------------------------------------------------------------- loop ---- */

function loop() {
  requestAnimationFrame(loop);
  if (!started || heartbeatOwns) return;
  advance(Math.min(0.05, clock.getDelta()));
}

// A backgrounded tab stops rAF. The host must keep simulating or every guest
// freezes with it, so a worker ticks the loop whenever the page is hidden.
// The worker waits for an ack before scheduling the next tick, so a slow frame
// can never queue messages faster than the main thread drains them.
let heartbeatOwns = false;
function startHeartbeat() {
  const src = 'onmessage=e=>{setTimeout(()=>postMessage(1),16)}';
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  w.onmessage = () => {
    if (started && document.hidden) {
      heartbeatOwns = true;
      advance(Math.min(0.05, clock.getDelta()));
      if (window.__nc.forceDraw) fx.render(scene, camera, T);
    } else if (heartbeatOwns) {
      heartbeatOwns = false;
      clock.getDelta();
    }
    w.postMessage(1);
  };
  w.postMessage(1);
}

function advance(dt) {
  T += dt;
  if (inMenu) { menuFrame(dt); return; }
  if (!over) step(dt);
  fx.u('uTime', T);
  fx.u('uHurt', hurt);
  fx.u('uGlitch', glitch);
  fx.u('uBattery', battery);
  fx.u('uFade', fadeK);
  fx.u('uTrack', 0.10 + glitch * 0.5 + (1 - battery) * 0.25);
  fx.render(scene, camera, T);
}

function step(dt) {
  readInput();
  noise *= Math.max(0, 1 - dt * 2.2);

  if (dead) {
    deadT += dt;
    player.input.f = player.input.s = 0;

    // A jumpscare is one violent moment, not a slow drag. The camera is already
    // snapped onto it by kill(); here it lunges into the lens, the frame tears,
    // and the tape cuts hard. Whole thing is under a second.
    const k = Math.min(1, deadT / 0.30);
    const reach = 2.4 - 1.05 * k;   // stops at ~1.35 m: close, but the head still fits
    const dirx = Math.sin(deathYaw), dirz = Math.cos(deathYaw);
    entity.pos.set(camera.position.x - dirx * reach, 0, camera.position.z - dirz * reach);
    entity.yaw = deathYaw;
    entity.hips.position.y = 1.72 + 0.22 * k;      // it comes up over the camera
    entity.animate(dt, 6, { pos: camera.position });
    // its head has to come down to the lens or you are staring at its chest
    entity.neck.rotation.x = -0.55 * k;
    entity.spine.rotation.x = 0.30 + 0.55 * k;

    // Put its head on the lens axis: from a metre away a 2.6 m body is just a wall
    // of torso, and a jumpscare has to frame the head. Measuring the head's world
    // position to derive this threw the body 20 m into the air, so the drop is a
    // fixed figure for the death pose and is clamped either way.
    const headY = 2.34;
    entity.root.position.y = Math.max(-1.3, Math.min(0.3, (camera.position.y - headY) * k));

    const shake = (1 - Math.min(1, deadT / 0.55)) * 0.09;
    player.yaw = deathYaw + (Math.random() - 0.5) * shake;
    player.pitch = 0.06 + (Math.random() - 0.5) * shake;
    player.update(dt, T);

    // Hold the frame readable while it lands, then let the tape tear itself apart.
    // Maxing both from frame one turned the whole scare into an unreadable smear.
    const wreck = Math.max(0, Math.min(1, (deadT - 0.26) / 0.22));
    hurt = 0.18 + 0.82 * wreck;
    glitch = 0.15 + 0.85 * wreck;
    // an albedo of 0.03 stays black no matter how hard you light it, so the body
    // is lifted for exactly as long as it is on screen
    entity.mat.emissive.setRGB(0.072, 0.072, 0.078);
    entity.mat.color.setRGB(0.125, 0.125, 0.135);
    fadeK = deadT < 0.48 ? 1 : Math.max(0, 1 - (deadT - 0.48) * 7.5);
    if (deadT > 0.66) hud.blackout(true);
    if (deadT > 1.50) { fadeK = 1; respawn(); }
    lights.update(level, camera.position.x, camera.position.y, camera.position.z, T);
    // the camcorder lamp flares: a jumpscare you cannot see is just a black frame
    lights.setHand(camera.position.x - dirx * 0.30, camera.position.y, camera.position.z - dirz * 0.30,
      deadT < 0.5 ? 2.1 : 0);
    net.update(dt);
    return;
  }

  player.update(dt, T);
  fadeK += (1 - fadeK) * Math.min(1, dt * 3);

  // ---- breathing ---------------------------------------------------------
  breathT -= dt;
  if (breathT <= 0 && (player.exhausted || (entity.state === STATE.HUNT && player.speed > 3))) {
    breathT = 1.35 + Math.random() * 0.5;
    audio.sting('breath', { vol: player.exhausted ? 0.42 : 0.26, dur: 1.1, rate: 1.05 + Math.random() * 0.15, lp: 3200 });
  } else if (breathT <= 0) breathT = 0.6;

  // ---- battery, lamp -----------------------------------------------------
  battery = Math.max(0, battery - dt * (handOn ? 0.00135 : 0.0005));
  const lampI = handOn ? (0.55 + Math.min(0.45, battery)) * (battery > 0.02 ? 1 : 0) : 0;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  lights.setHand(
    camera.position.x + fwd.x * 0.35,
    camera.position.y + fwd.y * 0.35,
    camera.position.z + fwd.z * 0.35,
    lampI * (0.55 + Math.sin(T * 31) * 0.02));

  // ---- zone blend --------------------------------------------------------
  const zn = level.zoneAtWorld(player.pos.x, player.pos.z);
  if (zn) {
    const t = zn.type;
    const k = Math.min(1, dt * 1.7);
    fogCur.c.lerp(new THREE.Color(t.fogColor), k);
    fogCur.d += (t.fog - fogCur.d) * k;
    fogCur.a.lerp(new THREE.Color(t.ambient), k);
    fogCur.ai += (t.ambientI - fogCur.ai) * k;
    scene.fog.color.copy(fogCur.c);
    scene.fog.density = fogCur.d * (1 + (1 - battery) * 0.25);
    scene.background.copy(fogCur.c).multiplyScalar(0.35);
    lights.ambient.color.copy(fogCur.a);
    lights.ambient.intensity = fogCur.ai;
    hemiSky.lerp(hemiTarget.setHex(t.hemiSky), k); lights.hemi.color.copy(hemiSky);
    hemiGnd.lerp(hemiTarget.setHex(t.hemiGround), k); lights.hemi.groundColor.copy(hemiGnd);
    lights.hemi.intensity += (t.hemiI - lights.hemi.intensity) * k;
    audio.setLoopVol('buzz', t.blackout ? 0.02 : 0.34, 1.2);
    audio.setLoopVol('mains', t.blackout ? 0.30 : 0.12, 1.2);
  }

  lights.update(level, camera.position.x, camera.position.y, camera.position.z, T);
  level.cullChunks(player.pos.x, player.pos.z, 58);

  // ---- water -------------------------------------------------------------
  for (const w of level.water) { w.tex.offset.x = Math.sin(T * 0.11) * 0.02; w.tex.offset.y = T * 0.008; }

  // ---- entity ------------------------------------------------------------
  // yaw matters: the Entity needs to know whether it is being looked at
  const targets = [{
    pos: player.pos, yaw: player.yaw, speed: player.speed, crouching: player.crouching,
    alive: player.alive && !dead, noise
  }];
  for (const [, p] of net.players) targets.push({ pos: p.pos, yaw: p.yaw, speed: p.speed, crouching: p.crouch > 0.5, alive: p.alive, noise: p.noise });

  if (net.isHost) {
    entity.update(dt, T, targets, 1 + Math.min(0.35, T / 900));
    net.sendSnapshot(entity);
  } else if (net.remoteSnapshot) {
    const e = net.remoteSnapshot.e;
    entity.pos.lerp(tmp.set(e[0], 0, e[1]), Math.min(1, dt * 10));
    let dy = e[2] - entity.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    entity.yaw += dy * Math.min(1, dt * 10);
    if (entity.state !== e[3]) entity.setState(e[3]);
    entity.root.visible = !!e[5];
    entity.animate(dt, entity.state === STATE.HUNT ? 5 : 1.4, targets[0]);
  } else {
    entity.update(dt, T, targets, 1);
  }

  const ed = Math.hypot(entity.pos.x - player.pos.x, entity.pos.z - player.pos.z);
  // no kill while you are still coming down through the ceiling
  if (!dead && player.alive && !player.falling && ed < 1.35 && entity.root.visible) kill();

  // Presence is announced by the room, not by the model: fixtures near it fail,
  // and you hear it walking before you ever see it.
  // Distance, not state: the room has to react while it is still only approaching,
  // because that silent approach is the best part and it was going to waste.
  const near = level.nearFixtures(player.pos.x, player.pos.z, 6, fixScan);
  const failRange = entity.state >= STATE.STALK ? 13 : 10;
  for (const f of near) {
    const fd = Math.hypot(f.x - entity.pos.x, f.z - entity.pos.z);
    const want = fd < failRange ? 1 : 0;
    if (want && !f.flick) f.flick = 1;
    else if (!want && f.flick && !f.dead) f.flick = 0;
  }

  // its breathing, once it is genuinely close
  nearBreathT -= dt;
  if (nearBreathT <= 0 && ed < 11) {
    nearBreathT = 2.0 + Math.random() * 1.2;
    audio.sting('breath', { vol: 0.30 * (1 - ed / 11) + 0.10, dur: 1.5, rate: 0.72, lp: 1100 });
  } else if (nearBreathT <= 0) nearBreathT = 0.5;

  // footsteps from wherever it is, panned and attenuated - the main tell
  stepT -= dt;
  if (stepT <= 0 && ed < 30) {
    const spd = Math.hypot(entity.vel.x, entity.vel.z);
    stepT = spd > 3 ? 0.30 : 0.72;
    if (spd > 0.4) {
      const rel = tmp.set(entity.pos.x - camera.position.x, 0, entity.pos.z - camera.position.z);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const pan = Math.max(-1, Math.min(1, rel.clone().normalize().dot(right)));
      const att = Math.pow(Math.max(0, 1 - ed / 30), 2);
      audio.play('thud', { vol: 0.30 * att + 0.10, rate: 0.44 + Math.random() * 0.10, pan, lp: 700 + att * 900 });
    }
  }

  // proximity dread: the tape degrades as it closes in
  const prox = Math.max(0, 1 - ed / 22);
  hurt += ((entity.state >= STATE.STALK ? prox * 0.55 : 0) - hurt) * Math.min(1, dt * 2.2);
  glitch += ((entity.state === STATE.HUNT ? 0.45 + prox * 0.4 : prox * 0.12) - glitch) * Math.min(1, dt * 1.6);
  audio.busSfx && audio.setLoopVol('mains', 0.12 + prox * 0.4, 0.5);
  if (entity.state === STATE.HUNT) fx.u('uSat', 0.55); else fx.u('uSat', 0.78);

  if (musicResume > 0) {
    musicResume -= dt;
    if (musicResume <= 0 && entity.state < STATE.HUNT) audio.setMusic(audio._slotList('resume').length ? 'resume' : 'explore');
  } else if (entity.state === STATE.DORMANT && audio.musicMode === null) audio.setMusic('explore');

  // ---- pickups, notes, exit ---------------------------------------------
  for (const p of pickups) {
    if (p.taken) continue;
    p.o.rotation.y += dt * 1.4;
    if (Math.hypot(p.o.position.x - player.pos.x, p.o.position.z - player.pos.z) < 1.0) {
      p.taken = true; scene.remove(p.o);
      battery = Math.min(1, battery + 0.3);
      audio.play('thud', { vol: 0.25, rate: 2.2 });
      hud.say('spare cell. battery ' + Math.round(battery * 100) + '%', 2.4);
    }
  }
  for (const n of level.noteObjs) {
    if (n.taken) continue;
    if (Math.hypot(n.mesh.position.x - player.pos.x, n.mesh.position.z - player.pos.z) < 1.2) {
      n.taken = true; notesRead++;
      hud.say(n.text, 6.5);
      audio.play('static', { vol: 0.16, dur: 0.35, offset: 2 });
    }
  }

  const exd = Math.hypot(level.exitWorld.x - player.pos.x, level.exitWorld.z - player.pos.z);
  signal = Math.max(0, Math.min(1, 1 - exd / (GRID_W * CELL * 0.55)));
  level.exitSign.material.color.setHex(Math.sin(T * 3) > -0.6 ? 0x3bff7a : 0x0d3a1c);
  if (exd < 2.0) finish();

  director(dt);
  glitch = Math.max(0, glitch - dt * 0.35);
  hurt = Math.max(0, hurt - dt * 0.5);

  net.sendInput(player, noise);
  net.update(dt);
  hud.tick(T, battery, signal, glitch);
  hud.setTape(net.code, net.count());
}

boot().catch(e => {
  console.error(e);
  hud.boot.innerHTML = 'TAPE DAMAGED<br><small>' + (e && e.message ? e.message : e) + '</small>';
});

// Headless hooks: a hidden preview tab pauses rAF, so tests step the loop by hand.
window.__nc = () => ({ level, player, entity, net, audio, hud, fx, scene, camera, renderer, T, battery, signal, glitch, hurt, dead, over });
window.__nc.tick = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) advance(dt); return T; };
window.__nc.draw = () => { fx.render(scene, camera, T); return true; };
window.__nc.tp = (cx, cy) => { player.pos.set(wx(cx) + CELL / 2, 0, wz(cy) + CELL / 2); player.falling = false; player.vel.set(0, 0, 0); };
window.__nc.land = () => { player.pos.y = 0; player.falling = false; player.vel.set(0, 0, 0); };
window.__nc.key = (k, v) => { keys[k] = v; };
window.__nc.forceDraw = false;
