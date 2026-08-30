// NOCLIP - the camcorder chrome. Everything the player reads is on the viewfinder,
// there is no game UI outside the tape.

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = $('vf');
    this.rec = $('vf-rec');
    this.time = $('vf-time');
    this.date = $('vf-date');
    this.batBar = $('bat-bar').firstElementChild;
    this.batPct = $('bat-pct');
    this.bat = $('vf-bat');
    this.sig = $('sig-bar').firstElementChild;
    this.mode = $('vf-mode');
    this.warn = $('vf-warn');
    this.sub = $('vf-sub');
    this.cut = $('tapecut');
    this.boot = $('boot');
    this.hint = $('hint');
    this.hint.dataset.controls = this.hint.dataset.controls || this.hint.innerHTML;
    this._audioReady = false;
    this.subT = 0;
    this.startDate = new Date(1996, 5, 12, 3, 41, 0);
  }

  show() { this.el.classList.add('on'); }
  hideBoot(msg) {
    if (msg) this.boot.innerHTML = msg;
    this.boot.classList.add('gone');
    setTimeout(() => this.boot.setAttribute('hidden', ''), 900);
  }
  bootText(s) { this.boot.querySelector('small').textContent = s; }
  hideHint() { this.hint.classList.add('gone'); }

  // The prompt stays up until sound is actually running - a silent tape reads as broken.
  audioReady() {
    if (this._audioReady) return;
    this._audioReady = true;
    this.hint.classList.remove('blocked');
    this.hint.innerHTML = this.hint.dataset.controls || '';
    setTimeout(() => this.hint.classList.add('gone'), 6000);
  }

  setTape(code, players) {
    this.mode.textContent = players > 1 ? `TAPE ${code} · ${players}P` : `TAPE ${code}`;
  }

  tick(t, battery, signal, glitch) {
    const total = Math.floor(t);
    const hh = String(Math.floor(total / 3600)).padStart(2, '0');
    const mm = String(Math.floor(total / 60) % 60).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    const ff = String(Math.floor((t % 1) * 30)).padStart(2, '0');
    this.time.textContent = `${hh}:${mm}:${ss}:${ff}`;
    const d = new Date(this.startDate.getTime() + t * 1000);
    this.date.textContent = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const p = Math.max(0, Math.round(battery * 100));
    this.batBar.style.width = p + '%';
    this.batPct.textContent = p;
    this.bat.classList.toggle('low', battery < 0.22);
    this.sig.style.width = Math.round(signal * 100) + '%';
    this.el.classList.toggle('glitch', glitch > 0.35);
  }

  say(text, secs = 4.5) {
    this.sub.textContent = text;
    this.sub.classList.add('on');
    clearTimeout(this._subTimer);
    this._subTimer = setTimeout(() => this.sub.classList.remove('on'), secs * 1000);
  }

  alert(text) {
    this.warn.textContent = text;
    this.warn.classList.remove('on');
    void this.warn.offsetWidth;
    this.warn.classList.add('on');
  }

  blackout(on) { this.cut.classList.toggle('on', on); }
}
