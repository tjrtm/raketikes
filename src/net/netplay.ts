import * as THREE from 'three';
import type { Car } from '../entities/car';
import type { Ball } from '../entities/ball';
import type { Match } from '../game/match';
import type { Team } from '../config';
import {
  NetSession, PROTOCOL_VERSION,
  type BodySnap, type CarSnap, type NetMsg, type Q4, type V3,
} from './session';
import { S } from '../game/settings';
import type { RAPIER } from '../physics/world';

const SNAP_INTERVAL = 1 / 30;  // car & ball state
const MATCH_INTERVAL = 0.1;    // clock / score / state
const PING_INTERVAL = 1.0;     // clock-offset ping cadence
const INTERP_DELAY = 0.1;      // render remote entities this far in the past
const MAX_EXTRAPOLATE = 0.25;  // buffer underrun: velocity-extrapolate at most this far
const BUFFER_KEEP = 1.0;       // seconds of snapshot history to retain

export interface NetPlayDeps {
  blue: Car;    // host's car
  orange: Car;  // guest's car
  ball: Ball;
  match: Match;
  kickoff(): void;
  onGoalFx(scorer: Team): void;
  /** Host side: a guest connected — start the match. */
  onOpponentJoined(): void;
  /** Guest side: host started (or restarted) the match. */
  onMatchStart(): void;
  onDisconnected(): void;
  onError(text: string): void;
}

const now = () => performance.now() / 1000;

/**
 * Snapshot history for one remote-driven body. Snapshots are timestamped with
 * the SENDER's clock; sample() is queried with a sender-timeline time, so the
 * buffer itself never needs to know the clock offset.
 */
class SnapBuffer<T extends BodySnap> {
  private items: Array<{ at: number; s: T }> = [];
  private lastSeq = -1;

  push(seq: number, at: number, s: T) {
    if (seq <= this.lastSeq) return; // stale or duplicate (unreliable channel)
    this.lastSeq = seq;
    this.items.push({ at, s });
    // out-of-order arrival is already excluded by the seq check, so items stay sorted
    const newest = this.items[this.items.length - 1].at;
    while (this.items.length > 2 && this.items[0].at < newest - BUFFER_KEEP) this.items.shift();
  }

  clear() {
    this.items.length = 0; // lastSeq survives: sender sequence is monotonic per session
  }

  get newest(): { at: number; s: T } | null {
    return this.items.length ? this.items[this.items.length - 1] : null;
  }

  /**
   * Interpolated state at sender-time t, or an extrapolation descriptor when
   * t is ahead of the newest snapshot. Returns null with an empty buffer.
   */
  sample(t: number): { a: T; b: T; alpha: number } | { a: T; extrapolate: number } | null {
    const n = this.items.length;
    if (n === 0) return null;
    const newest = this.items[n - 1];
    if (t >= newest.at) {
      return { a: newest.s, extrapolate: Math.min(t - newest.at, MAX_EXTRAPOLATE) };
    }
    for (let i = n - 1; i > 0; i--) {
      const s0 = this.items[i - 1];
      const s1 = this.items[i];
      if (t >= s0.at) {
        const span = s1.at - s0.at;
        const alpha = span > 1e-6 ? (t - s0.at) / span : 1;
        return { a: s0.s, b: s1.s, alpha };
      }
    }
    return { a: this.items[0].s, b: this.items[0].s, alpha: 0 };
  }
}

/** Clock-offset estimate (sender clock − local clock) from ping/pong pairs. */
class ClockSync {
  private offset = 0;
  private bestRtt = Infinity;
  private hasEstimate = false;
  rtt = 0;

  get oneWay(): number { return this.rtt / 2; }

  /** Fallback init from a snapshot's timestamp (assumes zero transit time). */
  seed(senderAt: number) {
    if (!this.hasEstimate) {
      this.offset = senderAt - now();
      this.hasEstimate = true;
    }
  }

  onPong(remoteAt: number, echoedLocalAt: number) {
    const t = now();
    const rtt = Math.max(0, t - echoedLocalAt);
    this.rtt = this.rtt === 0 ? rtt : this.rtt * 0.8 + rtt * 0.2;
    const sample = remoteAt + rtt / 2 - t;
    // prefer low-RTT samples: they bound the true offset most tightly
    if (!this.hasEstimate || rtt <= this.bestRtt * 1.5) {
      this.offset = this.hasEstimate ? this.offset * 0.7 + sample * 0.3 : sample;
      this.bestRtt = Math.min(this.bestRtt, rtt);
      this.hasEstimate = true;
    }
  }

  /** Current time on the sender's clock timeline. */
  senderNow(): number {
    return now() + this.offset;
  }
}

/**
 * Orchestrates a 1v1 session: streams the local car (and, on the host, the
 * ball + match state) over the unreliable snap channel, buffers incoming
 * snapshots, and renders remote entities ~100 ms in the past with
 * interpolation (velocity extrapolation on underrun). Discrete events
 * (start, kickoff, goal, rematch) stay on the reliable channel.
 */
export class NetPlay {
  readonly session = new NetSession();
  private snapT = 0;
  private matchT = 0;
  private pingT = 0;
  private seq = 0;
  private pingId = 0;

  private carBuf = new SnapBuffer<CarSnap>();
  private ballBuf = new SnapBuffer<BodySnap>();
  private clock = new ClockSync();

  private tmpV = new THREE.Vector3();
  private tmpQ0 = new THREE.Quaternion();
  private tmpQ1 = new THREE.Quaternion();

  constructor(private d: NetPlayDeps) {
    this.session.onConnected = () => {
      if (this.session.isHost) {
        this.session.send({ t: 'welcome', v: PROTOCOL_VERSION, matchLength: S.matchLength });
        this.d.onOpponentJoined();
      } else {
        this.session.send({ t: 'hello', v: PROTOCOL_VERSION });
      }
    };
    this.session.onMessage = (m) => this.handle(m);
    this.session.onDisconnected = () => this.d.onDisconnected();
    this.session.onError = (text) => this.d.onError(text);
  }

  get active(): boolean { return this.session.active; }
  get isHost(): boolean { return this.session.isHost; }
  get isGuest(): boolean { return this.session.isGuest; }
  /** Smoothed round-trip time (s) — 0 until the first pong. */
  get pingSeconds(): number { return this.clock.rtt; }

  localCar(): Car { return this.session.isGuest ? this.d.orange : this.d.blue; }
  remoteCar(): Car { return this.session.isGuest ? this.d.blue : this.d.orange; }

  /** Host: (re)start the match and tell the guest. */
  hostStart() {
    this.clearBuffers();
    this.d.match.startGame('match');
    this.session.send({ t: 'start' });
  }

  /** Guest on the end screen: ask the host for a rematch. */
  requestRematch() {
    this.session.send({ t: 'rematch' });
  }

  broadcastKickoff() {
    if (this.session.isHost) {
      this.clearBuffers();
      this.session.send({ t: 'kickoff' });
    }
  }

  broadcastGoal(scorer: Team) {
    if (this.session.isHost) this.session.send({ t: 'goal', scorer });
  }

  leave() {
    this.session.close();
  }

  private clearBuffers() {
    this.carBuf.clear();
    this.ballBuf.clear();
  }

  /** Called once per rendered frame; owns all send cadences + remote interpolation. */
  update(dt: number) {
    if (!this.active) return;

    this.pingT += dt;
    if (this.pingT >= PING_INTERVAL) {
      this.pingT = 0;
      this.session.send({ t: 'ping', id: ++this.pingId, at: now() });
    }

    if (this.session.isHost) {
      this.matchT += dt;
      if (this.matchT >= MATCH_INTERVAL) {
        this.matchT = 0;
        this.session.send({ t: 'match', s: this.d.match.snapshot() });
      }
    }

    const st = this.d.match.state;
    if (st === 'playing' || st === 'goal') {
      this.snapT += dt;
      if (this.snapT >= SNAP_INTERVAL) {
        this.snapT = 0;
        const at = now();
        this.session.sendSnap({ t: 'car', seq: ++this.seq, at, s: carSnap(this.localCar()) });
        if (this.session.isHost) {
          this.session.sendSnap({ t: 'ball', seq: this.seq, at, s: bodySnap(this.d.ball.body) });
        }
      }
      // render remote entities slightly in the past, interpolating between snaps
      const t = this.clock.senderNow() - INTERP_DELAY;
      this.applyBuffered(this.carBuf, this.remoteCar().body, t);
      const newestCar = this.carBuf.newest;
      if (newestCar) {
        this.remoteCar().boost = newestCar.s.boost;
        this.remoteCar().boosting = newestCar.s.boosting;
      }
      if (this.session.isGuest) this.applyBuffered(this.ballBuf, this.d.ball.body, t);
    }
  }

  private applyBuffered(buf: SnapBuffer<BodySnap>, body: RAPIER.RigidBody, t: number) {
    const r = buf.sample(t);
    if (!r) return;
    if ('extrapolate' in r) {
      const s = r.a;
      const dtx = r.extrapolate;
      body.setTranslation({ x: s.p[0] + s.v[0] * dtx, y: s.p[1] + s.v[1] * dtx, z: s.p[2] + s.v[2] * dtx }, true);
      body.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, true);
      body.setLinvel({ x: s.v[0], y: s.v[1], z: s.v[2] }, true);
      body.setAngvel({ x: s.w[0], y: s.w[1], z: s.w[2] }, true);
      return;
    }
    const { a, b, alpha } = r;
    const p = this.tmpV.set(
      a.p[0] + (b.p[0] - a.p[0]) * alpha,
      a.p[1] + (b.p[1] - a.p[1]) * alpha,
      a.p[2] + (b.p[2] - a.p[2]) * alpha,
    );
    body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.tmpQ0.set(a.q[0], a.q[1], a.q[2], a.q[3]);
    this.tmpQ1.set(b.q[0], b.q[1], b.q[2], b.q[3]);
    this.tmpQ0.slerp(this.tmpQ1, alpha);
    body.setRotation({ x: this.tmpQ0.x, y: this.tmpQ0.y, z: this.tmpQ0.z, w: this.tmpQ0.w }, true);
    body.setLinvel({
      x: a.v[0] + (b.v[0] - a.v[0]) * alpha,
      y: a.v[1] + (b.v[1] - a.v[1]) * alpha,
      z: a.v[2] + (b.v[2] - a.v[2]) * alpha,
    }, true);
    body.setAngvel({
      x: a.w[0] + (b.w[0] - a.w[0]) * alpha,
      y: a.w[1] + (b.w[1] - a.w[1]) * alpha,
      z: a.w[2] + (b.w[2] - a.w[2]) * alpha,
    }, true);
  }

  private handle(m: NetMsg) {
    switch (m.t) {
      case 'hello':
        if (m.v !== PROTOCOL_VERSION) this.versionMismatch();
        break;
      case 'welcome':
        if (m.v !== PROTOCOL_VERSION) this.versionMismatch();
        break;
      case 'start':
        if (this.session.isGuest) {
          this.clearBuffers();
          this.d.onMatchStart();
        }
        break;
      case 'kickoff':
        if (this.session.isGuest) {
          this.clearBuffers();
          this.d.kickoff();
        }
        break;
      case 'goal':
        if (this.session.isGuest) this.d.onGoalFx(m.scorer as Team);
        break;
      case 'car':
        this.clock.seed(m.at);
        this.carBuf.push(m.seq, m.at, m.s);
        break;
      case 'ball':
        if (this.session.isGuest) {
          this.clock.seed(m.at);
          this.ballBuf.push(m.seq, m.at, m.s);
        }
        break;
      case 'match':
        if (this.session.isGuest) this.d.match.netApply(m.s, this.clock.oneWay);
        break;
      case 'ping':
        this.session.send({ t: 'pong', id: m.id, at: now(), echo: m.at });
        break;
      case 'pong':
        this.clock.onPong(m.at, m.echo);
        break;
      case 'rematch':
        if (this.session.isHost && this.d.match.state === 'ended') this.hostStart();
        break;
      case 'bye':
        this.session.close();
        this.d.onDisconnected();
        break;
    }
  }

  private versionMismatch() {
    this.session.close();
    this.d.onError('Version mismatch — both players should refresh the page');
  }
}

// ---------------------------------------------------------------- snapshots

function bodySnap(body: RAPIER.RigidBody): BodySnap {
  const p = body.translation();
  const q = body.rotation();
  const v = body.linvel();
  const w = body.angvel();
  return {
    p: [p.x, p.y, p.z] as V3,
    q: [q.x, q.y, q.z, q.w] as Q4,
    v: [v.x, v.y, v.z] as V3,
    w: [w.x, w.y, w.z] as V3,
  };
}

function carSnap(car: Car): CarSnap {
  return { ...bodySnap(car.body), boost: car.boost, boosting: car.boosting };
}
