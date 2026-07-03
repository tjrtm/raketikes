import { Matrix4, Quaternion, Vector3 } from 'three';

const AXES = ['x', 'y', 'z'] as const;
const AXIS_EPS = 1e-9;

type Axis = (typeof AXES)[number];
type AxisSign = 1 | -1;
type AxisString = Axis | `+${Axis}` | `-${Axis}`;
type AxisDescriptor = AxisString | { axis: Axis; sign?: AxisSign | '+' | '-' };
export interface WorldBasisConfig {
  right: AxisDescriptor;
  up: AxisDescriptor;
  forward: AxisDescriptor;
}

interface ResolvedAxis {
  axis: Axis;
  sign: AxisSign;
}

interface PlanarComponents {
  right: number;
  forward: number;
}

interface BasisComponents extends PlanarComponents {
  up: number;
}

export interface BasisFrame {
  right: Vector3;
  up: Vector3;
  forward: Vector3;
  back: Vector3;
}

type ControlDirection =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'forward'
  | 'backward'
  | 'counterClockWise'
  | 'clockWise';

const DEFAULT_AXES = Object.freeze({
  right: Object.freeze({ axis: 'x', sign: 1 }),
  up: Object.freeze({ axis: 'y', sign: 1 }),
  forward: Object.freeze({ axis: 'z', sign: -1 }),
}) satisfies WorldBasisConfig;

function readSignal(value: unknown): number {
  if (value === true) return 1;
  if (value === false || value == null) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseAxisDescriptor(value: AxisDescriptor, label: string): ResolvedAxis {
  const raw = typeof value === 'string'
    ? value
    : value?.axis
      ? `${value.sign === -1 || value.sign === '-' ? '-' : '+'}${value.axis}`
      : null;
  if (typeof raw !== 'string') {
    throw new Error(`WorldBasis: ${label} must be an axis string like "+x" or "-z"`);
  }

  const trimmed = raw.trim().toLowerCase();
  const sign: AxisSign = trimmed.startsWith('-') ? -1 : 1;
  const axis = trimmed.replace(/^[+-]/, '') as Axis;
  if (!AXES.includes(axis)) {
    throw new Error(`WorldBasis: invalid ${label} axis "${raw}"`);
  }
  return { axis, sign };
}

function validateAxes(right: ResolvedAxis, up: ResolvedAxis, forward: ResolvedAxis) {
  const rawAxes = [right.axis, up.axis, forward.axis];
  if (new Set(rawAxes).size !== 3) {
    throw new Error('WorldBasis: right, up, and forward must use three distinct world axes');
  }

  const r = { x: 0, y: 0, z: 0 };
  const f = { x: 0, y: 0, z: 0 };
  r[right.axis] = right.sign;
  f[forward.axis] = forward.sign;
  const cross = {
    x: r.y * f.z - r.z * f.y,
    y: r.z * f.x - r.x * f.z,
    z: r.x * f.y - r.y * f.x,
  };
  if (cross[up.axis] * up.sign <= 0) {
    throw new Error('WorldBasis: right x forward must point along up');
  }
}

function readComponent(value: Partial<Record<Axis, number>> | null | undefined, axis: Axis): number {
  return value?.[axis] ?? 0;
}

export class WorldBasis {
  readonly rightAxis: Readonly<ResolvedAxis>;
  readonly upAxis: Readonly<ResolvedAxis>;
  readonly forwardAxis: Readonly<ResolvedAxis>;
  readonly controlSigns: Readonly<Record<ControlDirection, number>>;

  constructor(config: WorldBasisConfig = DEFAULT_AXES) {
    const right = parseAxisDescriptor(config.right, 'right');
    const up = parseAxisDescriptor(config.up, 'up');
    const forward = parseAxisDescriptor(config.forward, 'forward');

    validateAxes(right, up, forward);

    this.rightAxis = Object.freeze(right);
    this.upAxis = Object.freeze(up);
    this.forwardAxis = Object.freeze(forward);

    this.controlSigns = Object.freeze({
      left: -1,
      right: 1,
      up: 1,
      down: -1,
      forward: 1,
      backward: -1,
      counterClockWise: 1,
      clockWise: -1,
    });
  }

  rightVector(target = new Vector3()): Vector3 {
    target.set(0, 0, 0);
    target[this.rightAxis.axis] = this.rightAxis.sign;
    return target;
  }

  upVector(target = new Vector3()): Vector3 {
    target.set(0, 0, 0);
    target[this.upAxis.axis] = this.upAxis.sign;
    return target;
  }

  downVector(target = new Vector3()): Vector3 {
    return this.upVector(target).multiplyScalar(-1);
  }

  forwardVector(target = new Vector3()): Vector3 {
    target.set(0, 0, 0);
    target[this.forwardAxis.axis] = this.forwardAxis.sign;
    return target;
  }

  rightComponent(value: Partial<Record<Axis, number>>): number {
    return readComponent(value, this.rightAxis.axis) * this.rightAxis.sign;
  }

  upComponent(value: Partial<Record<Axis, number>>): number {
    return readComponent(value, this.upAxis.axis) * this.upAxis.sign;
  }

  forwardComponent(value: Partial<Record<Axis, number>>): number {
    return readComponent(value, this.forwardAxis.axis) * this.forwardAxis.sign;
  }

  setHeight<T extends Partial<Record<Axis, number>>>(target: T, height = 0): T {
    target[this.upAxis.axis] = this.upAxis.sign * height;
    return target;
  }

  flatten<T extends Partial<Record<Axis, number>>>(target: T): T {
    return this.setHeight(target, 0);
  }

  addHeight<T extends Partial<Record<Axis, number>>>(target: T, delta = 0): T {
    target[this.upAxis.axis] = readComponent(target, this.upAxis.axis) + this.upAxis.sign * delta;
    return target;
  }

  hasWorldPlanarComponents(value: Partial<Record<Axis, number>> | null | undefined): boolean {
    return Boolean(value)
      && Number.isFinite(value?.[this.rightAxis.axis])
      && Number.isFinite(value?.[this.forwardAxis.axis]);
  }

  toPlanar(value: Partial<Record<Axis, number>>, out: PlanarComponents = { right: 0, forward: 0 }): PlanarComponents {
    out.right = this.rightComponent(value);
    out.forward = this.forwardComponent(value);
    return out;
  }

  planarDelta(to: Partial<Record<Axis, number>>, from: Partial<Record<Axis, number>>, out: PlanarComponents = { right: 0, forward: 0 }): PlanarComponents {
    out.right = this.rightComponent(to) - this.rightComponent(from);
    out.forward = this.forwardComponent(to) - this.forwardComponent(from);
    return out;
  }

  fromBasisComponents(right = 0, up = 0, forward = 0, target = new Vector3()): Vector3 {
    target.set(0, 0, 0);
    target[this.rightAxis.axis] = this.rightAxis.sign * right;
    target[this.upAxis.axis] = this.upAxis.sign * up;
    target[this.forwardAxis.axis] = this.forwardAxis.sign * forward;
    return target;
  }

  toBasisComponents(value: Partial<Record<Axis, number>>, out: BasisComponents = { right: 0, up: 0, forward: 0 }): BasisComponents {
    out.right = this.rightComponent(value);
    out.up = this.upComponent(value);
    out.forward = this.forwardComponent(value);
    return out;
  }

  controlSignal(direction: ControlDirection, signal: unknown): number {
    if (Object.prototype.hasOwnProperty.call(this.controlSigns, direction)) {
      return this.controlSigns[direction] * readSignal(signal);
    }
    throw new Error(`WorldBasis: unknown control direction "${direction}"`);
  }

  surfaceNormalFromSlopes(rightSlope = 0, forwardSlope = 0, target = new Vector3()): Vector3 {
    return this.fromBasisComponents(-rightSlope, 1, -forwardSlope, target).normalize();
  }

  yawPitchRollFrame(yaw = 0, pitch = 0, roll = 0): BasisFrame {
    const pitchCos = Math.cos(pitch);
    const forward = this.fromBasisComponents(
      -Math.sin(yaw) * pitchCos,
      Math.sin(pitch),
      Math.cos(yaw) * pitchCos,
    ).normalize();
    const right = this.fromBasisComponents(
      Math.cos(yaw),
      0,
      Math.sin(yaw),
    ).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();

    if (roll) {
      right.applyAxisAngle(forward, roll).normalize();
      up.applyAxisAngle(forward, roll).normalize();
    }

    return {
      right,
      up,
      forward,
      back: forward.clone().multiplyScalar(-1),
    };
  }

  distanceSqPlanar(a: Partial<Record<Axis, number>>, b: Partial<Record<Axis, number>>): number {
    const dRight = this.rightComponent(a) - this.rightComponent(b);
    const dForward = this.forwardComponent(a) - this.forwardComponent(b);
    return dRight * dRight + dForward * dForward;
  }

  planarLength(value: Partial<Record<Axis, number>>): number {
    const right = this.rightComponent(value);
    const forward = this.forwardComponent(value);
    return Math.sqrt(right * right + forward * forward);
  }

  sideVector(value: Partial<Record<Axis, number>>, preferredDirection = 1, target = new Vector3()): Vector3 {
    const right = this.rightComponent(value);
    const forward = this.forwardComponent(value);
    return this.fromBasisComponents(
      forward * preferredDirection,
      0,
      -right * preferredDirection,
      target,
    );
  }

  threeObjectCanonicalToBasisQuaternion(target = new Quaternion()): Quaternion {
    return target.setFromRotationMatrix(new Matrix4().makeBasis(
      this.rightVector(),
      this.upVector(),
      this.forwardVector().multiplyScalar(-1),
    ));
  }

  threePlaneCanonicalToBasisQuaternion(target = new Quaternion()): Quaternion {
    return target.setFromRotationMatrix(new Matrix4().makeBasis(
      this.rightVector(),
      this.forwardVector(),
      this.upVector(),
    ));
  }

  forwardToYaw(forward: Partial<Record<Axis, number>>): number {
    const right = this.rightComponent(forward);
    const forwardComponent = this.forwardComponent(forward);
    if (right * right + forwardComponent * forwardComponent <= AXIS_EPS) return 0;
    return Math.atan2(-right, forwardComponent);
  }
}

export const DEFAULT_WORLD_BASIS = Object.freeze(new WorldBasis(DEFAULT_AXES));

export function createWorldBasis(config: WorldBasisConfig = DEFAULT_AXES): WorldBasis {
  return new WorldBasis(config);
}
