# Rocket Arena

A browser-based 3D car-soccer game in the spirit of Rocket League. Three.js rendering, Rapier physics, TypeScript, no assets — everything is procedural. Drive a rocket car, boost, jump, flip, and knock a giant ball into the opponent's goal inside a glass-domed stadium.

## Quick start

```sh
npm install
npm run dev
```

Open the printed URL (Vite defaults to `http://localhost:5173`, or `http://127.0.0.1:5173` when run with `--host 127.0.0.1`). `npm run build` produces a static production build in `dist/`.

The game starts directly in a match: the arena, car, ball, HUD, and countdown render immediately. Press `P` or `Esc` for pause/settings; use **Quit to Menu** from pause if you want Solo Practice or a different setup.

## Game modes

- **Play Match** — timed match (default 3:00) against a bot with three difficulty levels. Tied at zero? Overtime, golden goal.
- **Multiplayer 1v1** — play a friend over the internet, peer-to-peer (WebRTC via PeerJS; the free PeerJS cloud broker is used for signaling only — no game server). One player picks **Host Match** and shares the 5-letter room code or the invite link (`…/?join=CODE`); the other joins and the match starts immediately. Host is BLUE, guest is ORANGE; match length uses the host's setting, game speed is locked to 1×, and there is no pause — opening the menu keeps the match running. Each player simulates their own car locally (zero input lag); the host's simulation owns the ball, the clock, and goal decisions.
- **Solo Practice** — no clock, no opponent pressure; the bot parks by its goal while you practice shots on both ends.

## Controls

### Keyboard

| Key | Action |
|---|---|
| W / S (or ↑ / ↓) | Drive forward / reverse — pitch in the air |
| A / D (or ← / →) | Steer — yaw in the air |
| Space | Jump; again in the air for a directional flip / double jump |
| Shift | Boost |
| Ctrl | Powerslide (handbrake) |
| Q / E | Air roll |
| C | Toggle chase cam / ball cam |
| R | Reset car upright |
| P / Esc | Pause menu |
| Enter | Menu select / rematch |

### Gamepad (Rocket League layout, PS symbols — same positions on Xbox)

| Button | Action |
|---|---|
| Left stick | Steer / air pitch & yaw |
| R2 / L2 | Throttle / reverse-brake |
| ✕ (Cross / A) | Jump / flip |
| ◯ (Circle / B) | Boost |
| ▢ (Square / X) | Powerslide; hold in the air to turn stick left/right into air roll |
| △ (Triangle / Y) | Ball-cam toggle |
| L1 / R1 | Explicit air roll |
| Start | Pause |
| Share / Back | Reset car |

Menus are fully navigable with the controller: D-pad or left stick to move focus, ✕/Enter to select, ◯/Esc to go back, left/right to adjust a setting's value.

## Settings

All settings persist in `localStorage` and apply live:

- **Stadium** — Neon City, Deep Orbit, or Dune Sunset (the arena walls are glass; each stadium is a full environment outside the dome)
- **Bot difficulty** — Rookie / Pro / All-Star (reaction time, ball prediction, hit power, boost usage)
- **Match length** — 1 to 5 minutes
- **Game speed** — 0.75x / 1x / 1.25x global time scale
- **Car colors** — separate pickers for you and the bot (recolors cars, goals, trim, HUD)
- **Unlimited boost**, **camera FOV**, **particle effects** toggle

## Multiplayer connectivity (TURN / strict NATs)

Multiplayer is pure P2P: the free PeerJS cloud broker handles signaling, then game
traffic flows directly between the two browsers over WebRTC. Two channels share one
peer connection — a reliable one for events (start, kickoff, goals) and an
unreliable/unordered one for 30 Hz state snapshots, with remote entities rendered
~100 ms in the past and interpolated between snapshots.

Direct connections work for most home networks (STUN), but peer pairs behind
**symmetric/strict NATs** (some mobile carriers, corporate networks) cannot punch
through and need a **TURN relay**. If that's your situation the join screen will say
so explicitly ("your networks likely block P2P") instead of spinning forever.

To add a TURN server, provide standard [RTCIceServer](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/RTCPeerConnection#iceservers) entries at build time:

```sh
VITE_ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:your.relay:443","username":"u","credential":"c"}]' npm run build
```

or at runtime, before hosting/joining: `game.net.session.iceServers = [...]` (the
game object is exposed as `window.__game`). Options:

- **[Metered Open Relay](https://www.metered.ca/tools/openrelay/)** — free 20 GB/month TURN tier; credentials come from a client-side fetch, so it works on a static deployment (GitHub Pages) with no backend.
- **Self-hosted** — run [coturn](https://github.com/coturn/coturn) on any VPS (`turnserver --lt-cred-mech --user=u:c --realm=yourdomain`), and optionally your own [PeerServer](https://github.com/peers/peerjs-server) instead of the cloud broker for signaling.
- **[Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/)** — 1 TB/month free, but minting credentials requires a secret, so you need a tiny worker/backend.

## Project structure

```
src/
  config.ts         all physics & gameplay tuning constants
  main.ts           entry point: wiring, main loop, collision routing
  physics/          Rapier world wrapper, collider tags, raycasts
  rendering/        renderer/lights, spring-damped chase camera
  entities/         arena + goal sensors, car, ball, boost pads, environments, particles
  controls/         merged keyboard + gamepad input
  game/             match state machine, bot AI, settings store
  gameblocks/       TypeScript ports of selected GameBlocks basis/smoothing modules
  ui/               HUD and menu system
```

## License

Dual-licensed under the **WTFPL** and the **MIT License** — use whichever you prefer, no attribution required. See [LICENSE](LICENSE).
