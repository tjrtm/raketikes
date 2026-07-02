import * as THREE from 'three';
import type { Rendering } from '../rendering/scene';

export type StadiumId = 'neon' | 'space' | 'sunset';
export const STADIUM_NAMES: Record<StadiumId, string> = {
  neon: 'Neon City',
  space: 'Deep Orbit',
  sunset: 'Dune Sunset',
};

export interface EnvHandle {
  id: StadiumId;
  dispose(): void;
}

function gradientSky(top: string, mid: string, bottom: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.55, mid);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.BackSide, fog: false, depthWrite: false });
  return new THREE.Mesh(new THREE.SphereGeometry(420, 24, 16), mat);
}

function starField(count: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(380 + Math.random() * 20);
    if (v.y < 5) v.y = 5 + Math.random() * 200; // keep stars above the horizon
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 1.6, color: 0xdfe8ff, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  return p;
}

function windowsTexture(hue: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05060d';
  g.fillRect(0, 0, 32, 64);
  g.fillStyle = hue;
  for (let y = 2; y < 62; y += 5) {
    for (let x = 2; x < 30; x += 5) {
      if (Math.random() < 0.45) g.fillRect(x, y, 3, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** Translucent dome shell over the arena — the stadium "glass roof". */
function dome(color: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(80, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -2;
  return m;
}

export function buildEnvironment(rendering: Rendering, id: StadiumId): EnvHandle {
  const scene = rendering.scene;
  const group = new THREE.Group();
  group.name = `env-${id}`;

  const fog = scene.fog as THREE.FogExp2;

  if (id === 'neon') {
    scene.background = new THREE.Color(0x050310);
    fog.color.setHex(0x0a0618);
    fog.density = 0.003;
    rendering.hemi.color.setHex(0x8f9dff);
    rendering.hemi.groundColor.setHex(0x1c1430);
    rendering.hemi.intensity = 1.0;
    rendering.sun.color.setHex(0xbfc8ff);
    rendering.sun.intensity = 1.5;

    group.add(gradientSky('#050310', '#120a2e', '#2a1b4d'));
    group.add(starField(500));
    group.add(dome(0x7f8cff));
    // city skyline: emissive-window towers ringed around the dome
    const winTex = windowsTexture('#7fd4ff');
    const winTex2 = windowsTexture('#ff9df0');
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + Math.random() * 0.12;
      const r = 130 + Math.random() * 190;
      const h = 18 + Math.random() * 75;
      const w = 7 + Math.random() * 9;
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, w),
        new THREE.MeshStandardMaterial({
          color: 0x0a0d18,
          emissive: 0xffffff,
          emissiveMap: Math.random() < 0.5 ? winTex : winTex2,
          emissiveIntensity: 0.9,
          roughness: 0.9,
        }),
      );
      b.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
      group.add(b);
    }
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(500, 48),
      new THREE.MeshStandardMaterial({ color: 0x080a14, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.2;
    group.add(ground);
  } else if (id === 'space') {
    scene.background = new THREE.Color(0x010208);
    fog.color.setHex(0x02030a);
    fog.density = 0.002;
    rendering.hemi.color.setHex(0x9fc0ff);
    rendering.hemi.groundColor.setHex(0x0a0f22);
    rendering.hemi.intensity = 0.85;
    rendering.sun.color.setHex(0xdfe8ff);
    rendering.sun.intensity = 1.8;

    group.add(gradientSky('#010208', '#03071c', '#071233'));
    group.add(starField(1400));
    group.add(dome(0x88ccff));
    // banded gas giant + ring
    const pc = document.createElement('canvas');
    pc.width = 8;
    pc.height = 64;
    const pg = pc.getContext('2d')!;
    const bands = ['#4a6fa8', '#6d8fc4', '#3a5a90', '#89a8d8', '#54749f', '#7d97c9'];
    for (let i = 0; i < 64; i++) {
      pg.fillStyle = bands[Math.floor(i / 8) % bands.length];
      pg.fillRect(0, i, 8, 1);
    }
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(85, 32, 24),
      new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(pc), roughness: 1, fog: false }),
    );
    planet.position.set(210, 110, -260);
    group.add(planet);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(105, 150, 48),
      new THREE.MeshBasicMaterial({ color: 0x8fa8d0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: false }),
    );
    ring.position.copy(planet.position);
    ring.rotation.x = Math.PI / 2.4;
    group.add(ring);
    // dark platform so the arena isn't floating on nothing
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(85, 70, 6, 48),
      new THREE.MeshStandardMaterial({ color: 0x0c1120, roughness: 0.8, metalness: 0.4 }),
    );
    platform.position.y = -3.2;
    group.add(platform);
  } else {
    // sunset
    scene.background = new THREE.Color(0x1d0f33);
    fog.color.setHex(0x53281a);
    fog.density = 0.0026;
    rendering.hemi.color.setHex(0xffc79a);
    rendering.hemi.groundColor.setHex(0x3a2410);
    rendering.hemi.intensity = 1.15;
    rendering.sun.color.setHex(0xffd9a0);
    rendering.sun.intensity = 1.9;

    group.add(gradientSky('#1d0f33', '#a03e1e', '#ffb347'));
    group.add(dome(0xffc890));
    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(34, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0, fog: false }),
    );
    sunDisc.position.set(-180, 42, -330);
    sunDisc.lookAt(0, 10, 0);
    group.add(sunDisc);
    // dunes: huge mostly-buried spheres
    const duneMat = new THREE.MeshStandardMaterial({ color: 0xb4753e, roughness: 1 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.random() * 0.3;
      const r = 170 + Math.random() * 190;
      const size = 55 + Math.random() * 90;
      const d = new THREE.Mesh(new THREE.SphereGeometry(size, 20, 14), duneMat);
      d.position.set(Math.cos(a) * r, -size * 0.82, Math.sin(a) * r);
      d.scale.y = 0.55;
      group.add(d);
    }
    const sand = new THREE.Mesh(
      new THREE.CircleGeometry(520, 48),
      new THREE.MeshStandardMaterial({ color: 0x9c6234, roughness: 1 }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = -0.2;
    group.add(sand);
  }

  scene.add(group);

  return {
    id,
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) mat.dispose();
      });
    },
  };
}
