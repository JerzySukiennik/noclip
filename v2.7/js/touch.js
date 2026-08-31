// NOCLIP - touch controls. Left thumb walks (push the stick to its edge to run),
// right thumb looks, a small cluster handles the lamp, crouch and glancing back.
// iOS has no pointer lock, so look is a drag, not a delta from a captured cursor.

const CSS = `
/* Not just invisible - GONE. opacity:0 does not stop hit testing, so with the zones
   at pointer-events:auto the pad was swallowing every tap in the menu. */
#tc{position:fixed;inset:0;z-index:6;pointer-events:none;display:none;
  font:600 10px/1 "Courier New",monospace;letter-spacing:.16em;color:rgba(240,236,220,.72);
  opacity:0;transition:opacity .4s}
#tc.on{display:block;opacity:1}
#tc .zone{position:absolute;top:0;bottom:0;pointer-events:auto;touch-action:none}
#tc .zone.left{left:0;width:46%}
#tc .zone.right{right:0;width:54%}
#tc-stick{position:absolute;width:132px;height:132px;border-radius:50%;
  border:1px solid rgba(240,236,220,.20);opacity:0;transition:opacity .18s;
  transform:translate(-50%,-50%);pointer-events:none}
#tc-stick.on{opacity:1}
#tc-knob{position:absolute;left:50%;top:50%;width:52px;height:52px;border-radius:50%;
  background:rgba(240,236,220,.16);border:1px solid rgba(240,236,220,.42);
  transform:translate(-50%,-50%);pointer-events:none}
#tc-stick.run #tc-knob{background:rgba(216,199,102,.30);border-color:rgba(216,199,102,.85)}
#tc-btns{position:absolute;right:calc(14px + env(safe-area-inset-right));
  bottom:calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px;
  pointer-events:none}
#tc-btns button{pointer-events:auto;touch-action:none;
  width:60px;height:44px;border-radius:11px;
  background:rgba(18,17,12,.42);border:1px solid rgba(240,236,220,.26);
  color:inherit;font:inherit;letter-spacing:.14em;
  -webkit-tap-highlight-color:transparent}
#tc-btns button.on{background:rgba(216,199,102,.30);border-color:rgba(216,199,102,.8);color:#fdf8e6}
#tc-rot{position:fixed;inset:0;z-index:11;background:#07070a;display:none;
  align-items:center;justify-content:center;text-align:center;padding:0 32px;
  color:#e6e0cc;font:500 14px/1.7 "Courier New",monospace;letter-spacing:.22em}
#tc-rot.on{display:flex}
`;

export function isTouchDevice() {
  // ?touch=1 / ?touch=0 forces the on-screen pad on or off; desktop browsers cannot
  // emulate a coarse pointer above 768 px wide, so landscape phones are untestable
  // without it.
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
}

export class Touch {
  constructor(opts) {
    const o = opts || {};
    this.sens = o.sens || 0.0042;
    this.onLook = o.onLook || (() => { });
    this.onLamp = o.onLamp || (() => { });
    this.move = { x: 0, y: 0 };
    this.run = false;
    this.crouch = false;
    this.lookBack = false;
    this.enabled = false;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'tc';
    root.innerHTML = `
      <div class="zone left"></div>
      <div class="zone right"></div>
      <div id="tc-stick"><div id="tc-knob"></div></div>
      <div id="tc-btns">
        <button data-a="lamp">LAMP</button>
        <button data-a="crouch">DUCK</button>
        <button data-a="back">BACK</button>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.stick = root.querySelector('#tc-stick');
    this.knob = root.querySelector('#tc-knob');

    const rot = document.createElement('div');
    rot.id = 'tc-rot';
    rot.textContent = 'TURN THE PHONE SIDEWAYS';
    document.body.appendChild(rot);
    this.rot = rot;

    this._bindStick(root.querySelector('.zone.left'));
    this._bindLook(root.querySelector('.zone.right'));
    this._bindButtons(root.querySelector('#tc-btns'));

    addEventListener('resize', () => this._orient());
    addEventListener('orientationchange', () => setTimeout(() => this._orient(), 250));
    this._orient();
  }

  _orient() {
    const portrait = innerHeight > innerWidth * 1.05;
    this.rot.classList.toggle('on', this.enabled && portrait);
  }

  show(on) {
    this.enabled = on;
    this.root.classList.toggle('on', on);
    this._orient();
  }

  _bindStick(zone) {
    const R = 58;
    let id = null, ox = 0, oy = 0;
    const place = (x, y) => {
      this.stick.style.left = x + 'px';
      this.stick.style.top = y + 'px';
    };
    zone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      id = t.identifier; ox = t.clientX; oy = t.clientY;
      place(ox, oy);
      this.stick.classList.add('on');
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        let dx = t.clientX - ox, dy = t.clientY - oy;
        const len = Math.hypot(dx, dy);
        const cl = Math.min(1, len / R);
        if (len > 0.001) { dx = (dx / len) * cl * R; dy = (dy / len) * cl * R; }
        this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        this.move.x = len > 0.001 ? (dx / R) : 0;
        this.move.y = len > 0.001 ? (dy / R) : 0;
        // pushed to the rim means run, so sprinting needs no button
        this.run = cl > 0.86;
        this.stick.classList.toggle('run', this.run);
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        id = null;
        this.move.x = this.move.y = 0;
        this.run = false;
        this.knob.style.transform = 'translate(-50%,-50%)';
        this.stick.classList.remove('on', 'run');
      }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
  }

  _bindLook(zone) {
    let id = null, lx = 0, ly = 0;
    zone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      id = t.identifier; lx = t.clientX; ly = t.clientY;
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        this.onLook((t.clientX - lx) * this.sens, (t.clientY - ly) * this.sens);
        lx = t.clientX; ly = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) id = null;
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
  }

  _bindButtons(host) {
    for (const b of host.querySelectorAll('button')) {
      const act = b.dataset.a;
      const down = (e) => {
        e.preventDefault();
        if (act === 'lamp') { this.lamp = !this.lamp; b.classList.toggle('on', this.lamp); this.onLamp(); }
        if (act === 'crouch') { this.crouch = !this.crouch; b.classList.toggle('on', this.crouch); }
        if (act === 'back') { this.lookBack = true; b.classList.add('on'); }
      };
      const up = (e) => {
        e.preventDefault();
        if (act === 'back') { this.lookBack = false; b.classList.remove('on'); }
      };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
    }
  }

  // Screen axes to the player's forward/strafe pair.
  apply(input) {
    input.f = -this.move.y;
    input.s = this.move.x;
    input.run = this.run;
    input.crouch = this.crouch;
  }
}
