// NOCLIP - front screen over the live level, in the layout Jurek built for Hollowtree:
// a brand column with a vertical nav on the left, panels that slide in on the right.

const C = {
  text: '#e6e0cc',
  bright: '#fdf8e6',
  dim: 'rgba(230,224,204,.52)',
  amber: '#d8c766',
  ink: '#131208',
  panel: 'rgba(20,19,13,.72)',
  edge: 'rgba(216,199,102,.16)',
  fail: '#ff7a5c'
};

const CSS = `
.nc-screen{position:fixed;inset:0;z-index:8;color:${C.text};
font:500 14px/1.45 "Courier New",Courier,monospace;-webkit-font-smoothing:antialiased;
opacity:0;transition:opacity .6s cubic-bezier(.22,.61,.36,1)}
.nc-screen.is-on{opacity:1}
.nc-screen.is-gone{pointer-events:none}
.nc-screen input,.nc-screen button{font:inherit;color:inherit}
.nc-screen ::selection{background:rgba(216,199,102,.3)}

.nc-veil{position:absolute;inset:0;background:rgba(10,9,5,.52);
backdrop-filter:blur(9px) saturate(1.02);-webkit-backdrop-filter:blur(9px) saturate(1.02)}
.nc-vignette{position:absolute;inset:0;pointer-events:none;
background:radial-gradient(120% 90% at 60% 46%,transparent 34%,rgba(6,5,2,.72) 100%)}
.nc-grain{position:absolute;inset:0;pointer-events:none;opacity:.55;
background:repeating-linear-gradient(0deg,rgba(255,255,255,.02) 0 1px,transparent 1px 3px)}

.nc-label{font-size:9.5px;letter-spacing:.24em;text-transform:uppercase;color:${C.dim}}

.nc-menu{position:absolute;inset:0;display:flex;align-items:center;
padding:0 clamp(28px,7vw,120px);gap:clamp(28px,4vw,64px)}
.nc-col{width:min(520px,46vw);flex:0 0 auto;display:flex;flex-direction:column;gap:34px}
.nc-brand{display:flex;flex-direction:column;gap:12px}
.nc-eyebrow{font-size:10px;letter-spacing:.38em;text-transform:uppercase;color:${C.amber};opacity:.88}
.nc-title{font-size:clamp(38px,5.4vw,74px);font-weight:400;letter-spacing:.2em;text-transform:uppercase;
line-height:1;text-indent:.2em;white-space:nowrap;color:${C.bright};
background:linear-gradient(168deg,#fffbe9 6%,${C.amber} 94%);-webkit-background-clip:text;background-clip:text;
-webkit-text-fill-color:transparent;text-shadow:0 8px 40px rgba(0,0,0,.5)}
.nc-title-rule{height:1px;width:0;background:linear-gradient(90deg,${C.amber},rgba(216,199,102,0));
transition:width 1.6s cubic-bezier(.22,.61,.36,1) .3s}
.nc-screen.is-on .nc-title-rule{width:100%}
.nc-tagline{font-size:13px;line-height:1.65;color:${C.dim};max-width:48ch}

.nc-nav{display:flex;flex-direction:column;align-items:flex-start;gap:2px;margin-left:-14px}
.nc-nav-item{position:relative;display:flex;align-items:baseline;gap:12px;
padding:11px 14px;background:none;border:0;cursor:pointer;text-align:left;
font-size:15px;letter-spacing:.16em;text-transform:uppercase;color:${C.text};
opacity:0;transform:translateY(9px);
transition:opacity .5s cubic-bezier(.22,.61,.36,1),transform .5s cubic-bezier(.22,.61,.36,1),color .22s ease}
.nc-screen.is-on .nc-nav-item{opacity:.78;transform:none}
.nc-nav-item::before{content:"";position:absolute;left:0;top:50%;width:2px;height:0;
transform:translateY(-50%);background:${C.amber};border-radius:2px;
transition:height .26s cubic-bezier(.22,.61,.36,1),opacity .26s ease;opacity:0}
.nc-nav-item:hover,.nc-nav-item:focus-visible,.nc-nav-item.is-active{opacity:1;color:${C.bright};outline:none}
.nc-nav-item:hover::before,.nc-nav-item:focus-visible::before,.nc-nav-item.is-active::before{height:17px;opacity:1}
.nc-nav-text{transition:transform .26s cubic-bezier(.22,.61,.36,1);display:inline-block}
.nc-nav-item:hover .nc-nav-text,.nc-nav-item:focus-visible .nc-nav-text,
.nc-nav-item.is-active .nc-nav-text{transform:translateX(7px)}
.nc-nav-note{font-size:10.5px;letter-spacing:.06em;text-transform:none;color:${C.dim};
opacity:0;transform:translateX(2px);transition:opacity .3s ease,transform .3s ease}
.nc-nav-item:hover .nc-nav-note,.nc-nav-item:focus-visible .nc-nav-note,
.nc-nav-item.is-active .nc-nav-note{opacity:1;transform:translateX(7px)}

.nc-sound{position:absolute;left:50%;bottom:calc(30px + env(safe-area-inset-bottom));
transform:translateX(-50%);display:none;align-items:center;gap:10px;cursor:pointer;
padding:11px 18px;border-radius:10px;background:rgba(216,199,102,.14);
border:1px solid rgba(216,199,102,.5);color:#fdf8e6;
font-size:11px;letter-spacing:.2em;text-transform:uppercase;
animation:ncpulse 2.4s ease-in-out infinite}
.nc-sound.on{display:flex}
@keyframes ncpulse{0%,100%{opacity:.7}50%{opacity:1}}
.nc-foot{position:absolute;left:clamp(28px,7vw,120px);bottom:34px;display:flex;gap:22px;align-items:center;
font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${C.dim};
opacity:0;transition:opacity .8s ease .7s}
.nc-screen.is-on .nc-foot{opacity:1}

.nc-panels{display:grid;align-items:center;justify-items:start}
.nc-panel{grid-area:1/1;position:relative;width:min(430px,44vw);padding:26px 28px 28px;border-radius:14px;
max-height:78vh;overflow-y:auto;scrollbar-width:thin;
background:${C.panel};border:1px solid ${C.edge};
box-shadow:0 30px 70px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.05);
backdrop-filter:blur(16px) saturate(1.08);-webkit-backdrop-filter:blur(16px) saturate(1.08);
display:flex;flex-direction:column;gap:20px;
opacity:0;transform:translateX(16px) scale(.985);pointer-events:none;
transition:opacity .34s cubic-bezier(.22,.61,.36,1),transform .34s cubic-bezier(.22,.61,.36,1)}
.nc-panel.is-on{opacity:1;transform:none;pointer-events:auto}
.nc-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.nc-panel-title{font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:${C.bright}}
.nc-panel-body{display:flex;flex-direction:column;gap:18px}

.nc-field{display:flex;flex-direction:column;gap:9px}
.nc-field-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.nc-field-value{font-size:11px;letter-spacing:.08em;color:${C.text};opacity:.8}
.nc-note{font-size:10.5px;line-height:1.55;color:${C.dim}}

.nc-btn{padding:9px 16px;border-radius:9px;cursor:pointer;
background:${C.amber};border:1px solid ${C.amber};color:${C.ink};
font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:700;
transition:transform .2s ease,filter .2s ease}
.nc-btn:hover{transform:translateY(-1px);filter:brightness(1.08)}
.nc-btn.is-ghost{background:none;color:${C.dim};border-color:rgba(255,255,255,.14);font-weight:500}
.nc-btn.is-ghost:hover{color:${C.text};border-color:rgba(255,255,255,.26)}
.nc-btn-row{display:flex;gap:10px;flex-wrap:wrap}

.nc-input{width:100%;padding:11px 13px;border-radius:9px;
background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
letter-spacing:.1em;outline:none;transition:border-color .2s ease}
.nc-input:focus{border-color:${C.amber}}
.nc-input.is-bad{border-color:${C.fail}}
.nc-code{text-align:center;font-size:26px;letter-spacing:.42em;text-indent:.42em;text-transform:uppercase}

.nc-range{-webkit-appearance:none;appearance:none;width:100%;height:3px;border-radius:3px;outline:none;
background:linear-gradient(90deg,${C.amber} var(--p,50%),rgba(255,255,255,.14) var(--p,50%))}
.nc-range::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;
background:${C.bright};cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.5)}
.nc-range::-moz-range-thumb{width:13px;height:13px;border:0;border-radius:50%;background:${C.bright};cursor:pointer}

.nc-chips{display:flex;flex-wrap:wrap;gap:8px}
.nc-chip{padding:7px 13px;border-radius:9px;cursor:pointer;
background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);
font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:${C.dim};
transition:color .22s ease,border-color .22s ease,background .22s ease,transform .22s ease}
.nc-chip:hover{color:${C.text};border-color:rgba(255,255,255,.2);transform:translateY(-1px)}
.nc-chip.is-on{color:${C.ink};background:${C.amber};border-color:${C.amber};font-weight:700}

.nc-keys{display:grid;grid-template-columns:auto 1fr;gap:9px 16px;font-size:11.5px}
.nc-keys b{font-weight:700;color:${C.bright};letter-spacing:.1em}
.nc-keys span{color:${C.dim}}

@media (max-width:820px){
  .nc-menu{flex-direction:column;align-items:flex-start;justify-content:center;gap:22px;
    padding:0 calc(24px + env(safe-area-inset-left))}
  .nc-col{width:100%}
  /* the panel stops being a column and becomes an overlay, or it pushes the
     title clean off the top of a phone held upright */
  /* grid, not flex: every panel shares one cell so they stack instead of
     laying out in a row and spilling off the sides */
  .nc-panels{position:absolute;inset:0;display:grid;place-items:center;
    padding:calc(18px + env(safe-area-inset-top)) 18px calc(18px + env(safe-area-inset-bottom));
    pointer-events:none}
  .nc-panel{width:min(430px,88vw);max-height:100%}
  .nc-foot{left:calc(24px + env(safe-area-inset-left));bottom:calc(20px + env(safe-area-inset-bottom))}
}
/* A phone held sideways has ~375 px of height: the panel has to be able to scroll
   and everything else has to give up room for it. */
@media (max-height:460px){
  .nc-menu{flex-direction:row;align-items:center;gap:18px;padding:0 calc(20px + env(safe-area-inset-left))}
  .nc-panels{position:static;padding:0;pointer-events:auto}
  .nc-col{width:min(400px,50vw);gap:14px}
  .nc-brand{gap:6px}
  .nc-title{font-size:clamp(26px,5vw,38px)}
  .nc-tagline{display:none}
  .nc-nav{gap:0}
  .nc-nav-item{padding:7px 14px;font-size:13px}
  .nc-nav-note{display:none}
  .nc-panel{max-height:88vh;padding:16px 18px 18px;gap:14px;width:min(400px,46vw)}
  .nc-panel-body{gap:13px}
  .nc-foot{display:none}
}
@media (pointer: coarse){
  .nc-nav-item{padding:13px 14px}
  .nc-btn{padding:12px 18px}
  .nc-range{height:6px}
  .nc-range::-webkit-slider-thumb{width:22px;height:22px}
  .nc-chip{padding:10px 15px}
  .nc-input{padding:14px 13px}
}
`;

function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

const STORE = 'noclip-settings';
const readStore = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { return {}; } };
const writeStore = (d) => { try { localStorage.setItem(STORE, JSON.stringify(d)); } catch (e) { } };

const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const DEFAULTS = { master: 0.9, music: 0.5, sens: 0.0022, quality: coarse ? 'low' : 'med' };

export function createMenu(opts) {
  const cfg = opts || {};
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const stored = readStore();
  const settings = {
    master: typeof stored.master === 'number' ? stored.master : DEFAULTS.master,
    music: typeof stored.music === 'number' ? stored.music : DEFAULTS.music,
    sens: typeof stored.sens === 'number' ? stored.sens : DEFAULTS.sens,
    quality: stored.quality || DEFAULTS.quality
  };
  const persist = () => { writeStore(settings); if (cfg.onSettings) cfg.onSettings(settings); };

  const root = el('div', 'nc-screen', document.body);
  el('div', 'nc-veil', root);
  el('div', 'nc-vignette', root);
  el('div', 'nc-grain', root);

  const layout = el('div', 'nc-menu', root);
  const col = el('div', 'nc-col', layout);
  const brand = el('div', 'nc-brand', col);
  el('div', 'nc-eyebrow', brand, 'found footage · level 0');
  el('h1', 'nc-title', brand, 'Noclip');
  el('div', 'nc-title-rule', brand);
  el('div', 'nc-tagline', brand,
    'You noclipped out of reality. Nine hundred million square miles of damp carpet, '
    + 'buzzing fluorescent light and the faint hum of something walking somewhere else.');

  const nav = el('nav', 'nc-nav', col);
  const panels = el('div', 'nc-panels', layout);
  const foot = el('div', 'nc-foot', root);
  el('div', null, foot, cfg.footer || 'gzowo.fun');


  let openPanel = null, openedFrom = null;
  const items = [];

  function showPanel(next) {
    if (openPanel && openPanel !== next) openPanel.classList.remove('is-on');
    if (openPanel && openPanel === next) return;
    openPanel = next || null;
    for (const it of items) it.button.classList.toggle('is-active', Boolean(openPanel) && it.panel === openPanel);
    if (!openPanel) return;
    openPanel.classList.add('is-on');
    const f = openPanel.querySelector('input,button');
    if (f) f.focus({ preventScroll: true });
  }

  function closePanel() {
    if (!openPanel) return;
    openPanel.classList.remove('is-on');
    openPanel = null;
    for (const it of items) it.button.classList.remove('is-active');
    if (openedFrom && document.body.contains(openedFrom)) openedFrom.focus({ preventScroll: true });
    openedFrom = null;
  }

  const setPanel = (next) => (!next || openPanel === next) ? closePanel() : showPanel(next);

  function navItem(label, note, panel, action) {
    const b = el('button', 'nc-nav-item', nav);
    b.type = 'button';
    el('span', 'nc-nav-text', b, label);
    if (note) el('span', 'nc-nav-note', b, note);
    b.style.transitionDelay = `${(items.length * 0.07).toFixed(3)}s`;
    b.addEventListener('click', () => {
      if (panel) { if (openPanel !== panel) openedFrom = b; setPanel(panel); }
      else if (action) action();
    });
    items.push({ button: b, panel });
    return b;
  }

  function panel(title) {
    const node = el('div', 'nc-panel', panels);
    const head = el('div', 'nc-panel-head', node);
    el('div', 'nc-panel-title', head, title);
    const back = el('button', 'nc-btn is-ghost', head);
    back.type = 'button';
    back.textContent = 'Back';
    back.style.padding = '7px 13px';
    back.addEventListener('click', (e) => { e.preventDefault(); closePanel(); });
    return { node, body: el('div', 'nc-panel-body', node) };
  }

  function field(parent, label, note) {
    const wrap = el('div', 'nc-field', parent);
    const head = el('div', 'nc-field-head', wrap);
    el('div', 'nc-label', head, label);
    const value = el('div', 'nc-field-value', head);
    const body = el('div', null, wrap);
    if (note) el('div', 'nc-note', wrap, note);
    return { wrap, value, body };
  }

  function slider(parent, label, note, initial, format, onInput) {
    const f = field(parent, label, note);
    const r = el('input', 'nc-range', f.body);
    r.type = 'range'; r.min = '0'; r.max = '1'; r.step = '0.001';
    r.value = String(initial);
    const paint = () => r.style.setProperty('--p', `${(Number(r.value) * 100).toFixed(1)}%`);
    paint();
    f.value.textContent = format(initial);
    r.addEventListener('input', () => {
      paint();
      f.value.textContent = format(Number(r.value));
      onInput(Number(r.value));
    });
    return r;
  }

  /* ------------------------------------------------------------- routes -- */

  let started = false;
  function launch(route, code) {
    if (started) return;
    started = true;
    root.classList.remove('is-on');
    root.classList.add('is-gone');
    setTimeout(() => root.style.display = 'none', 700);
    if (cfg.onStart) cfg.onStart(route, code);
  }

  const joinPanel = panel('Join a tape');
  el('div', 'nc-note', joinPanel.body,
    'Every tape has a four-character code. Type someone else’s and you fall into their level, '
    + 'in the same rooms, with the same thing walking around in it.');
  const codeInput = el('input', 'nc-input nc-code', joinPanel.body);
  codeInput.type = 'text'; codeInput.maxLength = 4;
  codeInput.placeholder = '————';
  codeInput.autocomplete = 'off'; codeInput.spellcheck = false;
  const codeErr = el('div', 'nc-note', joinPanel.body, '');
  codeErr.style.color = C.fail; codeErr.style.opacity = '0';
  const joinRow = el('div', 'nc-btn-row', joinPanel.body);
  const joinBtn = el('button', 'nc-btn', joinRow);
  joinBtn.type = 'button'; joinBtn.textContent = 'Fall in';

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    codeInput.classList.remove('is-bad');
    codeErr.style.opacity = '0';
  });
  codeInput.addEventListener('keydown', (e) => { if (e.code === 'Enter') joinBtn.click(); });
  joinBtn.addEventListener('click', () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      codeInput.classList.add('is-bad');
      codeErr.textContent = 'Four letters or digits.';
      codeErr.style.opacity = '1';
      codeInput.focus();
      return;
    }
    launch('join', code);
  });

  const setPanelUI = panel('Settings');
  slider(setPanelUI.body, 'Master volume', null, settings.master,
    (t) => `${Math.round(t * 100)}%`, (t) => { settings.master = t; persist(); });
  slider(setPanelUI.body, 'Music', 'The chase cuts the music dead either way.', settings.music,
    (t) => `${Math.round(t * 100)}%`, (t) => { settings.music = t; persist(); });
  const sensToT = (s) => (Math.log(s) - Math.log(0.0006)) / (Math.log(0.006) - Math.log(0.0006));
  const tToSens = (t) => Math.exp(Math.log(0.0006) + t * (Math.log(0.006) - Math.log(0.0006)));
  slider(setPanelUI.body, 'Mouse sensitivity', null, sensToT(settings.sens),
    (t) => tToSens(t).toFixed(4), (t) => { settings.sens = tToSens(t); persist(); });

  const qField = field(setPanelUI.body, 'Render quality', 'The tape is meant to look worn. Lower is grainier and faster.');
  const chips = el('div', 'nc-chips', qField.body);
  const QUALITIES = [{ id: 'low', name: 'Worn' }, { id: 'med', name: 'Standard' }, { id: 'high', name: 'Clean' }];
  const chipNodes = [];
  for (const q of QUALITIES) {
    const b = el('button', 'nc-chip', chips, q.name);
    b.type = 'button';
    b.addEventListener('click', () => { settings.quality = q.id; paintChips(); persist(); });
    chipNodes.push({ b, q });
  }
  const paintChips = () => chipNodes.forEach(c => c.b.classList.toggle('is-on', c.q.id === settings.quality));
  paintChips();
  qField.value.textContent = '';

  const ctrlPanel = panel('Controls');
  const keys = el('div', 'nc-keys', ctrlPanel.body);
  const coarsePad = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const rows = coarsePad ? [
    ['LEFT', 'drag to walk'], ['LEFT · edge', 'push to the rim to run — it hears you'],
    ['RIGHT', 'drag to look'], ['DUCK', 'crouch — it hears you less'],
    ['LAMP', 'camcorder lamp'], ['BACK', 'hold to glance behind you']
  ] : [
    ['WASD', 'walk'], ['SHIFT', 'run — it hears you'], ['C', 'crouch — it hears you less'],
    ['SPACE', 'jump'], ['Q', 'look behind you'], ['F', 'camcorder lamp'],
    ['T', 'copy this tape’s link'], ['ESC', 'release the mouse']
  ];
  for (const [k, v] of rows) { el('b', null, keys, k); el('span', null, keys, v); }
  el('div', 'nc-note', ctrlPanel.body,
    'The signal bar on the viewfinder rises as you get closer to the way out. '
    + 'Battery runs the lamp; spare cells are lying around.');

  const hosting = cfg.tape ? `tape ${cfg.tape}` : 'a new level';
  navItem('Enter the tape', hosting, null, () => launch('solo'));
  navItem('Play together', 'others can fall in with your code', null, () => launch('host'));
  navItem('Join a tape', 'you need a four-character code', joinPanel.node);
  navItem('Settings', 'audio, mouse, quality', setPanelUI.node);
  navItem('Controls', 'what the keys do', ctrlPanel.node);

  // Browsers will not start audio without a gesture, and the only gesture in this
  // menu used to be the one that leaves it - so the menu track was never heard.
  const soundBtn = el('button', 'nc-sound', root, 'Click for sound');
  soundBtn.type = 'button';
  const audioLive = () => { try { return cfg.audioState && cfg.audioState() === 'running'; } catch (e) { return true; } };
  const pollSound = () => {
    if (started) return;
    soundBtn.classList.toggle('on', !audioLive());
    setTimeout(pollSound, 400);
  };
  soundBtn.addEventListener('click', () => {
    if (cfg.onEnableSound) cfg.onEnableSound();
    soundBtn.classList.remove('on');
  });
  pollSound();

  window.addEventListener('keydown', (e) => {
    if (started) return;
    if (e.code === 'Escape') closePanel();
    if (e.code === 'Enter' && !openPanel) launch('solo');
  });

  requestAnimationFrame(() => root.classList.add('is-on'));
  setTimeout(() => root.classList.add('is-on'), 60);

  return {
    root,
    settings,
    close: () => launch('solo'),
    isOpen: () => !started
  };
}
