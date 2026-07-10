import * as THREE from 'three';

const MAX = 900;

function spriteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const WAVES = 4;

/** CPU particle pool rendered as one additive THREE.Points. Cheap and plenty for bursts + trails. */
export class Effects {
  // expanding-ring pool for goal shockwaves
  private waves: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number }> = [];
  private points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private base = new Float32Array(MAX * 3);
  private cursor = 0;
  private tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3).fill(-1000);
    this.col = new Float32Array(MAX * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.55,
      map: spriteTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
    for (let i = 0; i < WAVES; i++) {
      const rm = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(ringGeo, rm);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.waves.push({ mesh, mat: rm, t: -1 });
    }
  }

  /** Expanding floor ring (goal explosions, big landings). */
  shockwave(p: THREE.Vector3, color: number) {
    if (!this.enabled) return;
    const w = this.waves.find((x) => x.t < 0) ?? this.waves[0];
    w.t = 0;
    w.mesh.position.set(p.x, 0.25, p.z);
    w.mat.color.setHex(color).multiplyScalar(2.0);
    w.mesh.visible = true;
  }

  /** Tire smoke while powersliding: dim puffs drifting up and back. */
  smoke(p: THREE.Vector3, back: THREE.Vector3) {
    this.tmpV.copy(back).multiplyScalar(3 + Math.random() * 2);
    this.tmpV.x += (Math.random() - 0.5) * 2;
    this.tmpV.y += 1.5 + Math.random() * 1.5;
    this.tmpV.z += (Math.random() - 0.5) * 2;
    this.tmpP.set(p.x + (Math.random() - 0.5) * 0.8, p.y, p.z + (Math.random() - 0.5) * 0.8);
    this.spawn(this.tmpP, this.tmpV, 0x3a4258, 0.35 + Math.random() * 0.25);
  }

  /** Streaking particles behind a fast-moving ball. */
  ballTrail(p: THREE.Vector3, v: THREE.Vector3) {
    this.tmpV.copy(v).multiplyScalar(-0.12);
    this.tmpV.x += (Math.random() - 0.5) * 1.5;
    this.tmpV.y += (Math.random() - 0.5) * 1.5;
    this.tmpV.z += (Math.random() - 0.5) * 1.5;
    this.tmpP.set(p.x + (Math.random() - 0.5), p.y + (Math.random() - 0.5), p.z + (Math.random() - 0.5));
    this.spawn(this.tmpP, this.tmpV, 0x9fd0ff, 0.16 + Math.random() * 0.14);
  }

  enabled = true;

  spawn(p: THREE.Vector3, v: THREE.Vector3, color: number, life: number) {
    if (!this.enabled) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.tmpColor.setHex(color).multiplyScalar(1.8); // HDR so trails/bursts bloom
    this.base[i * 3] = this.tmpColor.r; this.base[i * 3 + 1] = this.tmpColor.g; this.base[i * 3 + 2] = this.tmpColor.b;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  private tmpP = new THREE.Vector3();
  private tmpV = new THREE.Vector3();

  burst(p: THREE.Vector3, color: number, count: number, speed: number) {
    for (let n = 0; n < count; n++) {
      this.tmpV.set(Math.random() - 0.5, Math.random() - 0.35, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      this.tmpP.copy(p);
      this.spawn(this.tmpP, this.tmpV, color, 0.5 + Math.random() * 0.7);
    }
  }

  /** Boost exhaust: a couple of particles per frame streaming backwards. */
  trail(nozzle: THREE.Vector3, backDir: THREE.Vector3, color: number) {
    for (let n = 0; n < 2; n++) {
      this.tmpV.copy(backDir).multiplyScalar(9 + Math.random() * 4);
      this.tmpV.x += (Math.random() - 0.5) * 2.5;
      this.tmpV.y += (Math.random() - 0.3) * 2.5;
      this.tmpV.z += (Math.random() - 0.5) * 2.5;
      this.tmpP.copy(nozzle);
      this.spawn(this.tmpP, this.tmpV, color, 0.22 + Math.random() * 0.18);
    }
  }

  update(dt: number) {
    const WAVE_LIFE = 0.55;
    for (const w of this.waves) {
      if (w.t < 0) continue;
      w.t += dt;
      if (w.t >= WAVE_LIFE) {
        w.t = -1;
        w.mesh.visible = false;
        continue;
      }
      const f = w.t / WAVE_LIFE;
      const s = 1 + f * 22;
      w.mesh.scale.set(s, s, s);
      w.mat.opacity = 0.85 * (1 - f) * (1 - f);
    }
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -1000;
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.vel[i * 3 + 1] -= 6 * dt; // light gravity on sparks
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[i * 3] = this.base[i * 3] * f;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
}
