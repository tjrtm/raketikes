// Central tuning constants. All physics feel values live here — tweak, reload, iterate.

export const CONFIG = {
  gravity: -32, // stronger than earth: snappy jumps, fast ball drops (arcade feel)
  step: 1 / 60,

  arena: {
    width: 60,      // x extent
    length: 90,     // z extent (goal to goal)
    wallHeight: 16,
    cornerCut: 7,   // 45° corner walls so the ball never wedges in a corner
  },

  goal: {
    width: 16,
    height: 6,
    depth: 5,
  },

  ball: {
    radius: 1.5,
    density: 0.15,        // ~2.1 mass vs car ~12 -> car hits send it flying
    restitution: 0.8,
    friction: 0.5,
    gravityScale: 0.85,   // ball hangs slightly for aerial play
    linearDamping: 0.25,  // kills infinite rolling
    angularDamping: 0.6,
    maxSpeed: 62,
  },

  car: {
    half: { x: 1.1, y: 0.42, z: 1.8 }, // chassis half-extents
    density: 2.0,
    maxSpeed: 34,
    boostMaxSpeed: 46,
    accel: 40,            // ~0.9s to max speed
    reverseAccel: 30,
    reverseMaxSpeed: 18,
    brake: 60,
    coastDecel: 8,
    turnRate: 3.0,        // rad/s yaw at speed
    grip: 6.0,            // lateral velocity kill rate (1/s)
    driftGrip: 3.0,       // reduced grip while boosting + hard steering -> drift
    slideGrip: 1.3,       // powerslide (Square/Ctrl): near-free lateral slide, big oversteer
    downforce: 6,         // presses car onto surface while grounded
    jumpSpeed: 12,        // delta-v of first jump (~2.3u apex, enough hang time to play with air control)
    doubleJumpSpeed: 9,
    flipSpeed: 8,         // linear kick of a directional flip
    flipSpin: 5.5,        // rad/s spin of a flip
    airPitch: 12,         // rad/s^2 torque accels while airborne
    airYaw: 8,
    airRoll: 12,
    maxAngVel: 6,
    rightingTorque: 30,   // self-right assist; must beat the ~m*g*dCOM barrier of rolling over an edge
    linearDamping: 0.08,
    angularDamping: 1.4,
  },

  boost: {
    start: 33,
    max: 100,
    drainPerSec: 33,
    accel: 45,            // > |gravity| so aerials are possible
    padAmount: 100,
    padCooldown: 10,
    padRadius: 2.3,
  },

  match: {
    lengthSec: 180,
    countdownSec: 3,
    celebrationSec: 2.8,
    goFlashSec: 0.7,
  },
};

export const TEAM = { BLUE: 0, ORANGE: 1 } as const;
export type Team = 0 | 1;

export const TEAM_COLOR: Record<Team, number> = {
  [TEAM.BLUE]: 0x2fa3ff,
  [TEAM.ORANGE]: 0xff8a2a,
};
export const TEAM_NAME: Record<Team, string> = {
  [TEAM.BLUE]: 'BLUE',
  [TEAM.ORANGE]: 'ORANGE',
};

// Kickoff placements. Blue (player) defends z = +length/2, Orange defends z = -length/2.
export const KICKOFF = {
  ball: { x: 0, y: CONFIG.ball.radius, z: 0 },
  blue: { pos: { x: 0, y: 0.6, z: 28 }, yaw: 0 },        // local forward is -Z, so yaw 0 faces the ball
  orange: { pos: { x: 0, y: 0.6, z: -28 }, yaw: Math.PI },
};
