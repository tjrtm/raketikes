import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Physics, RAPIER } from '../physics/world';
import { CONFIG, TEAM_COLOR, type Team } from '../config';
import { S } from '../game/settings';
import { emptyInput, type CarInput } from '../controls/input';

const C = CONFIG.car;
const BASIS = CONFIG.basis;
const UP = BASIS.upVector(new THREE.Vector3());
const HITBOX_ROUND = 0.14; // collider corner radius — matches the rounded visual shell

/**
 * Arcade car on a single dynamic round-cuboid. Local forward is -Z.
 * Grounded: engine force along forward, yaw set directly, lateral velocity
 * actively killed (grip) with a lower rate while boosting+steering (drift).
 * Airborne: torque-based pitch/yaw/roll, boost along nose for aerials.
 */
export class Car {
  body: RAPIER.RigidBody;
  mesh: THREE.Group;
  team: Team;
  boost = CONFIG.boost.start;
  boosting = false;
  grounded = false;
  color: number;
  private hasAirJump = true;
  private input: CarInput = emptyInput();
  private mass: number;
  private flame: THREE.Mesh;
  private wheels: THREE.Mesh[] = [];
  private wheelSpin = 0;
  private bodyMat: THREE.MeshStandardMaterial;
  private glowMat: THREE.MeshBasicMaterial;

  private vFwd = new THREE.Vector3();
  private vUp = new THREE.Vector3();
  private vRight = new THREE.Vector3();
  private vVel = new THREE.Vector3();
  private vTmp = new THREE.Vector3();
  private quat = new THREE.Quaternion();

  constructor(physics: Physics, scene: THREE.Scene, team: Team, pos: { x: number; y: number; z: number }, yaw: number) {
    this.team = team;
    this.color = TEAM_COLOR[team];
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinearDamping(C.linearDamping)
        .setAngularDamping(C.angularDamping)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    // round cuboid = exact hitbox for the rounded visual shell (same outer dimensions)
    const collider = physics.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(
        C.half.x - HITBOX_ROUND, C.half.y - HITBOX_ROUND, C.half.z - HITBOX_ROUND, HITBOX_ROUND,
      )
        .setDensity(C.density)
        .setFriction(0.4)
        .setRestitution(0.1)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.tag(collider, { kind: 'car', car: this });
    this.mass = this.body.mass();

    const built = buildCarMesh(this.color, this.wheels);
    this.mesh = built.group;
    this.bodyMat = built.bodyMat;
    this.glowMat = built.glowMat;
    this.flame = this.mesh.getObjectByName('flame') as THREE.Mesh;
    scene.add(this.mesh);
  }

  setColor(color: number) {
    this.color = color;
    this.bodyMat.color.setHex(color);
    this.glowMat.color.setHex(color);
  }

  applyInput(input: CarInput) {
    this.input = input;
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }
  get quaternion(): THREE.Quaternion {
    const r = this.body.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }
  get velocity(): THREE.Vector3 {
    const v = this.body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }
  get speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  nozzle(out: THREE.Vector3): THREE.Vector3 {
    const t = this.body.translation();
    out.set(0, 0.05, C.half.z + 0.2).applyQuaternion(this.quatCached()).add(this.vTmp.set(t.x, t.y, t.z));
    return out;
  }
  backDir(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, 1).applyQuaternion(this.quatCached());
  }
  private quatCached(): THREE.Quaternion {
    const r = this.body.rotation();
    return this.quat.set(r.x, r.y, r.z, r.w);
  }

  fixedUpdate(dt: number, physics: Physics) {
    const input = this.input;
    const t = this.body.translation();
    const rot = this.quatCached();
    const fwd = BASIS.forwardVector(this.vFwd).applyQuaternion(rot);
    const up = BASIS.upVector(this.vUp).applyQuaternion(rot);
    const right = BASIS.rightVector(this.vRight).applyQuaternion(rot);
    const lv = this.body.linvel();
    const vel = this.vVel.set(lv.x, lv.y, lv.z);

    const rayLen = C.half.y + 0.45;
    const hit = physics.rayDistance({ x: t.x, y: t.y, z: t.z }, { x: -up.x, y: -up.y, z: -up.z }, rayLen, this.body);
    const wasGrounded = this.grounded;
    this.grounded = hit !== null;
    if (this.grounded && !wasGrounded) this.hasAirJump = true;

    const fwdSpeed = vel.dot(fwd);

    // --- boost ---
    this.boosting = input.boost && this.boost > 0;
    if (this.boosting) {
      if (S.unlimitedBoost) this.boost = CONFIG.boost.max;
      else this.boost = Math.max(0, this.boost - CONFIG.boost.drainPerSec * dt);
      if (fwdSpeed < C.boostMaxSpeed) {
        this.impulse(fwd, CONFIG.boost.accel * this.mass * dt);
      }
    }

    if (this.grounded) {
      if (input.throttle > 0) {
        if (fwdSpeed < -0.5) this.impulse(fwd, C.brake * this.mass * dt);
        else if (fwdSpeed < C.maxSpeed) this.impulse(fwd, C.accel * this.mass * dt * input.throttle);
      } else if (input.throttle < 0) {
        if (fwdSpeed > 0.5) this.impulse(fwd, -C.brake * this.mass * dt);
        else if (fwdSpeed > -C.reverseMaxSpeed) this.impulse(fwd, -C.reverseAccel * this.mass * dt);
      } else if (Math.abs(fwdSpeed) > 0.3 && !this.boosting) {
        this.impulse(fwd, -Math.sign(fwdSpeed) * C.coastDecel * this.mass * dt);
      }

      const latSpeed = vel.dot(right);
      // powerslide overrides everything; boosting + hard steer gives a milder drift
      const gripRate = input.slide ? C.slideGrip
        : this.boosting && Math.abs(input.steer) > 0.5 ? C.driftGrip : C.grip;
      this.impulse(right, -latSpeed * this.mass * (1 - Math.exp(-gripRate * dt)));

      const speedFactor = THREE.MathUtils.clamp(Math.abs(fwdSpeed) / 8, 0, 1);
      const driveSign = fwdSpeed < -0.5 ? -1 : 1;
      const yawRate = -input.steer * C.turnRate * speedFactor * driveSign;
      const av = this.body.angvel();
      const avV = this.vTmp.set(av.x, av.y, av.z);
      const alongUp = avV.dot(up);
      avV.addScaledVector(up, -alongUp).multiplyScalar(0.82).addScaledVector(up, yawRate);
      this.body.setAngvel({ x: avV.x, y: avV.y, z: avV.z }, true);

      this.impulse(up, -C.downforce * this.mass * dt);
    } else {
      // RL-style: holding slide (Square) turns stick left/right into air roll
      const steerAsRoll = input.slide ? input.steer : 0;
      const pitch = -input.throttle * C.airPitch; // W = nose down
      const yaw = input.slide ? 0 : -input.steer * C.airYaw;
      const roll = -(input.roll + steerAsRoll) * C.airRoll;
      this.vTmp.set(0, 0, 0)
        .addScaledVector(right, pitch)
        .addScaledVector(up, yaw)
        .addScaledVector(fwd, roll)
        .multiplyScalar(this.mass * dt);
      this.body.applyTorqueImpulse(this.vTmp, true);

      // self-right assist near the ground
      const upDot = up.dot(UP);
      const av = this.body.angvel();
      const avMag = Math.hypot(av.x, av.y, av.z);
      if (upDot < 0.35 && avMag < 5 && Math.abs(lv.y) < 3) {
        const near = physics.rayDistance({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 }, 1.8, this.body);
        if (near !== null) {
          this.vTmp.crossVectors(up, UP);
          // fully inverted -> cross degenerates; roll over the forward axis instead
          if (this.vTmp.lengthSq() < 1e-4) this.vTmp.copy(fwd).setY(0);
          if (this.vTmp.lengthSq() > 1e-4) {
            this.vTmp.normalize().multiplyScalar(C.rightingTorque * this.mass * dt);
            this.body.applyTorqueImpulse(this.vTmp, true);
          }
        }
      }
    }

    // --- jump / flip ---
    if (input.jumpPressed) {
      if (this.grounded) {
        this.impulse(up, C.jumpSpeed * this.mass);
        this.grounded = false;
      } else if (this.hasAirJump) {
        this.hasAirJump = false;
        const dir = this.vTmp.set(input.steer, 0, -input.throttle);
        if (dir.lengthSq() > 0.04) {
          dir.applyQuaternion(rot);
          dir.y = 0;
          dir.normalize();
          const v = this.body.linvel();
          this.body.setLinvel({ x: v.x, y: v.y * 0.3, z: v.z }, true);
          this.impulse(dir, C.flipSpeed * this.mass);
          const spinAxis = new THREE.Vector3().crossVectors(UP, dir).multiplyScalar(C.flipSpin);
          this.body.setAngvel({ x: spinAxis.x, y: spinAxis.y, z: spinAxis.z }, true);
        } else {
          this.impulse(up, C.doubleJumpSpeed * this.mass);
        }
      }
    }

    const av = this.body.angvel();
    const avMag = Math.hypot(av.x, av.y, av.z);
    if (avMag > C.maxAngVel) {
      const k = C.maxAngVel / avMag;
      this.body.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, true);
    }
  }

  private impulse(dir: THREE.Vector3, magnitude: number) {
    this.body.applyImpulse({ x: dir.x * magnitude, y: dir.y * magnitude, z: dir.z * magnitude }, true);
  }

  addBoost(amount: number) {
    this.boost = Math.min(CONFIG.boost.max, this.boost + amount);
  }

  sync(dt: number) {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);

    const v = this.body.linvel();
    const fwd = this.vFwd.set(0, 0, -1).applyQuaternion(this.quatCached());
    this.wheelSpin += (v.x * fwd.x + v.y * fwd.y + v.z * fwd.z) * dt / 0.36;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    this.flame.visible = this.boosting;
    if (this.boosting) {
      this.flame.scale.set(1, 0.8 + Math.random() * 0.7, 1);
    }
  }

  reset(pos: { x: number; y: number; z: number }, yaw: number, boostTo?: number) {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    this.body.setTranslation(pos, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.hasAirJump = true;
    if (boostTo !== undefined) this.boost = boostTo;
  }

  /** Drop the car upright at its current spot (clamped into the field), keeping its heading. */
  safeReset() {
    const t = this.body.translation();
    let x = THREE.MathUtils.clamp(t.x, -CONFIG.arena.width / 2 + 5, CONFIG.arena.width / 2 - 5);
    let z = THREE.MathUtils.clamp(t.z, -CONFIG.arena.length / 2 + 7, CONFIG.arena.length / 2 - 7);
    const cornerX = CONFIG.arena.width / 2 - CONFIG.arena.cornerCut - 3;
    const cornerZ = CONFIG.arena.length / 2 - CONFIG.arena.cornerCut - 3;
    if (Math.abs(x) > cornerX && Math.abs(z) > cornerZ) {
      x = Math.sign(x) * cornerX;
      z = Math.sign(z) * cornerZ;
    }
    const fwd = BASIS.forwardVector(this.vTmp).applyQuaternion(this.quatCached());
    const yaw = BASIS.planarLength(fwd) > 0.05 ? BASIS.forwardToYaw(fwd) : 0;
    this.reset({ x, y: C.half.y + 0.75, z }, yaw);
  }
}

// ---------------------------------------------------------------- visual

function buildCarMesh(color: number, wheelsOut: THREE.Mesh[]) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x11141c, roughness: 0.6, metalness: 0.35 });

  // rounded shell matching the physics round-cuboid
  const chassis = new THREE.Mesh(new RoundedBoxGeometry(C.half.x * 2, C.half.y * 2, C.half.z * 2, 4, HITBOX_ROUND), bodyMat);
  chassis.castShadow = true;
  group.add(chassis);

  const cabin = new THREE.Mesh(new RoundedBoxGeometry(C.half.x * 1.35, 0.52, C.half.z * 1.05, 3, 0.12), darkMat);
  cabin.position.set(0, C.half.y + 0.2, 0.3);
  cabin.castShadow = true;
  group.add(cabin);

  const nose = new THREE.Mesh(new RoundedBoxGeometry(C.half.x * 1.5, C.half.y * 1.1, 0.8, 3, 0.12), bodyMat);
  nose.position.set(0, -0.1, -C.half.z - 0.25);
  nose.castShadow = true;
  group.add(nose);

  // rear spoiler for silhouette
  const spoiler = new THREE.Mesh(new RoundedBoxGeometry(C.half.x * 1.8, 0.1, 0.5, 2, 0.04), darkMat);
  spoiler.position.set(0, C.half.y + 0.28, C.half.z - 0.15);
  group.add(spoiler);
  for (const sx of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.3), darkMat);
    strut.position.set(sx * C.half.x * 0.7, C.half.y + 0.1, C.half.z - 0.15);
    group.add(strut);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const w = new THREE.Mesh(wheelGeo, darkMat);
    w.position.set(sx * (C.half.x + 0.05), -C.half.y + 0.06, sz * (C.half.z - 0.55));
    group.add(w);
    wheelsOut.push(w);
  }

  const flameGeo = new THREE.ConeGeometry(0.32, 1.5, 12);
  flameGeo.translate(0, 0.75, 0);
  const flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.9, depthWrite: false }));
  flame.name = 'flame';
  flame.rotation.x = Math.PI / 2;
  flame.position.set(0, 0.05, C.half.z);
  flame.visible = false;
  group.add(flame);

  const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(C.half.x * 2.6, C.half.z * 2.6), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -C.half.y - 0.06;
  group.add(glow);

  return { group, bodyMat, glowMat };
}
