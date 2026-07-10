import type { Peer, DataConnection } from 'peerjs';

/**
 * P2P session over WebRTC (PeerJS cloud broker for signaling only).
 * Host-authoritative ball & match; each peer simulates its own car locally
 * and streams state snapshots — see docs on issue #2 for the authority model.
 *
 * Two channels ride one RTCPeerConnection:
 *  - the PeerJS DataConnection (reliable, ordered) for discrete events
 *  - a raw "snap" RTCDataChannel ({ordered:false, maxRetransmits:0}) for
 *    car/ball snapshots, so a lost packet never stalls newer state
 *    (PeerJS's own `reliable:false` only sets ordered:false — it still
 *    retransmits — hence the raw channel, negotiated out-of-band on a
 *    fixed stream id over the same peer connection, no extra ICE round).
 *    Falls back to the reliable channel if it never opens (sequence
 *    numbers make stale snaps harmless either way).
 *
 * PeerJS itself is dynamically imported so the ~50 kB library is only
 * fetched when multiplayer is actually used.
 */

export const PROTOCOL_VERSION = 2;

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
  | { t: 'car'; seq: number; at: number; e: number; s: CarSnap }   // both directions: sender's own car
  | { t: 'ball'; seq: number; at: number; e: number; s: BodySnap } // host -> guest; e = kickoff epoch
  | { t: 'match'; s: MatchSnap }         // host -> guest
  | { t: 'ping'; id: number; at: number }               // both directions, reliable
  | { t: 'pong'; id: number; at: number; echo: number } // reply with sender clock
  | { t: 'rematch' }                     // guest -> host: requests restart
  | { t: 'bye' };

export type NetRole = 'none' | 'host' | 'guest';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const PEER_PREFIX = 'rocket-arena-v1-';
const SNAP_CHANNEL = 'snap';
const SNAP_CHANNEL_ID = 100; // fixed stream id, clear of PeerJS's in-band ids
const CONNECT_TIMEOUT_MS = 20000;

function randomCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Always kept in the ICE config so custom TURN entries EXTEND rather than
// replace STUN (passing `config` to PeerJS wholly overrides its default).
const DEFAULT_ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
];

/**
 * ICE servers used for NAT traversal. The default is STUN-only (via the
 * PeerJS broker), which fails for peer pairs behind symmetric/strict NATs.
 * Deployments can add a TURN relay either at build time:
 *   VITE_ICE_SERVERS='[{"urls":"turn:relay.example.com:443","username":"u","credential":"c"}]'
 * or at runtime before hosting/joining by assigning `session.iceServers`.
 * See README "Multiplayer connectivity" for free TURN options.
 */
export function envIceServers(): RTCIceServer[] | null {
  const raw = import.meta.env?.VITE_ICE_SERVERS as string | undefined;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RTCIceServer[]) : null;
  } catch {
    console.warn('VITE_ICE_SERVERS is not valid JSON — ignoring');
    return null;
  }
}

export class NetSession {
  role: NetRole = 'none';
  code = '';
  /** Extra/override ICE servers (STUN/TURN). Set before host()/join(). */
  iceServers: RTCIceServer[] | null = envIceServers();

  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private snap: RTCDataChannel | null = null;
  private closedByUs = false;
  private gen = 0; // invalidates async work from a previous host()/join()
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

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
  /** True while snapshots ride the unreliable channel (falls back to reliable). */
  get snapOpen(): boolean {
    return this.snap !== null && this.snap.readyState === 'open';
  }

  private peerOptions() {
    return this.iceServers ? { config: { iceServers: [...DEFAULT_ICE, ...this.iceServers] } } : {};
  }

  /** Open a room and wait for one guest. */
  host() {
    this.close();
    this.closedByUs = false;
    this.role = 'host';
    this.code = randomCode();
    const gen = ++this.gen;
    void import('peerjs').then(({ Peer }) => {
      if (gen !== this.gen || this.closedByUs) return;
      this.peer = new Peer(PEER_PREFIX + this.code, this.peerOptions());
      this.peer.on('error', (err) => this.fail(describePeerError(err)));
      this.peer.on('open', () => this.onHostReady?.());
      this.peer.on('connection', (conn) => {
        if (this.conn) { conn.close(); return; } // room is full: 1v1 only
        this.wire(conn);
        this.armConnectTimeout(); // a joiner whose ICE stalls must not wedge the room
      });
    }).catch(() => this.fail('Failed to load the multiplayer module — check your connection'));
  }

  /** Join an existing room by code. */
  join(rawCode: string) {
    this.close();
    this.closedByUs = false;
    this.role = 'guest';
    this.code = normalizeCode(rawCode);
    const gen = ++this.gen;
    void import('peerjs').then(({ Peer }) => {
      if (gen !== this.gen || this.closedByUs) return;
      this.peer = new Peer(this.peerOptions());
      this.peer.on('error', (err) => this.fail(describePeerError(err)));
      this.peer.on('open', () => {
        if (gen !== this.gen || this.closedByUs) return;
        const conn = this.peer!.connect(PEER_PREFIX + this.code, { reliable: true });
        this.wire(conn);
        this.armConnectTimeout();
      });
    }).catch(() => this.fail('Failed to load the multiplayer module — check your connection'));
  }

  /** If ICE never completes we'd otherwise spin forever on "CONNECTING…". */
  private armConnectTimeout() {
    this.clearConnectTimeout();
    const conn = this.conn;
    this.connectTimer = setTimeout(() => {
      if (this.closedByUs || this.conn?.open) return;
      this.dropPendingConn(conn ?? this.conn);
    }, CONNECT_TIMEOUT_MS);
  }

  private clearConnectTimeout() {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private wire(conn: DataConnection) {
    this.conn = conn;
    let opened = false;
    conn.on('open', () => {
      opened = true;
      this.clearConnectTimeout();
      this.setupSnapChannel(conn);
      this.onConnected?.();
    });
    // A connection that dies BEFORE opening is an ICE/negotiation failure
    // (networks blocking P2P) — distinct from a mid-match drop. PeerJS emits
    // 'error' + 'close' for these; 'iceStateChanged' is kept as a backstop.
    const dead = () => {
      if (this.closedByUs || this.conn !== conn) return;
      if (opened) {
        this.teardown();
        this.onDisconnected?.();
      } else if (this.isHost) {
        this.dropPendingConn(conn); // keep the room open for the next joiner
      } else {
        this.fail(ICE_FAIL_TEXT);
      }
    };
    conn.on('close', dead);
    conn.on('error', dead);
    conn.on('iceStateChanged', (state) => {
      if (state === 'failed') dead();
    });
    conn.on('data', (data) => {
      const msg = data as NetMsg;
      if (msg && typeof msg === 'object' && 't' in msg) this.onMessage?.(msg);
    });
  }

  /** Host: discard a joiner that never finished connecting; the room stays up. */
  private dropPendingConn(conn: DataConnection | null) {
    this.clearConnectTimeout();
    if (this.isHost) {
      if (conn && this.conn === conn) {
        this.conn = null;
        this.snap = null;
        try { conn.close(); } catch { /* never opened */ }
      }
    } else {
      this.fail(ICE_FAIL_TEXT);
    }
  }

  /**
   * Unreliable snapshot channel over the already-established peer connection.
   * MUST be `negotiated` with a fixed id: an in-band (DCEP) channel fires
   * ondatachannel on the remote, where PeerJS's negotiator adopts it as the
   * DataConnection's own channel — silently rerouting all "reliable" sends
   * onto it (verified in-browser). Negotiated channels are invisible to
   * PeerJS; both sides just create the same stream id.
   */
  private setupSnapChannel(conn: DataConnection) {
    const pc = conn.peerConnection;
    if (!pc) return;
    try {
      this.wireSnap(pc.createDataChannel(SNAP_CHANNEL, {
        negotiated: true, id: SNAP_CHANNEL_ID, ordered: false, maxRetransmits: 0,
      }));
    } catch {
      this.snap = null; // snapshots fall back to the reliable channel
    }
  }

  private wireSnap(ch: RTCDataChannel) {
    this.snap = ch;
    ch.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      try {
        const msg = JSON.parse(e.data) as NetMsg;
        if (msg && typeof msg === 'object' && 't' in msg) this.onMessage?.(msg);
      } catch { /* corrupt packet — unreliable channel, just drop it */ }
    };
    ch.onerror = () => { this.snap = null; };
    ch.onclose = () => { this.snap = null; };
  }

  send(msg: NetMsg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  /** Send on the unreliable channel when open, else the reliable one. */
  sendSnap(msg: NetMsg) {
    if (this.snapOpen) {
      try {
        this.snap!.send(JSON.stringify(msg));
        return;
      } catch { /* channel died mid-send — fall through to reliable */ }
    }
    this.send(msg);
  }

  private fail(text: string) {
    if (this.closedByUs) return;
    this.teardown();
    this.onError?.(text);
  }

  private teardown() {
    this.clearConnectTimeout();
    this.snap = null;
    this.conn = null;
    this.peer?.destroy();
    this.peer = null;
    this.role = 'none';
  }

  /** Leave the session quietly (no onDisconnected on our side). */
  close() {
    this.closedByUs = true;
    this.gen++;
    if (this.conn?.open) {
      try { this.conn.send({ t: 'bye' } satisfies NetMsg); } catch { /* already gone */ }
    }
    this.teardown();
  }
}

const ICE_FAIL_TEXT =
  'Connected to the matchmaker, but a direct peer link could not be established — '
  + 'your networks likely block P2P (strict NAT). A TURN relay fixes this; see the README.';

function describePeerError(err: { type?: string }): string {
  switch (err.type) {
    case 'peer-unavailable': return 'No match found for that code';
    case 'unavailable-id': return 'Room code collision — try hosting again';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'Cannot reach the matchmaking server — check your connection';
    case 'browser-incompatible': return 'This browser does not support WebRTC';
    case 'webrtc': return ICE_FAIL_TEXT;
    default: return 'Connection failed';
  }
}
