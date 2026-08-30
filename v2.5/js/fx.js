// NOCLIP - the tape. Scene renders into a 512x384 target, a cheap bright-pass bloom
// blooms the ceiling panels, and one composite pass does barrel warp, chroma bleed,
// tracking error, dropout, scanlines and grain on the way to the screen.

import * as THREE from 'three';
import { RES } from './config.js?v=460d7d81788112101';
import { noiseTexture } from './tex.js?v=460d7d81788112101';

const VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BRIGHT = `
precision mediump float;
uniform sampler2D tSrc; uniform float uThresh;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThresh, uThresh + 0.45, l);
  gl_FragColor = vec4(c * k, 1.0);
}
`;

const BLUR = `
precision mediump float;
uniform sampler2D tSrc; uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 s = texture2D(tSrc, vUv).rgb * 0.2270270270;
  s += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  s += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}
`;

const COMPOSITE = `
precision mediump float;
uniform sampler2D tSrc, tBloom, tNoise;
uniform vec2 uRes;
uniform vec2 uOut;
uniform float uTime, uHurt, uTrack, uGlitch, uBattery, uFade, uSat, uBloom;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

void main(){
  vec2 uv = vUv;

  // lens: barrel, growing with damage
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  float k = 0.10 + uHurt * 0.26;
  uv = 0.5 + c * (1.0 + k * r2);

  // tape tracking: rows shear, worst while the signal is bad
  float band = floor(uv.y * 190.0);
  float noiseRow = hash(vec2(band, floor(uTime * 13.0)));
  float shear = (noiseRow - 0.5) * 0.0012 * (0.35 + uTrack * 2.2);
  float sweep = fract(uTime * 0.28);
  float nearSweep = smoothstep(0.055, 0.0, abs(uv.y - sweep));
  shear += nearSweep * (hash(vec2(band, 7.0)) - 0.5) * 0.013 * (0.25 + uTrack);
  shear += uGlitch * (hash(vec2(band, floor(uTime * 40.0))) - 0.5) * 0.09;
  uv.x += shear;

  if (uv.x < -0.02 || uv.x > 1.02 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }
  uv = clamp(uv, 0.001, 0.999);

  // --- scene-referred work (tone-mapped linear) --------------------------
  float ca = (0.0012 + r2 * 0.0045) * (1.0 + uHurt * 2.2 + uTrack * 1.2);
  vec3 col = vec3(
    texture2D(tSrc, uv + vec2(ca, 0.0)).r,
    texture2D(tSrc, uv).g,
    texture2D(tSrc, uv - vec2(ca * 1.35, 0.0)).b);

  vec3 smear = texture2D(tSrc, uv - vec2(0.0035, 0.0)).rgb;
  col = mix(col, mix(col, smear, 0.5), 0.26);
  col += texture2D(tBloom, uv).rgb * uBloom;
  col *= vec3(1.03, 1.00, 0.90);

  float vig = smoothstep(1.30, 0.06, r2 * 1.6);
  col *= mix(0.46, 1.0, vig);

  // --- display-referred: encode, then add the tape artefacts -------------
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));

  col = col * 0.94 + 0.028;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, uSat);

  col *= 0.945 + 0.055 * sin(uv.y * uRes.y * 3.14159);
  col *= 0.982 + 0.018 * sin(uv.y * uRes.y * 1.5708 + uTime * 12.0);

  // One noise texel per OUTPUT pixel. Sampling a scaled-down lookup gives soft,
  // smeared blobs; tape grain is crisp and per-pixel.
  vec2 gcoord = (uv * uOut + vec2(fract(uTime * 61.0) * 251.0, fract(uTime * 37.0) * 199.0)) / 256.0;
  vec3 n = texture2D(tNoise, gcoord).rgb;
  col += (n - 0.5) * (0.050 + uHurt * 0.085 + (1.0 - uBattery) * 0.035);

  float d = hash(vec2(floor(uv.y * 240.0), floor(uTime * 9.0)));
  if (d > 0.9975 - uGlitch * 0.02) col += vec3(0.42, 0.42, 0.38);
  if (d < 0.0012 + uGlitch * 0.01) col *= 0.15;

  if (uv.y > 0.982) {
    float hs = hash(vec2(floor(uv.x * 160.0), floor(uTime * 24.0)));
    col = mix(col, vec3(hs * 0.85), 0.75);
  }

  gl_FragColor = vec4(col * uFade, 1.0);
}
`;

export class FX {
  constructor(renderer) {
    this.renderer = renderer;
    const opt = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false };
    this.rt = new THREE.WebGLRenderTarget(RES.w, RES.h, opt);
    const hw = Math.floor(RES.w / 2), hh = Math.floor(RES.h / 2);
    this.rtA = new THREE.WebGLRenderTarget(hw, hh, { ...opt, depthBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(hw, hh, { ...opt, depthBuffer: false });

    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.qscene = new THREE.Scene();
    this.qscene.add(this.quad);

    this.mBright = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BRIGHT, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: this.rt.texture }, uThresh: { value: 1.05 } }
    });
    this.mBlur = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }
    });
    this.mComp = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false,
      uniforms: {
        tSrc: { value: this.rt.texture },
        tBloom: { value: this.rtB.texture },
        tNoise: { value: noiseTexture(256) },
        uRes: { value: new THREE.Vector2(RES.w, RES.h) },
        uOut: { value: new THREE.Vector2(RES.w, RES.h) },
        uTime: { value: 0 }, uHurt: { value: 0 }, uTrack: { value: 0.12 },
        uGlitch: { value: 0 }, uBattery: { value: 1 }, uFade: { value: 1 },
        uSat: { value: 0.78 }, uBloom: { value: 0.62 }
      }
    });
  }

  // The internal resolution IS the camcorder sensor, so the quality setting moves it.
  // the grain pass needs the size it is actually drawing to, not the scene target
  setOutputSize(w, h) { this.mComp.uniforms.uOut.value.set(w, h); }

  setResolution(w, h) {
    if (this.rt.width === w && this.rt.height === h) return;
    this.rt.setSize(w, h);
    this.rtA.setSize(Math.floor(w / 2), Math.floor(h / 2));
    this.rtB.setSize(Math.floor(w / 2), Math.floor(h / 2));
    this.mComp.uniforms.uRes.value.set(w, h);
  }

  render(scene, camera, t) {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, camera);

    this.quad.material = this.mBright;
    this.mBright.uniforms.tSrc.value = this.rt.texture;
    r.setRenderTarget(this.rtA);
    r.render(this.qscene, this.cam);

    this.quad.material = this.mBlur;
    const hw = this.rtA.width, hh = this.rtA.height;
    this.mBlur.uniforms.tSrc.value = this.rtA.texture;
    this.mBlur.uniforms.uDir.value.set(1 / hw, 0);
    r.setRenderTarget(this.rtB);
    r.render(this.qscene, this.cam);
    this.mBlur.uniforms.tSrc.value = this.rtB.texture;
    this.mBlur.uniforms.uDir.value.set(0, 1 / hh);
    r.setRenderTarget(this.rtA);
    r.render(this.qscene, this.cam);
    this.mBlur.uniforms.tSrc.value = this.rtA.texture;
    this.mBlur.uniforms.uDir.value.set(1.8 / hw, 0);
    r.setRenderTarget(this.rtB);
    r.render(this.qscene, this.cam);

    this.quad.material = this.mComp;
    this.mComp.uniforms.uTime.value = t;
    this.mComp.uniforms.tBloom.value = this.rtB.texture;
    r.setRenderTarget(null);
    r.render(this.qscene, this.cam);
  }

  u(name, v) { this.mComp.uniforms[name].value = v; }
}
