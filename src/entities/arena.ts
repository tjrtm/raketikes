import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/world';
import { CONFIG, TEAM, TEAM_COLOR, type Team } from '../config';

const W = CONFIG.arena.width;
const L = CONFIG.arena.length;
const H = CONFIG.arena.wallHeight;
const G = CONFIG.goal;
const R = CONFIG.ball.radius;

const GLASS_BASE = 0.16;
const FADE_DIST = 10; // walls fade when the player is closer than this
const FADED = 0.035;

export interface Arena {
  /** Per-frame: fades any glass panel the player is close to. */
  update(dt: number, playerPos: THREE.Vector3): void;
  setTeamColors(blue: number, orange: number): void;
}

interface FadeGroup {
  mat: THREE.MeshStandardMaterial;
  distance(p: THREE.Vector3): number;
}

/** Builds all static geometry: colliders (unchanged since v1 verification) + glass-dome visuals. */
export function buildArena(physics: Physics, scene: THREE.Scene): Arena {
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  const solid = (desc: RAPIER.ColliderDesc) => {
    const c = physics.world.createCollider(desc.setFriction(0.7).setRestitution(0.55), body);
    physics.tag(c, { kind: 'arena' });
    return c;
  };

  // --- colliders ---
  solid(RAPIER.ColliderDesc.cuboid(W / 2 + 2, 0.5, L / 2 + G.depth + 2).setTranslation(0, -0.5, 0));
  solid(RAPIER.ColliderDesc.cuboid(W / 2 + 2, 0.5, L / 2 + 2).setTranslation(0, H + 0.5, 0));
  for (const sx of [-1, 1]) {
    solid(RAPIER.ColliderDesc.cuboid(0.5, H / 2 + 1, L / 2).setTranslation(sx * (W / 2 + 0.5), H / 2, 0));
  }
  const cc = CONFIG.arena.cornerCut;
  const cornerHalfLen = cc * Math.SQRT2 * 0.75;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sx * sz * Math.PI / 4);
      solid(
        RAPIER.ColliderDesc.cuboid(cornerHalfLen, H / 2, 0.5)
          .setTranslation(sx * (W / 2 - cc / 2), H / 2, sz * (L / 2 - cc / 2))
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      );
    }
  }

  const sideSegW = (W - G.width) / 2;
  for (const sz of [-1, 1]) {
    const zWall = sz * (L / 2 + 0.5);
    for (const sx of [-1, 1]) {
      solid(RAPIER.ColliderDesc.cuboid(sideSegW / 2, H / 2, 0.5).setTranslation(sx * (G.width / 2 + sideSegW / 2), H / 2, zWall));
    }
    solid(RAPIER.ColliderDesc.cuboid(G.width / 2, (H - G.height) / 2, 0.5).setTranslation(0, G.height + (H - G.height) / 2, zWall));
    solid(RAPIER.ColliderDesc.cuboid(G.width / 2 + 1, G.height / 2 + 1, 0.5).setTranslation(0, G.height / 2, sz * (L / 2 + G.depth + 0.5)));
    for (const sx of [-1, 1]) {
      solid(RAPIER.ColliderDesc.cuboid(0.5, G.height / 2, G.depth / 2).setTranslation(sx * (G.width / 2 + 0.5), G.height / 2, sz * (L / 2 + G.depth / 2)));
    }
    solid(RAPIER.ColliderDesc.cuboid(G.width / 2, 0.5, G.depth / 2).setTranslation(0, G.height + 0.5, sz * (L / 2 + G.depth / 2)));

    // sensor near face sits one ball-diameter past the goal line -> fires only on FULL entry
    const near = L / 2 + 2 * R;
    const sensorHalfDepth = (L / 2 + G.depth - 0.4 - near) / 2;
    const team: Team = sz > 0 ? TEAM.BLUE : TEAM.ORANGE;
    const sensor = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(G.width / 2 - 0.2, G.height / 2, sensorHalfDepth)
        .setTranslation(0, G.height / 2, sz * (near + sensorHalfDepth))
        .setSensor(true)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    physics.tag(sensor, { kind: 'goal', team });
  }

  return buildVisuals(scene);
}

// ---------------------------------------------------------------- visuals

function floorTexture(blue: number, orange: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1536;
  const g = c.getContext('2d')!;
  const px = (x: number) => ((x + W / 2) / W) * c.width;
  const pz = (z: number) => ((z + L / 2) / L) * c.height;

  g.fillStyle = '#0c1120';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(80,110,180,0.10)';
  g.lineWidth = 2;
  for (let i = 0; i <= 12; i++) {
    g.beginPath(); g.moveTo((c.width / 12) * i, 0); g.lineTo((c.width / 12) * i, c.height); g.stroke();
  }
  for (let i = 0; i <= 18; i++) {
    g.beginPath(); g.moveTo(0, (c.height / 18) * i); g.lineTo(c.width, (c.height / 18) * i); g.stroke();
  }
  g.strokeStyle = 'rgba(140,190,255,0.55)';
  g.lineWidth = 6;
  g.strokeRect(px(-W / 2 + 1.5), pz(-L / 2 + 1.5), px(W / 2 - 1.5) - px(-W / 2 + 1.5), pz(L / 2 - 1.5) - pz(-L / 2 + 1.5));
  g.beginPath(); g.moveTo(px(-W / 2 + 1.5), pz(0)); g.lineTo(px(W / 2 - 1.5), pz(0)); g.stroke();
  g.beginPath(); g.arc(px(0), pz(0), (10 / W) * c.width, 0, Math.PI * 2); g.stroke();
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  for (const [sz, color] of [[1, hex(blue)], [-1, hex(orange)]] as const) {
    g.strokeStyle = color;
    g.globalAlpha = 0.6;
    const zEdge = pz(sz * (L / 2 - 1.5));
    const zBox = pz(sz * (L / 2 - 12));
    g.strokeRect(px(-G.width / 2 - 3), Math.min(zEdge, zBox), px(G.width / 2 + 3) - px(-G.width / 2 - 3), Math.abs(zBox - zEdge));
    g.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function buildVisuals(scene: THREE.Scene): Arena {
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTexture(TEAM_COLOR[TEAM.BLUE], TEAM_COLOR[TEAM.ORANGE]),
    roughness: 0.85,
    metalness: 0.1,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, L), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const fadeGroups: FadeGroup[] = [];
  const glassMat = () =>
    new THREE.MeshStandardMaterial({
      color: 0x9fc5ff,
      transparent: true,
      opacity: GLASS_BASE,
      roughness: 0.15,
      metalness: 0.1,
      depthWrite: false,
    });

  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    scene.add(m);
    return m;
  };

  // side walls (one shared material per wall so proximity fade is per-panel)
  for (const sx of [-1, 1]) {
    const mat = glassMat();
    addBox(1, H, L, sx * (W / 2 + 0.5), H / 2, 0, 0, mat);
    fadeGroups.push({ mat, distance: (p) => Math.abs(p.x - sx * (W / 2)) });
  }
  // corner panels
  const cc = CONFIG.arena.cornerCut;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const mat = glassMat();
      addBox(cc * Math.SQRT2 * 1.5, H, 1, sx * (W / 2 - cc / 2), H / 2, sz * (L / 2 - cc / 2), sx * sz * Math.PI / 4, mat);
      const corner = new THREE.Vector2(sx * (W / 2 - cc / 2), sz * (L / 2 - cc / 2));
      fadeGroups.push({ mat, distance: (p) => Math.hypot(p.x - corner.x, p.z - corner.y) });
    }
  }

  const trimMat = new THREE.MeshBasicMaterial({ color: 0x35e0ff });
  const sideSegW = (W - G.width) / 2;
  const teamRefs: Record<Team, { frame: THREE.MeshBasicMaterial; glow: THREE.MeshBasicMaterial; zone: THREE.MeshBasicMaterial; light: THREE.PointLight }> = {} as never;

  for (const sz of [-1, 1]) {
    const team: Team = sz > 0 ? TEAM.BLUE : TEAM.ORANGE;
    const color = TEAM_COLOR[team];

    // back wall (goal end) glass, one fade group per end
    const mat = glassMat();
    for (const sx of [-1, 1]) addBox(sideSegW, H, 1, sx * (G.width / 2 + sideSegW / 2), H / 2, sz * (L / 2 + 0.5), 0, mat);
    addBox(G.width, H - G.height, 1, 0, G.height + (H - G.height) / 2, sz * (L / 2 + 0.5), 0, mat);
    // goal cavity panels share the same fade group
    addBox(G.width + 2, G.height + 2, 1, 0, G.height / 2, sz * (L / 2 + G.depth + 0.5), 0, mat);
    for (const sx of [-1, 1]) addBox(1, G.height, G.depth, sx * (G.width / 2 + 0.5), G.height / 2, sz * (L / 2 + G.depth / 2), 0, mat);
    addBox(G.width, 1, G.depth, 0, G.height + 0.5, sz * (L / 2 + G.depth / 2), 0, mat);
    fadeGroups.push({ mat, distance: (p) => Math.abs(p.z - sz * (L / 2)) });

    // glowing goal frame + glow plane + light + floor zone (team-colored, recolorable)
    const frameMat = new THREE.MeshBasicMaterial({ color });
    addBox(G.width + 1.2, 0.6, 0.7, 0, G.height + 0.3, sz * (L / 2), 0, frameMat);
    for (const sx of [-1, 1]) addBox(0.6, G.height + 0.6, 0.7, sx * (G.width / 2 + 0.3), (G.height + 0.6) / 2 - 0.3, sz * (L / 2), 0, frameMat);
    const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(G.width, G.height), glowMat);
    glow.position.set(0, G.height / 2, sz * (L / 2 + G.depth - 0.2));
    scene.add(glow);
    const goalLight = new THREE.PointLight(color, 60, 30);
    goalLight.position.set(0, G.height / 2 + 1, sz * (L / 2 + 1.5));
    scene.add(goalLight);
    const zoneMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false });
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(G.width + 6, 8), zoneMat);
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(0, 0.02, sz * (L / 2 - 4));
    scene.add(zone);
    teamRefs[team] = { frame: frameMat, glow: glowMat, zone: zoneMat, light: goalLight };
  }

  // neon trim along wall tops and floor seams
  for (const sx of [-1, 1]) {
    addBox(0.3, 0.3, L, sx * (W / 2 - 0.05), H - 0.2, 0, 0, trimMat);
    addBox(0.3, 0.3, L, sx * (W / 2 - 0.05), 0.25, 0, 0, trimMat);
  }
  for (const sz of [-1, 1]) {
    addBox(W, 0.3, 0.3, 0, H - 0.2, sz * (L / 2 - 0.05), 0, trimMat);
  }

  return {
    update(dt: number, playerPos: THREE.Vector3) {
      const k = 1 - Math.exp(-8 * dt);
      for (const fg of fadeGroups) {
        const target = fg.distance(playerPos) < FADE_DIST ? FADED : GLASS_BASE;
        fg.mat.opacity += (target - fg.mat.opacity) * k;
      }
    },
    setTeamColors(blue: number, orange: number) {
      floorMat.map = floorTexture(blue, orange);
      floorMat.needsUpdate = true;
      for (const [team, color] of [[TEAM.BLUE, blue], [TEAM.ORANGE, orange]] as const) {
        const refs = teamRefs[team];
        refs.frame.color.setHex(color);
        refs.glow.color.setHex(color);
        refs.zone.color.setHex(color);
        refs.light.color.setHex(color);
      }
    },
  };
}
