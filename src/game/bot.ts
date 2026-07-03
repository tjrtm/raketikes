import * as THREE from 'three';
import { CONFIG } from '../config';
import { S } from './settings';
import { emptyInput, type CarInput } from '../controls/input';
import type { Car } from '../entities/car';
import type { Ball } from '../entities/ball';

const L = CONFIG.arena.length;
const W = CONFIG.arena.width;
const BASIS = CONFIG.basis;

export interface BotLevel {
  think: number;        // seconds between decisions
  jitter: number;       // aim noise (units)
  power: number;        // power-hit impulse factor
  throttle: number;     // top throttle
  boostP: number;       // chance to commit to boost per decision
  jumpP: number;        // chance to jump at aerial balls
  predict: number;      // 0..1 ball-velocity lead
  reaction: [number, number]; // kickoff hesitation range (s)
}

export const BOT_LEVELS: Record<'rookie' | 'pro' | 'allstar', BotLevel> = {
  rookie: { think: 0.3, jitter: 5, power: 0.4, throttle: 0.85, boostP: 0.3, jumpP: 0.12, predict: 0, reaction: [1.2, 2.0] },
  pro: { think: 0.18, jitter: 3, power: 0.55, throttle: 0.93, boostP: 0.55, jumpP: 0.25, predict: 0.6, reaction: [0.7, 1.2] },
  allstar: { think: 0.11, jitter: 1.4, power: 0.8, throttle: 1.0, boostP: 0.8, jumpP: 0.4, predict: 1.0, reaction: [0.3, 0.6] },
};

/**
 * Seek-behind-the-ball bot with difficulty levels (reaction, prediction, power,
 * boost economy) and a layered anti-stuck watchdog:
 *  1. barely moving while trying to drive -> reverse-and-turn escape for ~0.8s
 *  2. still stuck after repeated escapes, or flipped -> safeReset (same as player's R)
 * It attacks the +z (blue) goal and defends -z (orange).
 */
export class Bot {
  private target = new THREE.Vector3();
  private thinkT = 0;
  private reactionT = 0;
  private wantBoost = false;
  private wantJump = false;

  // watchdog
  private lowSpeedT = 0;
  private escapeT = 0;
  private escapeSteer = 1;
  private stuckStrikes = 0;
  private flippedT = 0;

  private tmpDir = new THREE.Vector3();
  private tmpFwd = new THREE.Vector3();
  private tmpRight = new THREE.Vector3();
  private tmpUp = new THREE.Vector3();

  private get level(): BotLevel {
    return BOT_LEVELS[S.botLevel];
  }

  onKickoff() {
    const [lo, hi] = this.level.reaction;
    this.reactionT = lo + Math.random() * (hi - lo);
    this.lowSpeedT = 0;
    this.escapeT = 0;
    this.stuckStrikes = 0;
    this.flippedT = 0;
  }

  update(dt: number, bot: Car, ball: Ball): CarInput {
    if (this.reactionT > 0) {
      this.reactionT -= dt;
      return emptyInput();
    }

    // --- watchdog: flipped/wedged recovery ---
    const up = BASIS.upVector(this.tmpUp).applyQuaternion(bot.quaternion);
    if (BASIS.upComponent(up) < 0.3 && bot.speed < 3) {
      this.flippedT += dt;
      if (this.flippedT > 1.6) {
        bot.safeReset();
        this.flippedT = 0;
        this.stuckStrikes = 0;
      }
    } else {
      this.flippedT = 0;
    }

    // --- watchdog: escape mode when driving but not moving (wedged on wall/car) ---
    if (this.escapeT > 0) {
      this.escapeT -= dt;
      const input = emptyInput();
      input.throttle = -1;
      input.steer = this.escapeSteer;
      return input;
    }
    if (bot.speed < 2) {
      this.lowSpeedT += dt;
      if (this.lowSpeedT > 1.1) {
        this.lowSpeedT = 0;
        this.stuckStrikes++;
        if (this.stuckStrikes >= 3) {
          bot.safeReset();
          this.stuckStrikes = 0;
        } else {
          this.escapeT = 0.8;
          this.escapeSteer = Math.random() < 0.5 ? -1 : 1;
        }
        this.thinkT = 0; // re-plan immediately after recovering
      }
    } else {
      this.lowSpeedT = 0;
      if (bot.speed > 8) this.stuckStrikes = 0;
    }

    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = this.level.think + Math.random() * 0.08;
      this.think(bot, ball);
    }

    const input = emptyInput();
    const pos = bot.position;
    const fwd = BASIS.forwardVector(this.tmpFwd).applyQuaternion(bot.quaternion);
    BASIS.flatten(fwd).normalize();
    const right = BASIS.sideVector(fwd, 1, this.tmpRight).normalize();

    const to = this.tmpDir.copy(this.target).sub(pos);
    BASIS.flatten(to);
    const dist = to.length();
    if (dist > 0.5) to.normalize();

    const fwdComp = to.dot(fwd);
    const rightComp = to.dot(right);
    const angle = Math.atan2(rightComp, fwdComp);

    if (fwdComp < -0.6 && dist < 9) {
      input.throttle = -1;
      input.steer = THREE.MathUtils.clamp(-angle * 1.6, -1, 1);
    } else {
      input.throttle = this.level.throttle;
      input.steer = THREE.MathUtils.clamp(angle * 1.8, -1, 1);
    }

    input.boost = this.wantBoost && Math.abs(angle) < 0.3 && bot.boost > 5;
    if (this.wantJump) {
      input.jumpPressed = true;
      this.wantJump = false;
    }
    return input;
  }

  private think(bot: Car, ball: Ball) {
    const lvl = this.level;
    const botPos = bot.position;

    // lead the ball by its velocity, scaled by distance and skill
    const ballPos = ball.position;
    const bv = ball.body.linvel();
    const dist0 = botPos.distanceTo(ballPos);
    const leadT = THREE.MathUtils.clamp(dist0 / 30, 0, 1.1) * lvl.predict;
    ballPos.x += bv.x * leadT;
    ballPos.z += bv.z * leadT;
    ballPos.x = THREE.MathUtils.clamp(ballPos.x, -W / 2 + 3, W / 2 - 3);
    ballPos.z = THREE.MathUtils.clamp(ballPos.z, -L / 2 + 2, L / 2 - 2);

    // approach point behind the (predicted) ball toward the attacked +z goal
    const attackDir = this.tmpDir.set(0 - ballPos.x, 0, L / 2 - ballPos.z).normalize();
    this.target.copy(ballPos).addScaledVector(attackDir, -(CONFIG.ball.radius + 2.2));
    this.target.x += (Math.random() - 0.5) * lvl.jitter;
    this.target.z += (Math.random() - 0.5) * lvl.jitter * 0.6;

    // ball pinned on a side wall: approach parallel to the wall from our own side,
    // so we dribble it along the wall instead of aiming at a point inside the wall
    if (Math.abs(ballPos.x) > W / 2 - 5) {
      const behind = botPos.z < ballPos.z - 2.5; // on our own side of the ball
      this.target.x = Math.sign(ballPos.x) * (W / 2 - 4.5);
      this.target.z = behind ? ballPos.z + 2 : ballPos.z - 7; // behind -> ram through it up the wall
    }

    // if the ball is behind us (toward our own -z goal), retreat to a save position
    if (ballPos.z < botPos.z - 3) {
      this.target.set(ballPos.x * 0.6, 0, Math.max(-L / 2 + 6, ballPos.z - 9));
    }

    // never aim outside the drivable field
    this.target.x = THREE.MathUtils.clamp(this.target.x, -W / 2 + 3.5, W / 2 - 3.5);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -L / 2 + 2.5, L / 2 - 2.5);

    const dist = botPos.distanceTo(ballPos);
    this.wantBoost = dist > 14 && bot.boost > 15 && Math.random() < lvl.boostP;
    this.wantJump = ballPos.y > 2.6 && dist < 7 && Math.random() < lvl.jumpP;
  }
}
