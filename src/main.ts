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
import { NetPlay } from './net/netplay';
import { S, colorNum, onSettingsChange } from './game/settings';
import { SFX } from './audio/sfx';
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
  // blue: local player in solo, host online; orange: bot in solo, guest online
  const carBlue = new Car(physics, rendering.scene, TEAM.BLUE, KICKOFF.blue.pos, KICKOFF.blue.yaw);
  const carOrange = new Car(physics, rendering.scene, TEAM.ORANGE, KICKOFF.orange.pos, KICKOFF.orange.yaw);
  const pads = new BoostPads(physics, rendering.scene);

  const input = new InputManager();
  const chaseCam = new ChaseCamera();
  const botAI = new Bot();

  const localCar = (): Car => (net.isGuest ? carOrange : carBlue);

  const kickoff = () => {
    ball.reset();
    carBlue.reset(KICKOFF.blue.pos, KICKOFF.blue.yaw, CONFIG.boost.start);
    // in practice mode the bot parks by its goal instead of contesting kickoffs
    if (match !== undefined && match.mode === 'practice') {
      carOrange.reset({ x: 22, y: 0.6, z: -38 }, Math.PI, CONFIG.boost.start);
    } else {
      carOrange.reset(KICKOFF.orange.pos, KICKOFF.orange.yaw, CONFIG.boost.start);
    }
    botAI.onKickoff();
    const lc = localCar();
    chaseCam.snapBehind(lc.position, lc.quaternion);
    net?.broadcastKickoff();
  };
  const match = new Match(hud, kickoff);

  // --- multiplayer session ---
  const net = new NetPlay({
    blue: carBlue,
    orange: carOrange,
    ball,
    match,
    kickoff,
    onGoalFx(scorer: Team) {
      effects.burst(ball.position, scorer === TEAM.BLUE ? colorNum(S.blueColor) : colorNum(S.orangeColor), 240, 20);
      ball.hit(1.2);
      SFX.goal();
    },
    onOpponentJoined() {
      // host side: guest connected — start the online match
      menu.online = true;
      menu.hide();
      hud.setInGame(true);
      net.hostStart();
    },
    onMatchStart() {
      // guest side: host started (or restarted) the match
      menu.online = true;
      menu.hide();
      hud.setInGame(true);
      match.netStart();
    },
    onDisconnected() {
      const wasInMatch = match.state !== 'menu';
      leaveOnline();
      menu.showMpError(wasInMatch ? 'Opponent disconnected' : 'Connection lost');
    },
    onError(text: string) {
      leaveOnline();
      menu.showMpError(text);
    },
  });
  net.session.onHostReady = () => menu.showMpHosting(net.session.code);

  const leaveOnline = () => {
    net.leave();
    menu.online = false;
    match.quitToMenu();
    hud.setInGame(false);
  };

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
      if (net.active) {
        leaveOnline();
      } else {
        match.quitToMenu();
        hud.setInGame(false);
      }
      menu.show('main');
    },
    onMpHost() {
      net.session.host();
      menu.showMpConnecting('…'); // brief "connecting" until the broker confirms the room
    },
    onMpJoin(code: string) {
      net.session.join(code);
      menu.showMpConnecting(code.trim().toUpperCase());
    },
    onMpCancel() {
      net.leave();
      menu.online = false;
    },
  });

  // deep link: ?join=CODE goes straight into the join flow instead of a bot match
  const joinCode = new URLSearchParams(location.search).get('join');
  if (joinCode) {
    hud.setInGame(false);
    net.session.join(joinCode);
    menu.showMpConnecting(joinCode.toUpperCase());
  } else {
    hud.setInGame(true);
    menu.hide();
    match.startGame('match');
  }

  input.onPause = () => {
    if (net.active && match.state !== 'menu' && match.state !== 'ended') {
      // online: no real pause — the menu overlays a running match
      if (menu.panel !== 'hidden') menu.back();
      else menu.show('pause');
    } else if (match.state === 'menu') {
      if (menu.panel === 'settings' || menu.panel === 'mp') menu.back();
    } else if (match.state === 'ended') {
      if (net.active) leaveOnline();
      else {
        match.quitToMenu();
        hud.setInGame(false);
      }
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
      if (net.active) {
        if (net.isHost) net.hostStart();
        else net.requestRematch();
      } else {
        match.restart();
      }
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
    if (match.state === 'playing' && !match.paused) localCar().safeReset();
  };

  // --- settings live-apply ---
  const applyColors = () => {
    const blue = colorNum(S.blueColor);
    const orange = colorNum(S.orangeColor);
    carBlue.setColor(blue);
    carOrange.setColor(orange);
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
      const isHuman = net.active || car === carBlue;
      const factor = isHuman ? 0.9 : BOT_LEVELS[S.botLevel].power;
      const mag = Math.min(speed, 50) * factor;
      ball.body.applyImpulse({ x: tmpDir.x * mag, y: tmpDir.y * mag, z: tmpDir.z * mag }, true);
    }
    ball.hit(Math.min(1, speed / 28));
    SFX.ballHit(Math.min(1, speed / 28));
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

    // goals are host-authoritative online: the guest waits for the host's goal event
    if (goalT && ballT && match.state === 'playing' && !net.isGuest) {
      const scorer: Team = goalT.team === TEAM.BLUE ? TEAM.ORANGE : TEAM.BLUE;
      effects.burst(ball.position, scorer === TEAM.BLUE ? colorNum(S.blueColor) : colorNum(S.orangeColor), 240, 20);
      ball.hit(1.2);
      SFX.goal();
      match.onGoal(scorer);
      net.broadcastGoal(scorer);
    }
    if (padT && carT && pads.tryPickup(padT.index, carT.car as Car) && carT.car === localCar()) SFX.pickup();
    if (carT && ballT) powerHit(carT.car as Car);
  };

  // --- main loop: fixed-step physics (scaled by game speed), per-frame rendering ---
  const STEP = CONFIG.step;
  const stepOnce = () => {
    const live = match.inputsActive();
    if (net.active) {
      // own car from local input; the remote car is driven purely by snapshots
      // (raw physics extrapolates it between packets — no fixedUpdate)
      const lc = localCar();
      const menuOpen = menu.panel !== 'hidden';
      const inp = live && !menuOpen ? input.sample() : emptyInput();
      if (inp.jumpPressed) SFX.jump();
      lc.applyInput(inp);
      lc.fixedUpdate(STEP, physics);
    } else {
      const inp = live ? input.sample() : emptyInput();
      if (inp.jumpPressed) SFX.jump();
      carBlue.applyInput(inp);
      carOrange.applyInput(live && match.mode === 'match' ? botAI.update(STEP, carOrange, ball) : emptyInput());
      carBlue.fixedUpdate(STEP, physics);
      carOrange.fixedUpdate(STEP, physics);
    }
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
    if (net.active && document.hidden) {
      // the hidden-tab interval loop owns the sim while we're backgrounded
      requestAnimationFrame(frame);
      return;
    }
    const dt = rawDt * (net.active ? 1 : S.gameSpeed); // global time scale is forced to 1x online

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
    net.update(dt);

    carBlue.sync(dt);
    carOrange.sync(dt);
    ball.sync(dt);
    pads.sync(now / 1000);
    const lc = localCar();
    arena.update(rawDt, lc.position);
    for (const car of [carBlue, carOrange]) {
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
      chaseCam.update(rawDt, rendering.camera, lc.position, lc.quaternion, lc.grounded, ball.position);
    }
    hud.setBoost(lc.boost);
    const engineOn = !match.paused && (match.state === 'playing' || match.state === 'goal' || match.state === 'countdown');
    SFX.updateEngine(lc.speed, lc.boosting, engineOn);
    rendering.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Browsers throttle rAF in hidden tabs, which would freeze the match for the
  // other player online — fall back to interval-driven stepping while hidden.
  let hiddenLast = 0;
  setInterval(() => {
    if (!net.active || !document.hidden) {
      hiddenLast = 0;
      return;
    }
    const now = performance.now();
    if (hiddenLast === 0) hiddenLast = now;
    const dt = Math.min((now - hiddenLast) / 1000, 0.25);
    hiddenLast = now;
    last = now; // keep the rAF clock fresh for when the tab returns
    match.update(dt);
    if (match.physicsActive()) {
      accumulator += dt;
      while (accumulator >= STEP) {
        accumulator -= STEP;
        stepOnce();
      }
    }
    net.update(dt);
  }, 50);

  window.addEventListener('beforeunload', () => net.leave());

  // debug handle for automated verification
  (window as unknown as Record<string, unknown>).__game = {
    physics, ball, player: carBlue, bot: carOrange, match, chaseCam, pads, kickoff, menu, arena, effects, input, net,
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
