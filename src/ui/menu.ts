import { DEFAULTS, S, updateSetting, type Settings } from '../game/settings';
import { STADIUM_NAMES, type StadiumId } from '../entities/environments';
import { SFX } from '../audio/sfx';

export type MenuPanel = 'hidden' | 'main' | 'pause' | 'settings' | 'mp';

export interface MenuCallbacks {
  onStart(mode: 'match' | 'practice'): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onMpHost(): void;
  onMpJoin(code: string): void;
  onMpCancel(): void;
}

/**
 * DOM menus: main menu (game type + settings), pause menu, and a shared
 * settings panel that returns to whichever menu opened it.
 */
// preset palette cycled by left/right on a focused color input
const COLOR_PALETTE = ['#2fa3ff', '#ff8a2a', '#22d67c', '#ff2d6a', '#ffd24d', '#a86bff', '#ffffff', '#ff5533'];

export class Menu {
  panel: MenuPanel = 'hidden';
  /** Set while an online match is live: pause panel becomes a non-pausing menu. */
  online = false;
  private root = document.getElementById('menuRoot')!;
  private returnTo: 'main' | 'pause' = 'main';
  private focusables: HTMLElement[] = [];
  private focusIndex = 0;

  constructor(private cb: MenuCallbacks) {}

  show(panel: Exclude<MenuPanel, 'hidden'>) {
    this.panel = panel;
    this.root.classList.add('show');
    if (panel === 'main') this.renderMain();
    else if (panel === 'pause') this.renderPause();
    else if (panel === 'mp') this.renderMp();
    else this.renderSettings();
    this.collectFocusables();
  }

  hide() {
    this.panel = 'hidden';
    this.root.classList.remove('show');
    this.root.innerHTML = '';
    this.focusables = [];
  }

  // ---------- gamepad / keyboard navigation ----------

  private collectFocusables() {
    this.focusables = [...this.root.querySelectorAll<HTMLElement>('button, select, input')];
    this.focusIndex = 0;
    this.applyFocus();
  }

  private applyFocus() {
    this.focusables.forEach((el, i) => el.classList.toggle('gpfocus', i === this.focusIndex));
    this.focusables[this.focusIndex]?.scrollIntoView({ block: 'nearest' });
  }

  private focused(): HTMLElement | undefined {
    return this.focusables[this.focusIndex];
  }

  navigate(dir: 'up' | 'down' | 'left' | 'right') {
    const n = this.focusables.length;
    if (!n) return;
    if (dir === 'up' || dir === 'down') {
      this.focusIndex = (this.focusIndex + (dir === 'down' ? 1 : -1) + n) % n;
      this.applyFocus();
    } else {
      this.adjust(dir === 'right' ? 1 : -1);
    }
  }

  /** Enter / Cross: activate the focused element. */
  activate() {
    const el = this.focused();
    if (!el) return;
    if (el instanceof HTMLButtonElement) el.click();
    else this.adjust(1);
  }

  /** Left/right on a focused control: step selects & sliders, toggle checkboxes, cycle colors. */
  private adjust(delta: number) {
    const el = this.focused();
    if (!el) return;
    if (el instanceof HTMLSelectElement) {
      const n = el.options.length;
      el.selectedIndex = (el.selectedIndex + delta + n) % n;
      el.dispatchEvent(new Event('change'));
    } else if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') {
        el.checked = !el.checked;
        el.dispatchEvent(new Event('change'));
      } else if (el.type === 'range') {
        el.value = String(Number(el.value) + delta * 2);
        el.dispatchEvent(new Event('input'));
      } else if (el.type === 'color') {
        const i = COLOR_PALETTE.indexOf(el.value.toLowerCase());
        const next = COLOR_PALETTE[(i + delta + COLOR_PALETTE.length) % COLOR_PALETTE.length];
        el.value = next;
        el.dispatchEvent(new Event('input'));
      }
    }
  }

  /** Esc inside menus: settings -> parent menu; pause -> resume; mp -> main. */
  back() {
    if (this.panel === 'settings') this.show(this.returnTo);
    else if (this.panel === 'pause') this.cb.onResume();
    else if (this.panel === 'mp') {
      this.cb.onMpCancel();
      this.show('main');
    }
  }

  private btn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `btn ${cls}`;
    b.textContent = label;
    b.addEventListener('click', () => {
      SFX.click();
      onClick();
    });
    return b;
  }

  private box(): HTMLDivElement {
    this.root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'panelBox';
    this.root.appendChild(box);
    return box;
  }

  private renderMain() {
    this.returnTo = 'main';
    const box = this.box();
    box.innerHTML = `<div class="menuTitle">ROCKET ARENA</div><div class="menuSub">CAR SOCCER · VS BOT OR ONLINE 1v1</div>`;
    box.appendChild(this.btn('PLAY MATCH', 'primary', () => this.cb.onStart('match')));
    box.appendChild(this.btn('MULTIPLAYER 1v1', '', () => this.show('mp')));
    box.appendChild(this.btn('SOLO PRACTICE', '', () => this.cb.onStart('practice')));
    box.appendChild(this.btn('SETTINGS', '', () => this.show('settings')));
    const hint = document.createElement('div');
    hint.className = 'menuHint';
    hint.innerHTML = 'Keyboard: WASD · Space jump · Shift boost · Ctrl slide<br>Gamepad (RL layout): ✕ jump · ◯ boost · ▢ powerslide / air roll · △ ball-cam · R2 gas · Start pause<br>Menus: D-pad / stick / arrows navigate · ✕ or Enter select · ◯ or Esc back · ◀▶ adjust values';
    box.appendChild(hint);
  }

  private renderPause() {
    this.returnTo = 'pause';
    const box = this.box();
    if (this.online) {
      box.innerHTML = `<div class="sectionTitle">MENU</div><div class="menuSub">ONLINE MATCH — GAME KEEPS RUNNING</div>`;
      box.appendChild(this.btn('BACK TO GAME', 'primary', () => this.cb.onResume()));
      box.appendChild(this.btn('SETTINGS', '', () => this.show('settings')));
      box.appendChild(this.btn('LEAVE MATCH', '', () => this.cb.onQuit()));
      return;
    }
    box.innerHTML = `<div class="sectionTitle">PAUSED</div>`;
    box.appendChild(this.btn('RESUME', 'primary', () => this.cb.onResume()));
    box.appendChild(this.btn('SETTINGS', '', () => this.show('settings')));
    box.appendChild(this.btn('RESTART', '', () => this.cb.onRestart()));
    box.appendChild(this.btn('QUIT TO MENU', '', () => this.cb.onQuit()));
  }

  // ---------- multiplayer ----------

  private renderMp() {
    const box = this.box();
    box.innerHTML = `<div class="sectionTitle">MULTIPLAYER 1v1</div><div class="menuSub">PEER-TO-PEER — SHARE A CODE OR LINK</div>`;
    box.appendChild(this.btn('HOST MATCH', 'primary', () => this.cb.onMpHost()));

    const joinRow = document.createElement('div');
    joinRow.className = 'mpJoinRow';
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.className = 'mpCodeInput';
    codeInput.placeholder = 'ROOM CODE';
    codeInput.maxLength = 8;
    codeInput.autocapitalize = 'characters';
    codeInput.spellcheck = false;
    // keep game key handlers out of the text field; Enter joins directly
    codeInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && codeInput.value.trim()) this.cb.onMpJoin(codeInput.value);
    });
    codeInput.addEventListener('keyup', (e) => e.stopPropagation());
    const joinBtn = this.btn('JOIN', '', () => {
      if (codeInput.value.trim()) this.cb.onMpJoin(codeInput.value);
    });
    joinBtn.style.margin = '0';
    joinRow.appendChild(codeInput);
    joinRow.appendChild(joinBtn);
    box.appendChild(joinRow);

    box.appendChild(this.btn('BACK', '', () => this.show('main')));
    const hint = document.createElement('div');
    hint.className = 'menuHint';
    hint.textContent = 'Host is BLUE, guest is ORANGE. Match length uses the host’s setting.';
    box.appendChild(hint);
  }

  /** Host is waiting: show the room code and a copyable invite link. */
  showMpHosting(code: string) {
    this.panel = 'mp';
    this.root.classList.add('show');
    const box = this.box();
    const link = `${location.origin}${location.pathname}?join=${code}`;
    box.innerHTML = `
      <div class="sectionTitle">HOSTING</div>
      <div class="menuSub">SEND THIS CODE OR LINK TO YOUR OPPONENT</div>
      <div class="mpCode">${code}</div>
      <div class="mpLink">${link}</div>
      <div class="menuSub mpWaiting">WAITING FOR OPPONENT…</div>`;
    box.appendChild(this.btn('COPY LINK', 'primary', () => {
      navigator.clipboard?.writeText(link).catch(() => { /* clipboard unavailable */ });
    }));
    box.appendChild(this.btn('CANCEL', '', () => {
      this.cb.onMpCancel();
      this.show('mp');
    }));
    this.collectFocusables();
  }

  /** Guest: connecting spinner state. */
  showMpConnecting(code: string) {
    this.panel = 'mp';
    this.root.classList.add('show');
    const box = this.box();
    box.innerHTML = `<div class="sectionTitle">JOINING ${code}</div><div class="menuSub mpWaiting">CONNECTING…</div>`;
    box.appendChild(this.btn('CANCEL', '', () => {
      this.cb.onMpCancel();
      this.show('mp');
    }));
    this.collectFocusables();
  }

  showMpError(text: string) {
    this.panel = 'mp';
    this.root.classList.add('show');
    const box = this.box();
    box.innerHTML = `<div class="sectionTitle">MULTIPLAYER</div><div class="mpError">${text}</div>`;
    box.appendChild(this.btn('BACK', 'primary', () => this.show('mp')));
    this.collectFocusables();
  }

  private row(label: string, control: HTMLElement, valueEl?: HTMLElement): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'setRow';
    const lab = document.createElement('label');
    lab.textContent = label;
    row.appendChild(lab);
    if (valueEl) row.appendChild(valueEl);
    row.appendChild(control);
    return row;
  }

  private select<K extends keyof Settings>(key: K, options: Array<[Settings[K] & (string | number), string]>): HTMLSelectElement {
    const sel = document.createElement('select');
    for (const [value, label] of options) {
      const o = document.createElement('option');
      o.value = String(value);
      o.textContent = label;
      if (S[key] === value) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      const raw = sel.value;
      const v = typeof options[0][0] === 'number' ? Number(raw) : raw;
      updateSetting(key, v as Settings[K]);
    });
    return sel;
  }

  private renderSettings() {
    const box = this.box();
    box.innerHTML = `<div class="sectionTitle">SETTINGS</div>`;

    box.appendChild(this.row('Stadium', this.select('stadium', (Object.keys(STADIUM_NAMES) as StadiumId[]).map((id) => [id, STADIUM_NAMES[id]]))));
    box.appendChild(this.row('Bot difficulty', this.select('botLevel', [['rookie', 'Rookie'], ['pro', 'Pro'], ['allstar', 'All-Star']])));
    box.appendChild(this.row('Match length', this.select('matchLength', [[60, '1:00'], [120, '2:00'], [180, '3:00'], [300, '5:00']])));
    box.appendChild(this.row('Game speed', this.select('gameSpeed', [[0.75, 'Chill (0.75x)'], [1, 'Standard (1x)'], [1.25, 'Turbo (1.25x)']])));

    const blue = document.createElement('input');
    blue.type = 'color';
    blue.value = S.blueColor;
    blue.addEventListener('input', () => updateSetting('blueColor', blue.value));
    box.appendChild(this.row('Your color', blue));

    const orange = document.createElement('input');
    orange.type = 'color';
    orange.value = S.orangeColor;
    orange.addEventListener('input', () => updateSetting('orangeColor', orange.value));
    box.appendChild(this.row('Bot color', orange));

    const unl = document.createElement('input');
    unl.type = 'checkbox';
    unl.checked = S.unlimitedBoost;
    unl.addEventListener('change', () => updateSetting('unlimitedBoost', unl.checked));
    box.appendChild(this.row('Unlimited boost', unl));

    const fovVal = document.createElement('span');
    fovVal.className = 'setVal';
    fovVal.textContent = String(S.cameraFov);
    const fov = document.createElement('input');
    fov.type = 'range';
    fov.min = '60';
    fov.max = '90';
    fov.step = '1';
    fov.value = String(S.cameraFov);
    fov.addEventListener('input', () => {
      fovVal.textContent = fov.value;
      updateSetting('cameraFov', Number(fov.value));
    });
    box.appendChild(this.row('Camera FOV', fov, fovVal));

    const parts = document.createElement('input');
    parts.type = 'checkbox';
    parts.checked = S.particles;
    parts.addEventListener('change', () => updateSetting('particles', parts.checked));
    box.appendChild(this.row('Particles', parts));

    const fx = document.createElement('input');
    fx.type = 'checkbox';
    fx.checked = S.postfx;
    fx.addEventListener('change', () => updateSetting('postfx', fx.checked));
    box.appendChild(this.row('Glow effects (bloom)', fx));

    const volVal = document.createElement('span');
    volVal.className = 'setVal';
    volVal.textContent = String(S.volume);
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.step = '5';
    vol.value = String(S.volume);
    vol.addEventListener('input', () => {
      volVal.textContent = vol.value;
      updateSetting('volume', Number(vol.value));
      SFX.click(); // audible feedback while dragging
    });
    box.appendChild(this.row('Volume', vol, volVal));

    const mute = document.createElement('input');
    mute.type = 'checkbox';
    mute.checked = S.muted;
    mute.addEventListener('change', () => updateSetting('muted', mute.checked));
    box.appendChild(this.row('Mute', mute));

    box.appendChild(this.btn('RESET TO DEFAULTS', '', () => {
      (Object.keys(DEFAULTS) as Array<keyof Settings>).forEach((k) => updateSetting(k, DEFAULTS[k] as never));
      this.renderSettings();
      this.collectFocusables();
    }));
    box.appendChild(this.btn('BACK', 'primary', () => this.back()));
  }
}
