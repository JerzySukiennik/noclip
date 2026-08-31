// NOCLIP - the front screen is a room, not an overlay. The camera stands in the
// level looking at a wall; the title and the menu items are physical panels hung
// on that wall, lit by the ceiling, and the whole view drifts with the cursor.

import * as THREE from 'three';
import { CELL } from './config.js?v=ecfbeff1788206466';
import { wx, wz } from './level.js?v=ecfbeff1788206466';

const AMBER = 0xd8c766;

function labelTexture(text, size, weight, colour) {
  const pad = 24;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `${weight} ${size}px "Courier New", Courier, monospace`;
  ctx.font = font;
  const spacing = size * 0.22;
  const w = Math.ceil(ctx.measureText(text).width + spacing * text.length) + pad * 2;
  c.width = Math.max(8, w);
  c.height = Math.ceil(size * 1.7) + pad;
  const g = c.getContext('2d');
  g.font = font;
  g.textBaseline = 'middle';
  g.fillStyle = colour;
  let x = pad;
  const y = c.height / 2;
  for (const ch of text) {           // manual tracking: canvas has no letter-spacing
    g.fillText(ch, x, y);
    x += g.measureText(ch).width + spacing;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { tex: t, aspect: c.width / c.height };
}

export class Menu3D {
  constructor(scene, camera, level, opts) {
    this.scene = scene;
    this.camera = camera;
    this.level = level;
    this.opts = opts || {};
    this.group = new THREE.Group();
    this.buttons = [];
    this.hover = null;
    this.ndc = new THREE.Vector2(0, 0);
    this.aim = new THREE.Vector2(0, 0);
    this.ray = new THREE.Raycaster();
    this.t = 0;
    this.enabled = true;

    const spot = this._findWall();
    this.spot = spot;
    this._build(spot);
    scene.add(this.group);
  }

  // A stretch of wall with enough clear floor in front of it to stand back and read.
  _findWall() {
    const L = this.level;
    const z = L.entryZone;
    const dirs = [
      { dx: 1, dy: 0, ry: -Math.PI / 2, yaw: -Math.PI / 2 },
      { dx: -1, dy: 0, ry: Math.PI / 2, yaw: Math.PI / 2 },
      { dx: 0, dy: 1, ry: Math.PI, yaw: Math.PI },
      { dx: 0, dy: -1, ry: 0, yaw: 0 }
    ];
    let best = null, bestScore = -1;
    for (let cy = z.rect.y + 1; cy < z.rect.y + z.rect.h - 1; cy++) {
      for (let cx = z.rect.x + 1; cx < z.rect.x + z.rect.w - 1; cx++) {
        if (!L.isOpen(cx, cy)) continue;
        for (const d of dirs) {
          if (!L.isSolid(cx + d.dx, cy + d.dy)) continue;
          // wall must run at least three cells wide
          const side = d.dx ? { x: 0, y: 1 } : { x: 1, y: 0 };
          let width = 1;
          for (const s of [-1, 1]) {
            for (let k = 1; k <= 2; k++) {
              const nx = cx + side.x * s * k, ny = cy + side.y * s * k;
              if (L.isOpen(nx, ny) && L.isSolid(nx + d.dx, ny + d.dy)) width++;
              else break;
            }
          }
          // and clear floor behind the camera
          let depth = 0;
          while (depth < 6 && L.isOpen(cx - d.dx * (depth + 1), cy - d.dy * (depth + 1))) depth++;
          if (width < 3 || depth < 2) continue;
          const score = width * 2 + depth;
          if (score > bestScore) {
            bestScore = score;
            best = { cx, cy, ...d, width, depth };
          }
        }
      }
    }
    if (!best) {
      const c = L.spawn;
      best = { cx: c[0], cy: c[1], dx: 0, dy: -1, ry: 0, yaw: 0, width: 3, depth: 3 };
    }
    const wallX = best.dx ? wx(best.cx + (best.dx > 0 ? 1 : 0)) : wx(best.cx) + CELL / 2;
    const wallZ = best.dy ? wz(best.cy + (best.dy > 0 ? 1 : 0)) : wz(best.cy) + CELL / 2;
    const back = Math.min(3.0, 1.1 + best.depth * CELL * 0.40);
    return {
      ...best,
      wall: new THREE.Vector3(wallX, 0, wallZ),
      cam: new THREE.Vector3(wallX - best.dx * back, 1.62, wallZ - best.dy * back),
      back
    };
  }

  _panel(w, h, colour, opacity) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false })
    );
    return m;
  }

  _build(spot) {
    const g = this.group;
    g.position.copy(spot.wall);
    g.rotation.y = spot.ry;

    const items = this.opts.items || [];
    const titleH = 0.66;
    const title = labelTexture('NOCLIP', 150, 'normal', '#fdf8e6');
    const tm = new THREE.Mesh(
      new THREE.PlaneGeometry(titleH * title.aspect, titleH),
      new THREE.MeshBasicMaterial({ map: title.tex, transparent: true, depthWrite: false })
    );
    tm.position.set(0, 2.24, 0.036);
    const titleBack = this._panel(titleH * title.aspect + 0.30, titleH * 0.86, 0x0b0a06, 0.30);
    titleBack.position.set(0, 2.24, 0.033);
    g.add(titleBack);
    g.add(tm);

    const eyebrow = labelTexture('FOUND FOOTAGE  ·  LEVEL 0', 44, 'bold', '#d8c766');
    const em = new THREE.Mesh(
      new THREE.PlaneGeometry(0.115 * eyebrow.aspect, 0.115),
      new THREE.MeshBasicMaterial({ map: eyebrow.tex, transparent: true, depthWrite: false })
    );
    em.position.set(0, 2.53, 0.035);
    g.add(em);

    const rule = this._panel(2.72, 0.007, AMBER, 0.6);
    rule.position.set(0, 1.96, 0.034);
    g.add(rule);

    // the items themselves: a dark plate, a label, and an amber edge that lights up
    const bw = 2.72, bh = 0.30, gap = 0.055;
    const top = 1.74;
    items.forEach((it, i) => {
      const b = new THREE.Group();
      b.position.set(0, top - i * (bh + gap), 0.03);
      const plate = this._panel(bw, bh, 0x0b0a06, 0.74);
      b.add(plate);
      const edge = this._panel(0.016, bh, AMBER, 0.0);
      edge.position.set(-bw / 2 + 0.006, 0, 0.002);
      b.add(edge);
      const lab = labelTexture(it.label.toUpperCase(), 64, 'bold', '#f6f0dc');
      const lh = 0.155;
      const lm = new THREE.Mesh(
        new THREE.PlaneGeometry(lh * lab.aspect, lh),
        new THREE.MeshBasicMaterial({ map: lab.tex, transparent: true, depthWrite: false })
      );
      lm.position.set(-bw / 2 + 0.16 + (lh * lab.aspect) / 2, 0, 0.004);
      b.add(lm);
      g.add(b);
      this.buttons.push({ group: b, plate, edge, label: lm, item: it, hover: 0, baseX: lm.position.x });
    });

    // a bare bulb over the board so the wall reads as lit, not painted
    this.lamp = new THREE.PointLight(0xfff2cf, 0, 6.5, 2);
    this.lamp.position.copy(spot.wall);
    this.lamp.position.y = 2.55;
    this.lamp.position.x -= spot.dx * 1.1;
    this.lamp.position.z -= spot.dy * 1.1;
    this.scene.add(this.lamp);
  }

  setPointer(clientX, clientY) {
    // a zero-size viewport would divide through to NaN and take the camera with it
    const w = innerWidth || 1, h = innerHeight || 1;
    const x = (clientX / w) * 2 - 1, y = -(clientY / h) * 2 + 1;
    if (Number.isFinite(x) && Number.isFinite(y)) this.ndc.set(x, y);
  }

  // Raycast now, from wherever the pointer actually is. Relying on the hover state
  // means a tap does nothing on a touch screen, where there is no move before the
  // press and the aim is still sitting in the middle of the screen.
  pick() {
    if (!this.buttons.length) return null;
    this.camera.updateMatrixWorld(true);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hits = this.ray.intersectObjects(this.buttons.map(b => b.plate), false);
    return hits.length ? this.buttons.find(b => b.plate === hits[0].object) : null;
  }

  click(clientX, clientY) {
    if (!this.enabled) return false;
    if (clientX != null) this.setPointer(clientX, clientY);
    const hit = this.pick();
    if (hit) { this.hover = hit; hit.hover = 1; }
    if (hit && hit.item.action) { hit.item.action(); return true; }
    return false;
  }

  update(dt) {
    if (!this.enabled) return;
    this.t += dt;
    const s = this.spot;

    // Cursor parallax: the camera drifts, so the wall gains real depth against the
    // room behind it rather than sliding like a layer.
    if (!Number.isFinite(this.ndc.x) || !Number.isFinite(this.ndc.y)) this.ndc.set(0, 0);
    this.aim.lerp(this.ndc, Math.min(1, dt * 3.4));
    const sway = Math.sin(this.t * 0.31) * 0.012 + Math.sin(this.t * 0.77) * 0.005;
    const px = this.aim.x * 0.42, py = this.aim.y * 0.22;
    const rightX = -s.dy, rightZ = s.dx;      // along the wall
    this.camera.position.set(
      s.cam.x + rightX * px + s.dx * (py * 0.10),
      s.cam.y + py * 0.16 + Math.sin(this.t * 0.6) * 0.006,
      s.cam.z + rightZ * px + s.dy * (py * 0.10)
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(
      -py * 0.10 - 0.02,
      s.yaw - px * 0.055 + sway,
      sway * 0.35
    );

    this.lamp.intensity = 22 + Math.sin(this.t * 9.3) * Math.sin(this.t * 2.1) * 1.8;

    // hover by raycast, so the buttons are hit as geometry and parallax stays honest
    const hit = this.pick();
    if (hit !== this.hover) {
      this.hover = hit;
      document.body.style.cursor = hit ? 'pointer' : 'auto';
    }
    for (const b of this.buttons) {
      const want = b === this.hover ? 1 : 0;
      b.hover += (want - b.hover) * Math.min(1, dt * 12);
      b.group.position.z = 0.03 + b.hover * 0.028;
      b.plate.material.opacity = 0.74 + b.hover * 0.22;
      b.edge.material.opacity = b.hover;
      b.label.position.x = b.baseX + b.hover * 0.07;
      b.label.material.color.setRGB(1, 1, 1 - b.hover * 0.10);
    }
  }

  dispose() {
    this.enabled = false;
    document.body.style.cursor = 'auto';
    this.scene.remove(this.group);
    this.scene.remove(this.lamp);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}
