/**
 * Touch input layer: a dynamic virtual stick on the left half (steer +
 * throttle; doubles as air pitch/yaw, and as air roll while SLIDE is held)
 * and action buttons on the right (jump/flip, boost, powerslide, ball-cam),
 * plus pause + reset in the top corner. Hidden until the first touch event,
 * so mouse/keyboard players never see it. All elements use touch-action:none
 * and pointer events with per-pointer tracking, so multi-touch (steer +
 * boost + jump simultaneously) works.
 */

const STICK_RADIUS = 64; // px from base to full deflection

export class TouchControls {
  // continuous state merged into InputManager.sample()
  steer = 0;
  throttle = 0;
  boost = false;
  slide = false;
  visible = false;

  // edge events routed through InputManager's existing callbacks
  onJump?: () => void;
  onCam?: () => void;
  onPause?: () => void;
  onReset?: () => void;

  private root: HTMLDivElement;
  private zone: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickId: number | null = null;
  private baseX = 0;
  private baseY = 0;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'touchRoot';
    this.root.style.display = 'none';

    // --- virtual stick zone (left half) ---
    this.zone = document.createElement('div');
    this.zone.id = 'tStickZone';
    this.base = document.createElement('div');
    this.base.id = 'tStickBase';
    this.knob = document.createElement('div');
    this.knob.id = 'tStickKnob';
    this.base.style.display = 'none';
    this.base.appendChild(this.knob);
    this.zone.appendChild(this.base);
    this.root.appendChild(this.zone);

    this.zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      this.zone.setPointerCapture(e.pointerId);
      this.baseX = e.clientX;
      this.baseY = e.clientY;
      this.base.style.display = '';
      this.base.style.left = `${this.baseX}px`;
      this.base.style.top = `${this.baseY}px`;
      this.moveStick(e.clientX, e.clientY);
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.steer = 0;
      this.throttle = 0;
      this.base.style.display = 'none';
    };
    this.zone.addEventListener('pointerup', endStick);
    this.zone.addEventListener('pointercancel', endStick);

    // --- buttons ---
    this.root.appendChild(this.holdButton('tBoost', 'BOOST', (held) => { this.boost = held; }));
    this.root.appendChild(this.holdButton('tSlide', 'SLIDE', (held) => { this.slide = held; }));
    this.root.appendChild(this.tapButton('tJump', 'JUMP', () => this.onJump?.()));
    this.root.appendChild(this.tapButton('tCam', 'CAM', () => this.onCam?.()));
    this.root.appendChild(this.tapButton('tPause', '❚❚', () => this.onPause?.()));
    this.root.appendChild(this.tapButton('tReset', '↺', () => this.onReset?.()));

    document.body.appendChild(this.root);

    // browsers ignore preventDefault in passive listeners — this one must not be passive,
    // or iOS Safari will scroll/zoom/rubber-band over the controls
    this.root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    // follow the input modality: any touch shows the overlay, going back to
    // keyboard or mouse hides it again (touchscreen laptops, stray taps)
    window.addEventListener('touchstart', () => this.show(), { passive: true });
    window.addEventListener('keydown', () => this.hide());
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') this.hide();
    });
  }

  private moveStick(x: number, y: number) {
    let dx = (x - this.baseX) / STICK_RADIUS;
    let dy = (y - this.baseY) / STICK_RADIUS;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.steer = dx;
    this.throttle = -dy; // up = forward (air: nose down, same as W)
    this.knob.style.transform = `translate(-50%, -50%) translate(${dx * STICK_RADIUS}px, ${dy * STICK_RADIUS}px)`;
  }

  private makeButton(id: string, label: string): HTMLDivElement {
    const b = document.createElement('div');
    b.id = id;
    b.className = 'tbtn';
    b.textContent = label;
    return b;
  }

  /** Momentary button: fires state while held (boost, slide). */
  private holdButton(id: string, label: string, set: (held: boolean) => void): HTMLDivElement {
    const b = this.makeButton(id, label);
    b.addEventListener('pointerdown', (e) => {
      b.setPointerCapture(e.pointerId);
      b.classList.add('on');
      set(true);
    });
    const off = () => {
      b.classList.remove('on');
      set(false);
    };
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    return b;
  }

  /** Edge button: fires once per press (jump, cam, pause, reset). */
  private tapButton(id: string, label: string, fire: () => void): HTMLDivElement {
    const b = this.makeButton(id, label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // keep the tap from also acting as a click on elements below
      b.classList.add('on');
      fire();
    });
    const off = () => b.classList.remove('on');
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    return b;
  }

  show() {
    if (this.visible) return;
    this.visible = true;
    this.root.style.display = '';
    document.body.classList.add('touch'); // hides the keyboard legend, relocates the boost meter
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.root.style.display = 'none';
    document.body.classList.remove('touch');
    this.stickId = null;
    this.steer = 0;
    this.throttle = 0;
    this.boost = false;
    this.slide = false;
    this.base.style.display = 'none';
  }
}
