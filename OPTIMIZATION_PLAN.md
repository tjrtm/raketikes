# Rocket Arena — Optimization Plan & Results

This document records the performance/correctness audit of the codebase, the changes
that were **implemented** (with rationale and verification), and the follow-up items
that were deliberately **deferred** (with reasons) so the game stays shippable.

The game already runs a tight fixed-step loop at 60 Hz with sensible budget checks
(`scripts/check-size.mjs`), so the wins below are about **reducing per-frame garbage
and DOM churn** rather than rewriting the architecture. All changes are additive and
behavior-preserving.

---

## 1. Implemented

### 1.1 HUD DOM-write guarding — `src/ui/hud.ts`

**Problem.** `Match.update()` runs every rendered frame and unconditionally calls
`hud.setScore()`, `hud.setTimer()`, and (from the main loop) `hud.setBoost()`. Each of
those writes `textContent`, `style.width`, and `classList` even when the value is
unchanged — the timer string `"3:00"` was being re-assigned ~60×/second, and the boost
bar width was re-set every frame. Mutating the DOM on every tick forces the browser to
re-validate style/layout/paint even when nothing visually changed.

**Fix.** Each setter now caches its last value and only touches the DOM on an actual
change:

- `setScore` — guards the blue and orange `textContent` writes independently.
- `setTimer` — only rewrites the string when the text differs; only toggles the
  `overtime` class when that state flips.
- `setBoost` — only rewrites the number and bar width when the rounded boost value changes.

**Impact.** Eliminates the highest-frequency DOM mutations in the render loop. The
timer now writes once per second instead of once per frame; the boost meter writes only
when the value actually moves. No visual change.

**Verification.** HUD renders `3:00` / `0-0` correctly in a headless-browser smoke test.

---

### 1.2 Cached `position` / `quaternion` getters — `src/entities/car.ts`, `src/entities/ball.ts`

**Problem.** `Car.position` and `Car.quaternion` (and `Ball.position`) allocated a fresh
`THREE.Vector3` / `THREE.Quaternion` on **every** call. They are read several times per
frame from the hot paths — camera (`chaseCam.update`), arena fade, bot AI, and the
collision handler — so each frame allocated a handful of short-lived objects purely for
garbage collection to reclaim.

**Fix.** The getters now write into reused instance fields (`_pos`, `_quat`, `_vel`) and
return them. Because the returned object is transient, the two places that *mutated* the
old freshly-allocated result were made explicit:

- `main.ts` `powerHit` — the burst origin is copied into a `tmpBurst` temp before
  `addScaledVector`, instead of mutating `ball.position` in place.
- `bot.ts` `think` — the predicted ball position is copied into a `tmpBall` temp before
  applying the velocity lead, instead of mutating `ball.position`.

**Impact.** Removes per-frame vector/quaternion allocations from the camera, bot, and
collision paths (GC pressure → smoother frame pacing on weak CPUs). Behavior identical.

**Verification.** Full drive test in headless Chrome: the local car falls onto the
pitch, is `grounded === true`, drives forward on `W` (z `28 → 18.4`, speed `18.3`), and
the ball rests at `y ≈ 1.5`. No aliasing/mutation regressions.

---

### 1.3 Reused physics ray — `src/physics/world.ts`

**Problem.** `Physics.rayDistance()` (the ground/self-right probe) allocated a
`new RAPIER.Ray(...)` on every call — up to twice per car per physics tick.

**Fix.** A single `RAPIER.Ray` instance is stored on `Physics` and its `origin`/`dir`
are mutated in place before each `world.castRay()`. Rapier's `Ray` stores its vectors by
reference (confirmed against `rapier.es.js` and by direct test), and `castRay` reads them
synchronously, so reusing the object is safe.

**Impact.** Removes 2 allocations per car per tick (~240/sec at 60 Hz in solo).

**Verification.** `player.grounded === true` after the countdown (the ground probe using
the reused ray returns a hit), and the car rests at `y ≈ 0.418` — exactly the chassis
half-height — proving ground detection is correct.

---

### 1.4 Precomputed boost-pad colors — `src/entities/boostPads.ts`

**Problem.** `BoostPads.sync()` runs every frame and re-converted the disc colors
(`setHex(...).multiplyScalar(...)`) for every active pad on every tick.

**Fix.** The two colors (active, HDR-scaled `>1`; inactive) are computed once as module
constants and `copy()`-ed into the material.

**Impact.** Removes redundant hex→RGB conversion and scaling from a per-frame loop.
Zero visual change.

---

### 1.5 Particle-loop early-out — `src/entities/effects.ts`

**Problem.** `Effects.update()` swept all 900 particle slots every frame even when no
particles were alive (menu state, or after a burst had faded), doing 900 dead-particle
checks per frame for nothing.

**Fix.** A running `alive` counter is maintained: incremented on `spawn` (accounting for
ring-buffer overwrite — a slot that already held a live particle nets to zero) and
decremented when a particle dies. `update()` returns early after the cheap shockwave loop
when `alive === 0`, skipping the 900-slot sweep. In-flight particles still fade correctly
when the "Particles" setting is toggled off, because the loop only skips when the count
is already zero.

**Verification.** Deterministic headless test: after draining, `alive === 0`; a 50-particle
burst sets it to exactly 50; a small `update` keeps 50; a large `update` drains to 0; and
the early-out path leaves it at 0 with no error.

---

### 1.6 Flip-spin vector reuse — `src/entities/car.ts`

**Problem.** The directional-flip code allocated a `new THREE.Vector3()` for the spin axis
on every flip.

**Fix.** A dedicated `_spin` scratch vector is reused (`this._spin.crossVectors(UP, dir)`).

**Verification.** Build + drive smoke test (car still moves/steers); the flip path shares
the same reused-vector discipline as the other hot paths.

---

### 1.7 "Shadows" graphics toggle — `src/game/settings.ts`, `src/rendering/scene.ts`, `src/ui/menu.ts`

**Problem.** The 2048² dynamic shadow map is a large per-frame GPU cost with no way to
disable it for weak GPUs (the plan flagged this as "better exposed as a setting").

**Fix.** A `shadows` setting (default `true`) toggles the directional light's `castShadow`.
It's exposed in the settings menu next to the existing bloom toggle, persists to
`localStorage`, and live-applies via the existing `onSettingsChange` listener.

**Verification.** Headless test confirms the checkbox toggles `rendering.sun.castShadow`
and persists `"shadows":false`.

---

## 2. Rejected after review (not implemented)

The remaining candidates were evaluated and intentionally rejected — implementing them
would be harmful or produce no measurable gain. Recorded so future work doesn't revisit
them blindly.

| Area | Reason it was rejected |
| --- | --- |
| Frustum-culling the environment (city towers / dunes / planet) | three.js already frustum-culls per-mesh; the static groups are cheap. Manual culling would be premature and risk popping. |
| Batching arena glass panels into fewer draw calls | Each panel needs an independent opacity for the proximity-fade effect, so they can't share a material. Draw-call count is already small for this scene. |
| Moving physics to a Web Worker | The world is tiny (2 cars + 1 ball + ~20 static colliders); a worker would add sync latency and complexity for no measurable gain on the main thread. |

---

## 3. Verification

- `npm run build` — type-checks and bundles cleanly (65 modules).
- `npm run size` — all gzip budgets pass (index `27.7 kB`/120, three `196.8`/220,
  rapier `743.3`/800, bundler `23.7`/40).
- Headless Chrome smoke test against the built bundle:
  - `window.__game` bootstraps; `match.state` transitions `countdown → playing`.
  - Car is grounded (`true`) and rests at `y ≈ 0.418`; ball rests at `y ≈ 1.5`.
  - Driving with `W` moves the car (`z 28 → 18.4`, speed `18.3`).
  - HUD shows `3:00` and `0-0`.
  - Particle `alive` counter transitions 0 → 50 → 0 correctly (deterministic, paused).
  - Shadows toggle flips `rendering.sun.castShadow` and persists the setting.
