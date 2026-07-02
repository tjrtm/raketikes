Build a polished browser-based 3D Rocket League-style game using Three.js.

Goal:
Create a fully playable local web game that runs in the browser. The first screen should be the actual game, not a landing page. No menu gate, no "click to start" splash beyond a single click to lock pointer/audio if strictly required by browser APIs — the arena, car, and ball must be visible and rendering immediately on load.

Tech requirements:
- Use Three.js (latest stable) for rendering.
- Use a real physics engine, preferably Rapier.js (@dimforge/rapier3d-compat), for car, ball, arena, wall, and goal physics. Do not hand-roll physics for these bodies.
- Use TypeScript if the project already supports it, otherwise plain modern JavaScript (ES2020+, ES modules) is fine — pick one and be consistent throughout.
- Use Vite for the dev server unless another stack already exists.
- Keep the architecture clean and split into separate files/modules, roughly:
  - /src/physics (world setup, rigid bodies, colliders, collision events)
  - /src/rendering (scene, camera, lights, postprocessing)
  - /src/entities (car, ball, arena, boost pads, goals)
  - /src/controls (input handling, keybindings)
  - /src/game (state machine: countdown, playing, goal-scored, paused, match-end)
  - /src/ui (HUD, score, timer, boost meter, overlays)
  - /src/assets (models/textures if any, or procedural geometry generators)
  - main.ts/main.js as the entry point wiring it all together
- Do not put all logic in one giant file. Each module should own one concern and expose a small interface to the others.

Core gameplay:
- Third-person controllable rocket car.
- Large soccer ball with believable bouncy physics.
- Enclosed arena with side walls, back walls, ceiling or high invisible bounds, and two goals, sized so a 1v1 or solo match feels playable within roughly 90-120 seconds.
- Score detection when the ball crosses fully into a goal (use a dedicated sensor/trigger collider inside the goal mouth, not just a distance check).
- Reset after each goal: freeze input, run a 3-second countdown, respawn car and ball at kickoff positions, resume.
- Match timer (default 3 minutes, configurable constant) and score display, with a clear match-end state when time expires.
- Boost system:
  - Boost meter from 0-100, starting at a defined value (e.g. 33).
  - Hold boost key to accelerate with a visible flame/trail effect attached to the car.
  - Boost drains at a defined rate per second while active; stops applying force at 0.
  - Boost pads placed around the arena (specify roughly how many, e.g. 6-8) that refill a fixed amount of boost on contact, with a cooldown/respawn timer and a visual state change (dim/hidden while depleted, glowing when active).
- Jump system:
  - Single jump off the ground.
  - Second jump usable in the air that triggers a quick flip/rotation impulse in the direction of current input (or a simple forward flip if no direction held).
  - Air control: pitch, yaw, and roll torque applied while airborne, distinct from ground steering.
- Car should feel responsive and arcade-like: fast time-to-max-speed, tight turning radius, not a slow simulator. Tune specific values (max speed, acceleration, turn rate) rather than leaving them as arbitrary placeholders.

Controls:
- WASD or arrow keys: drive / steer (forward/back/left/right).
- Space: jump.
- Shift: boost.
- R: reset car to a safe on-ground position (not a full match reset).
- C: toggle camera mode (chase vs ball-cam).
- Esc or P: pause, showing a simple pause overlay that halts physics/game state updates.
- Display the control scheme somewhere in the UI (a small always-visible or toggleable legend), not just in this spec.

Camera:
- Smooth chase camera positioned behind and above the car, with lag/spring smoothing (not an instant rigid follow).
- Camera should follow car rotation and velocity while remaining readable — avoid nausea-inducing snap rotations or clipping through the arena floor/walls.
- Optional ball-cam toggle that keeps both car and ball roughly in frame when the ball is far from the car.
- Camera must never end up inside geometry or looking through walls; add basic collision/clamping against the arena bounds if needed.

Visual design:
- Recreate a Rocket League-inspired feel; original branding/naming only, no use of real trademarked logos or copyrighted assets.
- Futuristic indoor stadium: floor, walls, ceiling or skybox, arena trim/edge lighting, colored goals (e.g. blue vs orange), boost pads with glow.
- Lighting and shadows (at least one shadow-casting directional/hemisphere light setup); add bloom or other lightweight postprocessing only if frame rate stays smooth — skip or scale down if it tanks performance.
- Clear team colors on cars, goal-colored zones, boost pad glow, car boost trail/particles, ball hit highlight/flash, simple impact particles on collisions and goals.
- Use procedural geometry (boxes, cylinders, capsules, etc.) and basic materials/textures where real assets aren't available — do not block on needing external 3D models.
- Readable HUD: score (both sides), match timer, boost meter (numeric and/or bar), countdown overlay, goal celebration text/animation, pause overlay, match-end summary screen.
- Responsive: the canvas and HUD must resize correctly on window resize and work at common laptop resolutions (e.g. 1366x768 up to 1920x1080) without breaking layout or aspect ratio.

Physics feel:
- Prioritize fun over strict realism.
- Ball: heavy enough to feel weighty on contact, but responsive and rolls/bounces predictably — no infinite bouncing, no sticking.
- Cars: strong acceleration, drift-friendly turning (some slip when turning at speed), stable recovery — a car should be able to land right-side-up or self-right reasonably rather than needing manual recovery most of the time.
- Explicitly avoid cars flipping uncontrollably from minor bumps — cap angular velocity / apply angular damping / limit torque transfer from small collisions as needed.
- Actually tune gravity, friction, restitution, linear/angular damping, and impulse strengths through iteration — don't just use engine defaults and call it done. Note in your summary what values you landed on and why.

AI / opponent:
- If time permits, add a simple bot opponent:
  - Bot chases the ball using a basic steering/seek behavior.
  - Bot orients roughly toward the player's goal when it has the ball or is near it.
  - Bot uses boost occasionally (not constantly, not never).
  - Bot should be clearly beatable — no perfect ball control, some randomness/imperfection in its decisions.
- If a bot is too risky/time-consuming, fall back to a solo practice mode with two goals, a working scoreboard, and a way to knock the ball into either goal to test scoring.
- State explicitly in your summary which of these two you implemented.

Implementation expectations:
- Build the complete working game, not a prototype shell or stub functions.
- Include all source files needed to run the project from a fresh `npm install && npm run dev`.
- Add brief comments only where the logic is non-obvious (physics tuning constants, collision event handling, camera smoothing math) — don't narrate obvious code.
- Avoid overengineering: no unnecessary abstraction layers, plugin systems, or config frameworks for a single-page game.
- Do not create a marketing homepage, README-as-landing-page, or splash/menu screen in place of the game.

Verification (do this yourself before calling it done):
- Start the dev server and load the page.
- Confirm in the browser (via automation or manual check) that:
  - The scene renders (arena, car, ball all visible).
  - The car moves, turns, jumps, and boosts in response to input.
  - The ball collides with the car and with arena surfaces correctly (no falling through floor, no tunneling through walls at speed).
  - Goals are detected correctly on full ball entry, not on mere proximity.
  - Score and timer update correctly and visibly in the HUD.
  - Reset-after-goal sequence (countdown, respawn) works and doesn't leave stale state.
  - Boost pads refill boost and respect their cooldown.
  - The camera doesn't clip through geometry or lose track of the car during normal play.
  - No major console errors or warnings during a normal play session.
- Take at least one screenshot (or equivalent automated check) proving the canvas is rendering actual 3D content, not a blank/black screen.
- If any of the above fails, fix it before declaring the task complete — don't report success with a known-broken checklist item.

Deliverable:
- A local runnable browser game.
- Provide the dev server URL to open it.
- Summarize: full control scheme, what was implemented vs skipped (e.g. bot vs solo mode), key physics tuning values chosen, and any known limitations.

Quality bar:
Make it feel like an arcade sports game people would actually want to play for five minutes, not a physics tech demo. Spend extra effort tuning car handling, camera smoothing, ball impact feedback, boost feel, and goal celebration feedback. A technically complete but boring or floaty/unresponsive build is not acceptable — iterate on feel before finishing.
