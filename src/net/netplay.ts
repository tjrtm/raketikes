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

/**
 * Orchestrates a 1v1 session: streams the local car (and, on the host, the
 * ball + match state), applies incoming snapshots, and routes discrete events
 * (start, kickoff, goal, rematch). See NetSession for the transport.
 */
export class NetPlay {
  readonly session = new NetSession();
  private snapT = 0;
  private matchT = 0;

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

  localCar(): Car { return this.session.isGuest ? this.d.orange : this.d.blue; }
  remoteCar(): Car { return this.session.isGuest ? this.d.blue : this.d.orange; }

  /** Host: (re)start the match and tell the guest. */
  hostStart() {
    this.d.match.startGame('match');
    this.session.send({ t: 'start' });
  }

  /** Guest on the end screen: ask the host for a rematch. */
  requestRematch() {
    this.session.send({ t: 'rematch' });
  }

  broadcastKickoff() {
    if (this.session.isHost) this.session.send({ t: 'kickoff' });
  }

  broadcastGoal(scorer: Team) {
    if (this.session.isHost) this.session.send({ t: 'goal', scorer });
  }

  leave() {
    this.session.close();
  }

  /** Called once per rendered frame; owns all send cadences. */
  update(dt: number) {
    if (!this.active) return;
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
        this.session.send({ t: 'car', s: carSnap(this.localCar()) });
        if (this.session.isHost) this.session.send({ t: 'ball', s: bodySnap(this.d.ball.body) });
      }
    }
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
        if (this.session.isGuest) this.d.onMatchStart();
        break;
      case 'kickoff':
        if (this.session.isGuest) this.d.kickoff();
        break;
      case 'goal':
        if (this.session.isGuest) this.d.onGoalFx(m.scorer as Team);
        break;
      case 'car':
        applyCarSnap(this.remoteCar(), m.s);
        break;
      case 'ball':
        if (this.session.isGuest) applyBodySnap(this.d.ball.body, m.s);
        break;
      case 'match':
        if (this.session.isGuest) this.d.match.netApply(m.s);
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

function applyBodySnap(body: RAPIER.RigidBody, s: BodySnap) {
  body.setTranslation({ x: s.p[0], y: s.p[1], z: s.p[2] }, true);
  body.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, true);
  body.setLinvel({ x: s.v[0], y: s.v[1], z: s.v[2] }, true);
  body.setAngvel({ x: s.w[0], y: s.w[1], z: s.w[2] }, true);
}

function carSnap(car: Car): CarSnap {
  return { ...bodySnap(car.body), boost: car.boost, boosting: car.boosting };
}

function applyCarSnap(car: Car, s: CarSnap) {
  applyBodySnap(car.body, s);
  car.boost = s.boost;
  car.boosting = s.boosting;
}
