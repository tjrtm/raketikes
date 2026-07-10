---
name: verify
description: Build, launch, and drive Rocket Arena in a real browser to verify gameplay, rendering, and multiplayer changes end-to-end.
---

# Verifying Rocket Arena

## Build & launch

```sh
npm run build        # type-checks + bundles; also run `npm run size` (gzip budgets)
npm run dev          # Vite dev server, http://localhost:5173
```

## Drive the game (browser automation)

The game exposes a debug handle on `window.__game`:
`physics, ball, player (blue), bot (orange), match, chaseCam, pads, kickoff, menu, arena, effects, input, net, rendering, getEnv(), debugStep(seconds)`.

- `__game.debugStep(s)` advances the simulation deterministically — works even in
  hidden/background tabs where rAF is paused. Use it instead of waiting wall-clock.
- Inputs: dispatch real `KeyboardEvent`s on `window` (`KeyW`, `ShiftLeft`, `Space`, …);
  `input.sample()` reads them like a player.
- Score a goal: `__game.ball.body.setTranslation({x:0,y:2,z:-40},true)` +
  `setLinvel({x:0,y:0,z:-30},true)` then `debugStep(1)` → `match.scores` becomes [1,0].
- Menus are plain DOM under `#menuRoot`; `__game.menu.show('mp'|'settings'|...)`.

## Gotchas

- **Hidden tabs render nothing** (black canvas in screenshots) — the rAF loop is
  paused; sim state is still correct. Force a frame with `__game.rendering.render(0.016)`
  and read pixels, or check state via JS instead of screenshots.
- Chrome throttles hidden-tab timers to ~1 Hz, so the hidden-tab interval fallback
  runs the sim at ~25% speed (dt clamped to 0.25 s). Expected, not a bug.

## Multiplayer (two tabs, real PeerJS cloud broker)

1. Tab A: `__game.menu.show('mp')` → click HOST MATCH → read code from `.mpCode`.
2. Tab B: `__game.net.session.join('CODE')` (or navigate to `/?join=CODE`).
3. Assert: `net.active`, `net.session.snapOpen` (unreliable channel), `match.state`
   mirrors, car/ball positions match across tabs, `net.pingSeconds > 0`.
4. Always test a SECOND host/join on the same page loads (per-session state reset).
5. Disconnect: close one tab → other shows "Opponent disconnected".

## Checklist for gameplay changes (from AGENTS.md)

Scene renders; car drive/jump/boost; ball & arena collisions; goal sensors score
only on full entry; boost pads refill/cool down; HUD updates; pause freezes sim;
mobile layout doesn't overlap; all three stadiums switch cleanly; bloom toggle.
