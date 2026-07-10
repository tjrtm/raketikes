import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/world';
import { CONFIG, KICKOFF } from '../config';

function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9edf4';
  g.fillRect(0, 0, 512, 512);
  // hex-ish panel dots so spin reads clearly
  g.fillStyle = '#1c2740';
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const x = col * 85 + (row % 2 ? 42 : 0) + 20;
      const y = row * 85 + 30;
      g.beginPath();
      g.arc(x, y, 22, 0, Math.PI * 2);
      g.fill();
    }
  }
  return new THREE.CanvasTexture(c);
}

export class Ball {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  private flash = 0;

  constructor(physics: Physics, scene: THREE.Scene) {
    const B = CONFIG.ball;
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(KICKOFF.ball.x, KICKOFF.ball.y, KICKOFF.ball.z)
        .setLinearDamping(B.linearDamping)
        .setAngularDamping(B.angularDamping)
        .setGravityScale(B.gravityScale)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    const collider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(B.radius)
        .setDensity(B.density)
        .setRestitution(B.restitution)
        .setFriction(B.friction)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.tag(collider, { kind: 'ball' });

    this.mat = new THREE.MeshStandardMaterial({
      map: ballTexture(),
      roughness: 0.4,
      metalness: 0.1,
      emissive: new THREE.Color(0x8fc6ff),
      emissiveIntensity: 0,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(B.radius, 40, 28), this.mat);
    this.mesh.castShadow = true;
    scene.add(this.mesh);
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** Impact highlight, 0..1 strength. */
  hit(strength: number) {
    this.flash = Math.min(1.2, this.flash + strength);
  }

  fixedUpdate() {
    const v = this.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > CONFIG.ball.maxSpeed) {
      const k = CONFIG.ball.maxSpeed / speed;
      this.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
    }
  }

  sync(dt: number) {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.mat.emissiveIntensity = this.flash * 1.5; // HDR: strong hits push past the bloom threshold
  }

  reset() {
    this.body.setTranslation(KICKOFF.ball, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
