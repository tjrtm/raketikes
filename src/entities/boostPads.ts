import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/world';
import { CONFIG } from '../config';
import type { Car } from './car';

// 6 full pads, RL-style layout: 4 corners + 2 mid-wings
const POSITIONS: Array<{ x: number; z: number }> = [
  { x: -22, z: -34 },
  { x: 22, z: -34 },
  { x: -22, z: 34 },
  { x: 22, z: 34 },
  { x: -24, z: 0 },
  { x: 24, z: 0 },
];

interface Pad {
  active: boolean;
  timer: number;
  disc: THREE.Mesh;
  orb: THREE.Mesh;
}

export class BoostPads {
  private pads: Pad[] = [];

  constructor(physics: Physics, scene: THREE.Scene) {
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    POSITIONS.forEach((p, index) => {
      const sensor = physics.world.createCollider(
        RAPIER.ColliderDesc.cylinder(1.0, CONFIG.boost.padRadius)
          .setTranslation(p.x, 1.0, p.z)
          .setSensor(true)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      physics.tag(sensor, { kind: 'pad', index });

      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(CONFIG.boost.padRadius, CONFIG.boost.padRadius, 0.14, 24),
        new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.85 }),
      );
      disc.position.set(p.x, 0.07, p.z);
      scene.add(disc);

      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 18, 14),
        new THREE.MeshBasicMaterial({ color: 0xffd66e }),
      );
      orb.position.set(p.x, 1.1, p.z);
      scene.add(orb);

      this.pads.push({ active: true, timer: 0, disc, orb });
    });
  }

  /** Called from the collision handler on car-pad intersection. Returns true on pickup. */
  tryPickup(index: number, car: Car): boolean {
    const pad = this.pads[index];
    if (!pad || !pad.active || car.boost >= CONFIG.boost.max) return false;
    car.addBoost(CONFIG.boost.padAmount);
    pad.active = false;
    pad.timer = CONFIG.boost.padCooldown;
    return true;
  }

  fixedUpdate(dt: number) {
    for (const pad of this.pads) {
      if (!pad.active) {
        pad.timer -= dt;
        if (pad.timer <= 0) pad.active = true;
      }
    }
  }

  sync(time: number) {
    for (const pad of this.pads) {
      const discMat = pad.disc.material as THREE.MeshBasicMaterial;
      if (pad.active) {
        pad.orb.visible = true;
        pad.orb.position.y = 1.1 + Math.sin(time * 2.4) * 0.15;
        pad.orb.rotation.y = time * 1.5;
        discMat.opacity = 0.65 + Math.sin(time * 3) * 0.2;
        discMat.color.setHex(0xffc23d);
      } else {
        pad.orb.visible = false;
        discMat.opacity = 0.12;
        discMat.color.setHex(0x5a5040);
      }
    }
  }
}
