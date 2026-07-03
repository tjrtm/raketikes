# Repository Guidelines

## Project Structure & Module Organization

This is a browser-based 3D car-soccer game built with Vite, TypeScript, Three.js, and Rapier. Source code lives under `src/`:

- `src/main.ts` wires the renderer, physics, entities, UI, and game loop.
- `src/config.ts` contains gameplay, physics, match, boost, arena, and tuning constants.
- `src/entities/` owns arena, cars, ball, boost pads, environments, and effects.
- `src/physics/` wraps Rapier world setup, collider tags, raycasts, and collision events.
- `src/rendering/` contains scene setup and camera logic.
- `src/controls/`, `src/game/`, and `src/ui/` contain input, match/bot/settings state, and DOM HUD/menu code.

There is no separate asset pipeline; visuals are procedural. Generated outputs such as `dist/`, `node_modules/`, coverage, and `artifacts/` are ignored.

## Build, Test, and Development Commands

- `npm install` installs dependencies from `package-lock.json`.
- `npm run dev` starts the Vite dev server for local play.
- `npm run build` type-checks/transpiles and builds the production bundle into `dist/`.
- `npm run preview` serves the built bundle for production-style verification.

No `npm test` script is configured. Use `npm run build` plus manual or Playwright browser smoke checks when changing gameplay, rendering, physics, or UI behavior.

## Coding Style & Naming Conventions

Use TypeScript ES modules with strict compiler settings. Follow existing style: two-space indentation, single quotes, semicolons, `camelCase` for variables/functions, and `PascalCase` for classes such as `Car`, `Ball`, and `Match`. Keep modules focused on one concern and prefer tuning constants in `src/config.ts` over scattered magic numbers. Add comments only where physics tuning, collision handling, or smoothing math is non-obvious.

## Testing Guidelines

For gameplay changes, verify at least: scene renders, car movement/jump/boost works, ball and arena collisions hold, goal sensors score only on full entry, boost pads refill/cool down, HUD updates, pause freezes simulation, and mobile layout does not overlap. Save screenshots or reports under `artifacts/` when useful; do not commit generated artifacts unless explicitly requested.

## Commit & Pull Request Guidelines

Recent commits use concise imperative summaries, for example `Add Rocket Arena: browser 3D car-soccer game`. Keep commits focused and describe observable behavior. Pull requests should include a short summary, verification commands, screenshots for visual/UI changes, and notes about changed physics constants or known limitations. Link issues when applicable.
