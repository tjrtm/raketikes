import { Peer, type DataConnection } from 'peerjs';

/**
 * P2P session over WebRTC (PeerJS cloud broker for signaling only).
 * Host-authoritative ball & match; each peer simulates its own car locally
 * and streams state snapshots — see docs on issue #2 for the authority model.
 */

export const PROTOCOL_VERSION = 1;

// [x, y, z] and [x, y, z, w] tuples keep snapshot JSON compact
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

export interface BodySnap {
  p: V3;   // position
  q: Q4;   // rotation
  v: V3;   // linear velocity
  w: V3;   // angular velocity
}

export interface CarSnap extends BodySnap {
  boost: number;
  boosting: boolean;
}

export interface MatchSnap {
  state: string;          // GameState of the host's match
  scores: [number, number];
  timeLeft: number;
  overtime: boolean;
  countdown: number;
  lastScorer: number;
}

export type NetMsg =
  | { t: 'hello'; v: number }
  | { t: 'welcome'; v: number; matchLength: number }
  | { t: 'start' }                       // host -> guest: (re)start the match
  | { t: 'kickoff' }                     // host -> guest: reset cars & ball
  | { t: 'goal'; scorer: number }
  | { t: 'car'; s: CarSnap }             // both directions: sender's own car
  | { t: 'ball'; s: BodySnap }           // host -> guest
  | { t: 'match'; s: MatchSnap }         // host -> guest
  | { t: 'rematch' }                     // guest -> host: requests restart
  | { t: 'bye' };

export type NetRole = 'none' | 'host' | 'guest';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const PEER_PREFIX = 'rocket-arena-v1-';

function randomCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export class NetSession {
  role: NetRole = 'none';
  code = '';
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private closedByUs = false;

  onMessage?: (msg: NetMsg) => void;
  /** Host only: the broker registered the room — the code is now joinable. */
  onHostReady?: () => void;
  /** Fires once when the data channel is open on both sides. */
  onConnected?: () => void;
  /** Fires when the connection drops or the peer leaves (not on our own close()). */
  onDisconnected?: () => void;
  onError?: (text: string) => void;

  get active(): boolean {
    return this.role !== 'none' && this.conn !== null && this.conn.open;
  }
  get isHost(): boolean {
    return this.role === 'host';
  }
  get isGuest(): boolean {
    return this.role === 'guest';
  }

  /** Open a room and wait for one guest. */
  host() {
    this.close();
    this.closedByUs = false;
    this.role = 'host';
    this.code = randomCode();
    this.peer = new Peer(PEER_PREFIX + this.code);
    this.peer.on('error', (err) => this.fail(describePeerError(err)));
    this.peer.on('open', () => this.onHostReady?.());
    this.peer.on('connection', (conn) => {
      if (this.conn) { conn.close(); return; } // room is full: 1v1 only
      this.wire(conn);
    });
  }

  /** Join an existing room by code. */
  join(rawCode: string) {
    this.close();
    this.closedByUs = false;
    this.role = 'guest';
    this.code = normalizeCode(rawCode);
    this.peer = new Peer();
    this.peer.on('error', (err) => this.fail(describePeerError(err)));
    this.peer.on('open', () => {
      const conn = this.peer!.connect(PEER_PREFIX + this.code, { reliable: true });
      this.wire(conn);
    });
  }

  private wire(conn: DataConnection) {
    this.conn = conn;
    conn.on('open', () => this.onConnected?.());
    conn.on('data', (data) => {
      const msg = data as NetMsg;
      if (msg && typeof msg === 'object' && 't' in msg) this.onMessage?.(msg);
    });
    conn.on('close', () => {
      if (!this.closedByUs) {
        this.teardown();
        this.onDisconnected?.();
      }
    });
    conn.on('error', () => {
      if (!this.closedByUs) {
        this.teardown();
        this.onDisconnected?.();
      }
    });
  }

  send(msg: NetMsg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  private fail(text: string) {
    if (this.closedByUs) return;
    this.teardown();
    this.onError?.(text);
  }

  private teardown() {
    this.conn = null;
    this.peer?.destroy();
    this.peer = null;
    this.role = 'none';
  }

  /** Leave the session quietly (no onDisconnected on our side). */
  close() {
    this.closedByUs = true;
    if (this.conn?.open) {
      try { this.conn.send({ t: 'bye' } satisfies NetMsg); } catch { /* already gone */ }
    }
    this.teardown();
  }
}

function describePeerError(err: { type?: string }): string {
  switch (err.type) {
    case 'peer-unavailable': return 'No match found for that code';
    case 'unavailable-id': return 'Room code collision — try hosting again';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'Cannot reach the matchmaking server — check your connection';
    case 'browser-incompatible': return 'This browser does not support WebRTC';
    default: return 'Connection failed';
  }
}
