export interface CarInput {
  throttle: number;      // -1..1 (also air pitch)
  steer: number;         // -1..1 (also air yaw; air roll while slide is held)
  roll: number;          // -1..1 (air roll)
  boost: boolean;
  slide: boolean;        // powerslide / handbrake (RL Square)
  jumpPressed: boolean;  // edge-triggered, consumed once per physics tick
}

export function emptyInput(): CarInput {
  return { throttle: 0, steer: 0, roll: 0, boost: false, slide: false, jumpPressed: false };
}

const CAPTURED = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const clamp = (v: number) => Math.max(-1, Math.min(1, v));
const dz = (v: number) => (Math.abs(v) > 0.14 ? v : 0);

/**
 * Merged keyboard + gamepad input, mapped like real Rocket League (PS layout /
 * standard-mapping indices): Cross[0] jump, Circle[1] boost, Square[2] powerslide
 * (+ air roll: stick left/right rolls while Square is held), Triangle[3] ball-cam,
 * left stick steer/pitch, R2/L2 throttle/reverse, L1/R1 explicit air roll,
 * Start pause, Share/Back reset car.
 * pollSystemButtons() must be called once per render frame so Start/Triangle/Cross
 * edges work even while gameplay input is frozen (menus, countdown).
 */
export type NavDir = 'up' | 'down' | 'left' | 'right';

export class InputManager {
  private keys = new Set<string>();
  private jumpQueued = false;
  private padPrev = new Map<number, boolean>();
  private stickNavPrev = { x: 0, y: 0 };

  onPause?: () => void;
  onCameraToggle?: () => void;
  onResetCar?: () => void;
  onPrimary?: () => void;            // Enter / Cross — menu activate & rematch
  onBack?: () => void;               // Circle — menu back (ignored in-game)
  onNavigate?: (dir: NavDir) => void; // arrows / D-pad / stick — menu focus

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (CAPTURED.includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpQueued = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.();
      if (e.code === 'KeyC') this.onCameraToggle?.();
      if (e.code === 'KeyR') this.onResetCar?.();
      if (e.code === 'Enter') this.onPrimary?.();
      if (e.code === 'ArrowUp') this.onNavigate?.('up');
      if (e.code === 'ArrowDown') this.onNavigate?.('down');
      if (e.code === 'ArrowLeft') this.onNavigate?.('left');
      if (e.code === 'ArrowRight') this.onNavigate?.('right');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private pad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    for (const gp of navigator.getGamepads()) {
      if (gp && gp.connected) return gp;
    }
    return null;
  }

  private padEdge(gp: Gamepad, idx: number): boolean {
    const pressed = gp.buttons[idx]?.pressed ?? false;
    const was = this.padPrev.get(idx) ?? false;
    this.padPrev.set(idx, pressed);
    return pressed && !was;
  }

  /** Call once per render frame: routes gamepad system buttons, menu nav, and queues jumps. */
  pollSystemButtons() {
    const gp = this.pad();
    if (!gp) return;
    if (this.padEdge(gp, 0)) { this.jumpQueued = true; this.onPrimary?.(); }
    if (this.padEdge(gp, 1)) this.onBack?.();
    if (this.padEdge(gp, 3)) this.onCameraToggle?.();
    if (this.padEdge(gp, 8)) this.onResetCar?.();
    if (this.padEdge(gp, 9)) this.onPause?.();
    // D-pad
    if (this.padEdge(gp, 12)) this.onNavigate?.('up');
    if (this.padEdge(gp, 13)) this.onNavigate?.('down');
    if (this.padEdge(gp, 14)) this.onNavigate?.('left');
    if (this.padEdge(gp, 15)) this.onNavigate?.('right');
    // left stick as menu nav (edge-triggered on crossing the threshold)
    const sx = gp.axes[0] ?? 0;
    const sy = gp.axes[1] ?? 0;
    const T = 0.6;
    if (sy < -T && this.stickNavPrev.y >= -T) this.onNavigate?.('up');
    if (sy > T && this.stickNavPrev.y <= T) this.onNavigate?.('down');
    if (sx < -T && this.stickNavPrev.x >= -T) this.onNavigate?.('left');
    if (sx > T && this.stickNavPrev.x <= T) this.onNavigate?.('right');
    this.stickNavPrev.x = sx;
    this.stickNavPrev.y = sy;
  }

  /** Drop a queued jump — call when a menu consumed the Cross/Enter press. */
  clearQueuedJump() {
    this.jumpQueued = false;
  }

  /** Snapshot for one physics tick. jumpPressed fires once per press. */
  sample(): CarInput {
    const k = this.keys;
    const has = (...codes: string[]) => codes.some((c) => k.has(c));
    let throttle = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
    let steer = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0);
    let roll = (has('KeyE') ? 1 : 0) - (has('KeyQ') ? 1 : 0);
    let boost = has('ShiftLeft', 'ShiftRight');
    let slide = has('ControlLeft', 'ControlRight');

    const gp = this.pad();
    if (gp) {
      const rt = gp.buttons[7]?.value ?? 0;
      const lt = gp.buttons[6]?.value ?? 0;
      const stickY = -dz(gp.axes[1] ?? 0);
      throttle = clamp(throttle + (rt - lt) + (rt || lt ? 0 : stickY));
      steer = clamp(steer + dz(gp.axes[0] ?? 0));
      roll = clamp(roll + ((gp.buttons[5]?.pressed ? 1 : 0) - (gp.buttons[4]?.pressed ? 1 : 0)));
      boost = boost || (gp.buttons[1]?.pressed ?? false);          // Circle
      slide = slide || (gp.buttons[2]?.pressed ?? false);          // Square
    }

    const input: CarInput = { throttle, steer, roll, boost, slide, jumpPressed: this.jumpQueued };
    this.jumpQueued = false;
    return input;
  }
}
