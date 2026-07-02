import * as THREE from 'three';
import { CONFIG } from '../config';

export type CameraMode = 'chase' | 'ball';

/**
 * Spring-smoothed chase camera. Heading is smoothed separately from position so
 * mid-air car spins don't whip the camera around; position/look use exponential
 * smoothing (frame-rate independent).
 */
export class ChaseCamera {
  mode: CameraMode = 'chase';

  private pos = new THREE.Vector3(0, 6, 40);
  private look = new THREE.Vector3(0, 1, 0);
  private heading = new THREE.Vector3(0, 0, -1);

  private tmpFwd = new THREE.Vector3();
  private tmpDesired = new THREE.Vector3();
  private tmpLook = new THREE.Vector3();

  toggle() {
    this.mode = this.mode === 'chase' ? 'ball' : 'chase';
  }

  snapBehind(carPos: THREE.Vector3, carQuat: THREE.Quaternion) {
    this.heading.set(0, 0, -1).applyQuaternion(carQuat).setY(0).normalize();
    this.pos.copy(carPos).addScaledVector(this.heading, -11).add(new THREE.Vector3(0, 4.5, 0));
    this.look.copy(carPos);
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    carPos: THREE.Vector3,
    carQuat: THREE.Quaternion,
    grounded: boolean,
    ballPos: THREE.Vector3,
  ) {
    const desired = this.tmpDesired;
    const lookTarget = this.tmpLook;

    if (this.mode === 'chase') {
      // Follow the car's flattened forward; only track rotation quickly while grounded.
      this.tmpFwd.set(0, 0, -1).applyQuaternion(carQuat);
      this.tmpFwd.y = 0;
      if (this.tmpFwd.lengthSq() > 0.05) {
        this.tmpFwd.normalize();
        const rate = grounded ? 5.5 : 1.8;
        this.heading.lerp(this.tmpFwd, 1 - Math.exp(-rate * dt)).normalize();
      }
      desired.copy(carPos).addScaledVector(this.heading, -10.5);
      desired.y = carPos.y + 4.2;
      lookTarget.copy(carPos).addScaledVector(this.heading, 5).add({ x: 0, y: 1.4, z: 0 } as THREE.Vector3);
    } else {
      // Ball-cam: camera sits on the ball->car line, keeping both in frame.
      this.tmpFwd.copy(carPos).sub(ballPos);
      this.tmpFwd.y = 0;
      if (this.tmpFwd.lengthSq() < 0.04) this.tmpFwd.set(0, 0, 1);
      this.tmpFwd.normalize();
      desired.copy(carPos).addScaledVector(this.tmpFwd, 9);
      desired.y = carPos.y + 4;
      lookTarget.copy(ballPos);
      lookTarget.y += 1;
    }

    // Never leave the arena or dip into the floor/goals.
    const mx = CONFIG.arena.width / 2 - 1.6;
    const mz = CONFIG.arena.length / 2 - 1.2;
    desired.x = THREE.MathUtils.clamp(desired.x, -mx, mx);
    desired.z = THREE.MathUtils.clamp(desired.z, -mz, mz);
    desired.y = THREE.MathUtils.clamp(desired.y, 1.6, CONFIG.arena.wallHeight - 2);

    this.pos.lerp(desired, 1 - Math.exp(-6 * dt));
    this.look.lerp(lookTarget, 1 - Math.exp(-10 * dt));

    camera.position.copy(this.pos);
    camera.lookAt(this.look);
  }
}
