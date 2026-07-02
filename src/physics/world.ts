import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config';

export { RAPIER };

export type Tag =
  | { kind: 'ball' }
  | { kind: 'car'; car: unknown }
  | { kind: 'goal'; team: number }   // team whose goal this is (scoring team = other)
  | { kind: 'pad'; index: number }
  | { kind: 'arena' };

export type CollisionHandler = (a: Tag | undefined, b: Tag | undefined, started: boolean) => void;

export class Physics {
  world: RAPIER.World;
  private events: RAPIER.EventQueue;
  private tags = new Map<number, Tag>();

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: CONFIG.gravity, z: 0 });
    this.world.timestep = CONFIG.step;
    this.events = new RAPIER.EventQueue(true);
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  tag(collider: RAPIER.Collider, tag: Tag) {
    this.tags.set(collider.handle, tag);
  }

  step(onCollision: CollisionHandler) {
    this.world.step(this.events);
    this.events.drainCollisionEvents((h1, h2, started) => {
      onCollision(this.tags.get(h1), this.tags.get(h2), started);
    });
  }

  /** Distance to first hit along dir, or null. Excludes the given body (for ground checks). */
  rayDistance(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxLen: number,
    exclude?: RAPIER.RigidBody,
  ): number | null {
    const hit = this.world.castRay(new RAPIER.Ray(origin, dir), maxLen, true, undefined, undefined, undefined, exclude);
    if (!hit) return null;
    // property renamed across rapier versions
    return (hit as { timeOfImpact?: number; toi?: number }).timeOfImpact ?? (hit as { toi?: number }).toi ?? null;
  }
}
