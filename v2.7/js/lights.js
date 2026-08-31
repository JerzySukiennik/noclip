// NOCLIP - a fixed pool of point lights chases whichever ceiling fixtures are
// closest to the camera, so a zone can have hundreds of visible panels for free.

import * as THREE from 'three';

// three r155+ dropped legacy lights: point-light intensity is candela now, so the
// per-zone values in config are relative and get multiplied up here.
export const LIGHT_GAIN = 11;

export class LightPool {
  constructor(scene, count = 10) {
    this.lights = [];
    this.scan = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 12, 2);
      l.visible = false;
      scene.add(l);
      this.lights.push(l);
    }
    this.ambient = new THREE.AmbientLight(0x2b2a13, 0.6);
    scene.add(this.ambient);
    // a ceiling full of panels behaves like a sky: this is what keeps distant
    // walls from falling to black once the point-light pool runs out.
    this.hemi = new THREE.HemisphereLight(0xfff6d8, 0x6a5f28, 0.5);
    scene.add(this.hemi);
    this.hand = new THREE.PointLight(0xfff0d0, 0.0, 11.0, 2);
    scene.add(this.hand);
  }

  update(level, px, py, pz, t) {
    const near = level.nearFixtures(px, pz, 5, this.scan);
    for (const f of near) {
      const dx = f.x - px, dz = f.z - pz;
      f._d = dx * dx + dz * dz;
    }
    near.sort((a, b) => a._d - b._d);
    const n = Math.min(near.length, this.lights.length);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      if (i >= n) { l.visible = false; continue; }
      const f = near[i];
      l.visible = true;
      l.position.set(f.x, f.y - 0.1, f.z);
      l.color.setHex(f.color);
      l.distance = f.range;
      let k = f.intensity * LIGHT_GAIN;
      if (f.flick > 0) {
        const s = Math.sin(t * 47 + f.id) * Math.sin(t * 13.7 + f.id * 3.1);
        k *= s > 0.15 ? 1 : (s > -0.2 ? 0.22 : 0.03);
      }
      l.intensity = k;
    }
  }

  setAmbient(hex, i) { this.ambient.color.setHex(hex); this.ambient.intensity = i; }
  setHemi(sky, ground, i) { this.hemi.color.setHex(sky); this.hemi.groundColor.setHex(ground); this.hemi.intensity = i; }
  setHand(x, y, z, i) { this.hand.position.set(x, y, z); this.hand.intensity = i * LIGHT_GAIN * 0.5; }
}
