import * as THREE from 'three';
import { CONFIG } from '../config';
import { smoothingAlpha } from '../gameblocks/modules/math/ScalarUtils';

export type CameraMode = 'chase' | 'ball';
const BASIS = CONFIG.basis;

/**
 * Spring-smoothed chase camera. Heading is smoothed separately from position so
 * mid-air car spins don't whip the camera around; position/look use exponential
 * smoothing (frame-rate independent).
 */
export class ChaseCamera {
  mode: CameraMode = 'chase';

  private pos = new THREE.Vector3(0, 6, 40);
  private look = new THREE.Vector3(0, 1, 0);
  private heading = BASIS.forwardVector(new THREE.Vector3());

  private tmpFwd = new THREE.Vector3();
  private tmpUp = new THREE.Vector3();
  private tmpDesired = new THREE.Vector3();
  private tmpLook = new THREE.Vector3();

  toggle() {
    this.mode = this.mode === 'chase' ? 'ball' : 'chase';
  }

  snapBehind(carPos: THREE.Vector3, carQuat: THREE.Quaternion) {
    BASIS.forwardVector(this.heading).applyQuaternion(carQuat);
    BASIS.flatten(this.heading).normalize();
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
      BASIS.forwardVector(this.tmpFwd).applyQuaternion(carQuat);
      BASIS.flatten(this.tmpFwd);
      if (this.tmpFwd.lengthSq() > 0.05) {
        this.tmpFwd.normalize();
        const lag = grounded ? 0.18 : 0.55;
        this.heading.lerp(this.tmpFwd, smoothingAlpha(lag, dt)).normalize();
      }
      desired.copy(carPos).addScaledVector(this.heading, -10.5);
      BASIS.setHeight(desired, BASIS.upComponent(carPos) + 4.2);
      lookTarget.copy(carPos)
        .addScaledVector(this.heading, 5)
        .addScaledVector(BASIS.upVector(this.tmpUp), 1.4);
    } else {
      // Ball-cam: camera sits on the ball->car line, keeping both in frame.
      this.tmpFwd.copy(carPos).sub(ballPos);
      BASIS.flatten(this.tmpFwd);
      if (this.tmpFwd.lengthSq() < 0.04) BASIS.forwardVector(this.tmpFwd).multiplyScalar(-1);
      this.tmpFwd.normalize();
      desired.copy(carPos).addScaledVector(this.tmpFwd, 9);
      BASIS.setHeight(desired, BASIS.upComponent(carPos) + 4);
      lookTarget.copy(ballPos);
      BASIS.addHeight(lookTarget, 1);
    }

    // Never leave the arena or dip into the floor/goals.
    const mx = CONFIG.arena.width / 2 - 1.6;
    const mz = CONFIG.arena.length / 2 - 1.2;
    desired.x = THREE.MathUtils.clamp(desired.x, -mx, mx);
    desired.z = THREE.MathUtils.clamp(desired.z, -mz, mz);
    desired.y = THREE.MathUtils.clamp(desired.y, 1.6, CONFIG.arena.wallHeight - 2);

    this.pos.lerp(desired, smoothingAlpha(1 / 6, dt));
    this.look.lerp(lookTarget, smoothingAlpha(1 / 10, dt));

    camera.position.copy(this.pos);
    camera.lookAt(this.look);
  }
}
