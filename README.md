# Rocket Arena

A browser-based 3D car-soccer game in the spirit of Rocket League. Three.js rendering, Rapier physics, TypeScript, no assets — everything is procedural. Drive a rocket car, boost, jump, flip, and knock a giant ball into the opponent's goal inside a glass-domed stadium.

## Quick start

```sh
npm install
npm run dev
```

Open the printed URL (defaults to `http://localhost:5199`). `npm run build` produces a static production build in `dist/`.

## Game modes

- **Play Match** — timed match (default 3:00) against a bot with three difficulty levels. Tied at zero? Overtime, golden goal.
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
  ui/               HUD and menu system
```

Handy details: goal sensors sit one ball-diameter behind the goal line so a goal only counts on *full* entry; the car's collider is a round cuboid that exactly matches its rounded visual shell; walls fade to near-transparent when you drive close to them; the bot has a layered anti-stuck watchdog (escape-reverse, then self-reset) so it never hangs.

## License

Dual-licensed under the **WTFPL** and the **MIT License** — use whichever you prefer, no attribution required. See [LICENSE](LICENSE).
