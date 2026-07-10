import type { Peer, DataConnection } from 'peerjs';

/**
 * P2P session over WebRTC (PeerJS cloud broker for signaling only).
 * Host-authoritative ball & match; each peer simulates its own car locally
 * and streams state snapshots — see docs on issue #2 for the authority model.
 *
 * Two channels ride one RTCPeerConnection:
 *  - the PeerJS DataConnection (reliable, ordered) for discrete events
 *  - a raw "snap" RTCDataChannel ({ordered:false, maxRetransmits:0}) for
 *    car/ball/match snapshots, so a lost packet never stalls newer state
 *    (PeerJS's own `reliable:false` only sets ordered:false — it still
 *    retransmits — hence the raw channel; DCEP negotiates it in-band with
 *    no extra ICE round). Falls back to the reliable channel if it never
 *    opens (sequence numbers make stale snaps harmless either way).
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
  | { t: 'car'; seq: number; at: number; s: CarSnap }   // both directions: sender's own car
  | { t: 'ball'; seq: number; at: number; s: BodySnap } // host -> guest
  | { t: 'match'; s: MatchSnap }         // host -> guest
  | { t: 'ping'; id: number; at: number }               // both directions, reliable
  | { t: 'pong'; id: number; at: number; echo: number } // reply with sender clock
  | { t: 'rematch' }                     // guest -> host: requests restart
  | { t: 'bye' };

export type NetRole = 'none' | 'host' | 'guest';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const PEER_PREFIX = 'rocket-arena-v1-';
const SNAP_CHANNEL = 'snap';
const CONNECT_TIMEOUT_MS = 20000;

function randomCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

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
    return this.iceServers ? { config: { iceServers: this.iceServers } } : {};
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
    this.connectTimer = setTimeout(() => {
      if (!this.conn?.open && !this.closedByUs) this.fail(ICE_FAIL_TEXT);
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
    conn.on('open', () => {
      this.clearConnectTimeout();
      this.setupSnapChannel(conn);
      this.onConnected?.();
    });
    // distinct ICE failure (networks block P2P) vs. "room not found" (peer-unavailable)
    conn.on('iceStateChanged', (state) => {
      if (state === 'failed' && !this.closedByUs) this.fail(ICE_FAIL_TEXT);
    });
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

  /**
   * Unreliable snapshot channel over the already-established peer connection.
   * The guest (dialer) creates it; the host accepts via ondatachannel.
   */
  private setupSnapChannel(conn: DataConnection) {
    const pc = conn.peerConnection;
    if (!pc) return;
    try {
      if (this.isGuest) {
        this.wireSnap(pc.createDataChannel(SNAP_CHANNEL, { ordered: false, maxRetransmits: 0 }));
      } else {
        pc.addEventListener('datachannel', (e) => {
          if (e.channel.label === SNAP_CHANNEL) this.wireSnap(e.channel);
        });
      }
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
