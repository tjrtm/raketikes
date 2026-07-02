import * as THREE from 'three';
import { Physics, type Tag } from './physics/world';
import { Rendering } from './rendering/scene';
import { ChaseCamera } from './rendering/camera';
import { buildArena } from './entities/arena';
import { buildEnvironment, type EnvHandle } from './entities/environments';
import { Ball } from './entities/ball';
import { Car } from './entities/car';
import { BoostPads } from './entities/boostPads';
import { Effects } from './entities/effects';
import { InputManager, emptyInput } from './controls/input';
import { Bot, BOT_LEVELS } from './game/bot';
import { Match } from './game/match';
import { S, colorNum, onSettingsChange } from './game/settings';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';
import { CONFIG, KICKOFF, TEAM, type Team } from './config';

async function main() {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const physics = await Physics.create();
  const rendering = new Rendering(canvas);
  const hud = new Hud();
  const effects = new Effects(rendering.scene);

  const arena = buildArena(physics, rendering.scene);
  let env: EnvHandle = buildEnvironment(rendering, S.stadium);
  const ball = new Ball(physics, rendering.scene);
  const player = new Car(physics, rendering.scene, TEAM.BLUE, KICKOFF.blue.pos, KICKOFF.blue.yaw);
  const bot = new Car(physics, rendering.scene, TEAM.ORANGE, KICKOFF.orange.pos, KICKOFF.orange.yaw);
  const pads = new BoostPads(physics, rendering.scene);

  const input = new InputManager();
  const chaseCam = new ChaseCamera();
  const botAI = new Bot();

  const kickoff = () => {
    ball.reset();
    player.reset(KICKOFF.blue.pos, KICKOFF.blue.yaw, CONFIG.boost.start);
    // in practice mode the bot parks by its goal instead of contesting kickoffs
    if (match !== undefined && match.mode === 'practice') {
      bot.reset({ x: 22, y: 0.6, z: -38 }, Math.PI, CONFIG.boost.start);
    } else {
      bot.reset(KICKOFF.orange.pos, KICKOFF.orange.yaw, CONFIG.boost.start);
    }
    botAI.onKickoff();
    chaseCam.snapBehind(player.position, player.quaternion);
  };
  const match = new Match(hud, kickoff);

  // --- menus & pause flow ---
  const menu = new Menu({
    onStart(mode) {
      menu.hide();
      hud.setInGame(true);
      match.startGame(mode);
    },
    onResume() {
      menu.hide();
      match.paused = false;
    },
    onRestart() {
      menu.hide();
      hud.setInGame(true);
      match.startGame(match.mode);
    },
    onQuit() {
      match.quitToMenu();
      hud.setInGame(false);
      menu.show('main');
    },
  });
  kickoff();
  hud.setInGame(false);
  menu.show('main');

  input.onPause = () => {
    if (match.state === 'menu') {
      if (menu.panel === 'settings') menu.back();
    } else if (match.state === 'ended') {
      match.quitToMenu();
      hud.setInGame(false);
      menu.show('main');
    } else if (match.paused) {
      menu.hide();
      match.paused = false;
    } else {
      match.paused = true;
      menu.show('pause');
    }
  };
  input.onPrimary = () => {
    if (menu.panel !== 'hidden') {
      menu.activate();
      input.clearQueuedJump(); // don't let the menu press become a kickoff jump
    } else if (match.state === 'ended') {
      match.restart();
    }
  };
  input.onNavigate = (dir) => {
    if (menu.panel !== 'hidden') menu.navigate(dir);
  };
  input.onBack = () => {
    if (menu.panel !== 'hidden') menu.back();
  };
  input.onCameraToggle = () => chaseCam.toggle();
  input.onResetCar = () => {
    if (match.state === 'playing' && !match.paused) player.safeReset();
  };

  // --- settings live-apply ---
  const applyColors = () => {
    const blue = colorNum(S.blueColor);
    const orange = colorNum(S.orangeColor);
    player.setColor(blue);
    bot.setColor(orange);
    arena.setTeamColors(blue, orange);
    hud.setScoreColors(S.blueColor, S.orangeColor);
  };
  applyColors();
  effects.enabled = S.particles;
  onSettingsChange((key) => {
    if (key === 'stadium') {
      env.dispose();
      env = buildEnvironment(rendering, S.stadium);
    } else if (key === 'blueColor' || key === 'orangeColor') {
      applyColors();
    } else if (key === 'cameraFov') {
      rendering.setFov(S.cameraFov);
    } else if (key === 'particles') {
      effects.enabled = S.particles;
    }
    // botLevel / gameSpeed / unlimitedBoost / matchLength are read live where used
  });

  // --- collision routing ---
  const tmpDir = new THREE.Vector3();
  const powerHit = (car: Car) => {
    // extra "power hit" impulse so contacts at speed feel punchy; bot power scales with difficulty
    const speed = car.speed;
    const bp = ball.position;
    const cp = car.position;
    tmpDir.copy(bp).sub(cp).normalize();
    tmpDir.y += 0.25;
    tmpDir.normalize();
    if (speed > 6) {
      const factor = car === player ? 0.9 : BOT_LEVELS[S.botLevel].power;
      const mag = Math.min(speed, 50) * factor;
      ball.body.applyImpulse({ x: tmpDir.x * mag, y: tmpDir.y * mag, z: tmpDir.z * mag }, true);
    }
    ball.hit(Math.min(1, speed / 28));
    effects.burst(bp.addScaledVector(tmpDir, -CONFIG.ball.radius), 0xcfe4ff, Math.min(36, 6 + speed), 3 + speed * 0.3);
  };

  const onCollision = (a: Tag | undefined, b: Tag | undefined, started: boolean) => {
    if (!started || !a || !b) return;
    const pick = <K extends Tag['kind']>(kind: K) =>
      (a.kind === kind ? a : b.kind === kind ? b : null) as Extract<Tag, { kind: K }> | null;

    const goalT = pick('goal');
    const ballT = pick('ball');
    const carT = pick('car');
    const padT = pick('pad');

    if (goalT && ballT && match.state === 'playing') {
      const scorer: Team = goalT.team === TEAM.BLUE ? TEAM.ORANGE : TEAM.BLUE;
      effects.burst(ball.position, scorer === TEAM.BLUE ? colorNum(S.blueColor) : colorNum(S.orangeColor), 240, 20);
      ball.hit(1.2);
      match.onGoal(scorer);
    }
    if (padT && carT) pads.tryPickup(padT.index, carT.car as Car);
    if (carT && ballT) powerHit(carT.car as Car);
  };

  // --- main loop: fixed-step physics (scaled by game speed), per-frame rendering ---
  const STEP = CONFIG.step;
  const stepOnce = () => {
    const live = match.inputsActive();
    player.applyInput(live ? input.sample() : emptyInput());
    bot.applyInput(live && match.mode === 'match' ? botAI.update(STEP, bot, ball) : emptyInput());
    player.fixedUpdate(STEP, physics);
    bot.fixedUpdate(STEP, physics);
    ball.fixedUpdate();
    pads.fixedUpdate(STEP);
    physics.step(onCollision);
  };
  let accumulator = 0;
  let last = performance.now();
  const nozzlePos = new THREE.Vector3();
  const backDir = new THREE.Vector3();
  let menuOrbit = 0;

  const frame = (now: number) => {
    const rawDt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const dt = rawDt * S.gameSpeed; // global time scale (physics + timers + effects)

    input.pollSystemButtons();
    match.update(dt);

    if (match.physicsActive()) {
      accumulator += dt;
      while (accumulator >= STEP) {
        accumulator -= STEP;
        stepOnce();
      }
    } else {
      accumulator = 0;
    }

    player.sync(dt);
    bot.sync(dt);
    ball.sync(dt);
    pads.sync(now / 1000);
    arena.update(rawDt, player.position);
    for (const car of [player, bot]) {
      if (car.boosting && match.physicsActive()) {
        effects.trail(car.nozzle(nozzlePos), car.backDir(backDir), car.color);
      }
    }
    effects.update(match.paused ? 0 : dt);

    if (match.state === 'menu') {
      // slow orbit over the arena as the menu backdrop
      menuOrbit += rawDt * 0.12;
      rendering.camera.position.set(Math.cos(menuOrbit) * 42, 17, Math.sin(menuOrbit) * 42);
      rendering.camera.lookAt(0, 2, 0);
    } else {
      chaseCam.update(rawDt, rendering.camera, player.position, player.quaternion, player.grounded, ball.position);
    }
    hud.setBoost(player.boost);
    rendering.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // debug handle for automated verification
  (window as unknown as Record<string, unknown>).__game = {
    physics, ball, player, bot, match, chaseCam, pads, kickoff, menu, arena, effects, input,
    getEnv: () => env,
    // deterministic sim driver for automated tests (tab-visibility independent)
    debugStep: (seconds: number) => {
      const n = Math.round(seconds / STEP);
      for (let i = 0; i < n; i++) {
        match.update(STEP);
        if (match.physicsActive()) stepOnce();
      }
    },
  };
}

main();
