// NOCLIP - tuning constants and the room-type roster that drives level generation.

export const CELL = 3.4;
export const GRID_W = 78;
export const GRID_H = 78;
export const CHUNK = 6;

export const PLAYER = {
  radius: 0.34,
  eye: 1.63,
  eyeCrouch: 0.95,
  walk: 2.45,
  run: 5.05,
  crouch: 1.25,
  accel: 13.0,
  decel: 15.0,
  gravity: 21.0,
  jump: 5.4,
  stepHeight: 0.34,
  staminaMax: 7.2,
  staminaRegen: 0.62,
  fallFrom: 26.0
};

export const ENTITY = {
  height: 2.55,
  radius: 0.42,
  speedProwl: 3.05,
  speedStalk: 1.55,
  speedHunt: 5.55,
  speedRage: 6.35,
  killDist: 1.35,
  seeDist: 34.0,
  hearRun: 34.0,
  hearWalk: 12.0,
  loseAfter: 9.0,
  repathEvery: 0.42,
  // A 265 m level is far too big for a wandering monster to ever bump into you:
  // measured, it stayed 219 m away for three minutes. So while it is dormant it
  // walks toward the player and then holds at lurkFar, close enough to be heard
  // and glimpsed but not to meet. If nothing happens for patience seconds it
  // closes to lurkNear, so an encounter is inevitable without being immediate.
  // speedProwl MUST beat PLAYER.walk (2.45) or it can never close on someone
  // simply walking away - that alone cost three minutes to first contact - while
  // staying far under PLAYER.run (5.05) so sprinting is still an escape.
  spawnMin: 55.0,
  spawnMax: 105.0,
  lurkFar: 28.0,
  lurkNear: 11.0,
  patience: 90.0
};

export const CAM = {
  fov: 68,
  near: 0.06,
  far: 190
};

// Internal render resolution - a genuine camcorder is a low-res sensor, and this is
// also what keeps a 78x78 grid at 60fps on an Intel MacBook.
export const RES = { w: 512, h: 384 };

export const FOG_BASE = 0.041;

const T = (id, o) => Object.assign({ id }, o);

export const ROOM_TYPES = [
  T('lobby', {
    name: 'LOBBY', h: 2.72, weight: 3,
    fog: 0.028, fogColor: 0x5c5228, ambient: 0x3b3a1c, hemiSky: 0xfff2cc, hemiGround: 0xb4a552, hemiI: 0.85, ambientI: 0.7,
    lightColor: 0xfff6d8, lightI: 1.3, lightRange: 12.5, lightEvery: 1,
    wall: 'wallpaper', floor: 'carpet', ceil: 'tile', gen: 'open'
  }),
  T('halls', {
    name: 'HALLWAYS', h: 2.62, weight: 3,
    fog: 0.034, fogColor: 0x584e26, ambient: 0x36341a, hemiSky: 0xfff0c6, hemiGround: 0xaa9c4c, hemiI: 0.8, ambientI: 0.62,
    lightColor: 0xfff4d0, lightI: 1.34, lightRange: 11.5, lightEvery: 1,
    wall: 'wallpaper', floor: 'carpet', ceil: 'tile', gen: 'maze'
  }),
  T('marked', {
    name: 'THE MARKS', h: 2.62, weight: 2,
    fog: 0.04, fogColor: 0x504722, ambient: 0x322f16, hemiSky: 0xf7e6b6, hemiGround: 0x9d9046, hemiI: 0.72, ambientI: 0.6,
    lightColor: 0xffeec2, lightI: 1.2, lightRange: 10.5, lightEvery: 2,
    wall: 'wallpaper', floor: 'carpet', ceil: 'tile', gen: 'cells', graffiti: true
  }),
  T('office', {
    name: 'ADMIN', h: 2.84, weight: 2,
    fog: 0.036, fogColor: 0x33383c, ambient: 0x24282c, hemiSky: 0xdfeaff, hemiGround: 0x555a5f, hemiI: 0.72, ambientI: 0.72,
    lightColor: 0xdfeaff, lightI: 1.34, lightRange: 12.0, lightEvery: 2,
    wall: 'office', floor: 'vinyl', ceil: 'tile', gen: 'cells', props: 'cabinets'
  }),
  T('pool', {
    name: 'POOLROOMS', h: 4.35, weight: 2,
    fog: 0.026, fogColor: 0x2f5457, ambient: 0x1e3f42, hemiSky: 0xd6f6ff, hemiGround: 0x6f9ea2, hemiI: 0.8, ambientI: 0.8,
    lightColor: 0xcaf4ff, lightI: 1.3, lightRange: 15.0, lightEvery: 2,
    wall: 'tile', floor: 'tile', ceil: 'tile', gen: 'open', water: 0.22
  }),
  T('dark', {
    name: 'NO POWER', h: 2.72, weight: 2,
    fog: 0.09, fogColor: 0x06060a, ambient: 0x70709, hemiSky: 0x0b0e12, hemiGround: 0x0c1014, hemiI: 0.08, ambientI: 0.34,
    lightColor: 0x66ff9a, lightI: 0.5, lightRange: 6.0, lightEvery: 0,
    wall: 'wallpaper', floor: 'carpet', ceil: 'tile', gen: 'maze', blackout: true
  }),
  T('ware', {
    name: 'SUBSTRUCTURE', h: 6.2, weight: 2,
    fog: 0.03, fogColor: 0x23211c, ambient: 0x1d1c18, hemiSky: 0xffd8a0, hemiGround: 0x585047, hemiI: 0.5, ambientI: 0.62,
    lightColor: 0xffd8a0, lightI: 2.7, lightRange: 17.0, lightEvery: 2,
    wall: 'concrete', floor: 'concrete', ceil: 'concrete', gen: 'open', props: 'crates'
  }),
  T('red', {
    name: 'THE RED HALL', h: 2.64, weight: 1,
    fog: 0.054, fogColor: 0x330f0c, ambient: 0x2a0d0a, hemiSky: 0xff8a66, hemiGround: 0x6d2a22, hemiI: 0.52, ambientI: 0.66,
    lightColor: 0xff6a4a, lightI: 1.05, lightRange: 9.0, lightEvery: 2,
    wall: 'red', floor: 'redcarpet', ceil: 'tile', gen: 'cells'
  }),
  T('pipes', {
    name: 'UTILITY', h: 2.42, weight: 2,
    fog: 0.05, fogColor: 0x2f261a, ambient: 0x241d15, hemiSky: 0xffc27a, hemiGround: 0x5f5240, hemiI: 0.5, ambientI: 0.62,
    lightColor: 0xffb15a, lightI: 1.35, lightRange: 8.5, lightEvery: 2,
    wall: 'metal', floor: 'concrete', ceil: 'metal', gen: 'maze', props: 'pipes'
  })
];

export const TYPE_BY_ID = Object.fromEntries(ROOM_TYPES.map(t => [t.id, t]));

// Wall scrawl found in the marked zones - lifted in spirit from the tape, not transcribed.
export const SCRAWL = [
  'TOTAL', 'IT KNOWS', 'NO EXIT', 'DO NOT RUN', 'LEVEL 0',
  'HELP', 'STAY QUIET', 'GO BACK', 'IT IS TALL', '3 DAYS',
  'DONT LOOK', 'WE COUNTED', 'NO DOORS'
];

export const NOTES = [
  'day 4. the lights never turn off. i sleep when the buzzing changes pitch.',
  'the carpet is dry everywhere except where it has been.',
  'i measured the same hallway twice. it was longer the second time.',
  'if you hear yourself walking behind you, keep going. do not turn.',
  'the tall one does not open doors. it does not need to.',
  'battery 30%. i have stopped filming the ceiling.',
  'there is water two levels down and something floats in it.',
  'do not run in the yellow. it hears the carpet.'
];
