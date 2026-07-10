import { CONFIG, TEAM, TEAM_NAME, type Team } from '../config';
import { S } from './settings';
import { SFX } from '../audio/sfx';
import type { Hud } from '../ui/hud';
import type { MatchSnap } from '../net/session';

export type GameState = 'menu' | 'countdown' | 'playing' | 'goal' | 'ended';
export type GameMode = 'match' | 'practice';

/**
 * Match state machine: menu -> countdown -> playing -> (goal -> countdown)* -> ended.
 * Practice mode has no clock and never ends on its own.
 * Pause is orthogonal and freezes everything. Tied at 0:00 -> overtime, next goal wins.
 */
export class Match {
  state: GameState = 'menu';
  mode: GameMode = 'match';
  paused = false;
  scores: [number, number] = [0, 0];
  timeLeft = CONFIG.match.lengthSec;
  overtime = false;
  lastScorer: Team = TEAM.BLUE;
  /** Guest in an online match: state is mirrored from the host via netApply(). */
  netFollow = false;

  private countdownT = CONFIG.match.countdownSec;
  private celebT = 0;
  private goFlashT = 0;
  private lastBeepN = 0; // last countdown number a tick was played for

  onEnded?: () => void;

  constructor(
    private hud: Hud,
    private onKickoff: () => void,
  ) {}

  physicsActive(): boolean {
    return !this.paused && (this.state === 'playing' || this.state === 'goal');
  }

  inputsActive(): boolean {
    return !this.paused && this.state === 'playing';
  }

  startGame(mode: GameMode) {
    this.mode = mode;
    this.netFollow = false;
    this.scores = [0, 0];
    this.timeLeft = S.matchLength;
    this.overtime = false;
    this.paused = false;
    this.hud.hideOverlay();
    this.onKickoff();
    this.state = 'countdown';
    this.countdownT = CONFIG.match.countdownSec;
  }

  quitToMenu() {
    this.state = 'menu';
    this.paused = false;
    this.netFollow = false;
    this.hud.setCenter('');
    this.hud.hideOverlay();
    this.onKickoff(); // tidy backdrop behind the menu
  }

  update(dt: number) {
    if (this.paused) return;
    if (this.netFollow) {
      // host drives all transitions; locally we fade the GO! flash, run the
      // clock between 10 Hz snapshots (netApply only corrects drift), and refresh the HUD
      if (this.goFlashT > 0) {
        this.goFlashT -= dt;
        if (this.goFlashT <= 0 && this.state === 'playing') this.hud.setCenter('');
      }
      if (this.state === 'playing' && !this.overtime) {
        this.timeLeft = Math.max(0, this.timeLeft - dt);
      }
      this.hud.setScore(this.scores[0], this.scores[1]);
      this.hud.setTimer(this.timeLeft, this.overtime && this.state !== 'ended', false);
      return;
    }

    switch (this.state) {
      case 'menu':
        break;
      case 'countdown': {
        this.countdownT -= dt;
        if (this.countdownT <= 0) {
          this.state = 'playing';
          this.goFlashT = CONFIG.match.goFlashSec;
          this.hud.setCenter('GO!', '', false);
          SFX.goBeep();
        } else {
          const n = Math.ceil(this.countdownT);
          this.hud.setCenter(String(n), this.overtime ? 'OVERTIME — next goal wins' : '');
          if (n !== this.lastBeepN) {
            this.lastBeepN = n;
            SFX.countdownBeep();
          }
        }
        break;
      }
      case 'playing': {
        if (this.goFlashT > 0) {
          this.goFlashT -= dt;
          if (this.goFlashT <= 0) this.hud.setCenter('');
        }
        if (this.mode === 'match' && !this.overtime) {
          this.timeLeft -= dt;
          if (this.timeLeft <= 0) {
            this.timeLeft = 0;
            if (this.scores[0] === this.scores[1]) {
              this.overtime = true;
            } else {
              this.end();
            }
          }
        }
        break;
      }
      case 'goal': {
        this.celebT -= dt;
        this.hud.setCenter('GOAL!', `${TEAM_NAME[this.lastScorer]} scores`, true);
        if (this.celebT <= 0) {
          if (this.mode === 'match' && this.timeLeft <= 0) {
            this.end();
          } else {
            this.hud.setCenter('');
            this.onKickoff();
            this.state = 'countdown';
            this.countdownT = CONFIG.match.countdownSec;
          }
        }
        break;
      }
      case 'ended':
        break;
    }

    this.hud.setScore(this.scores[0], this.scores[1]);
    this.hud.setTimer(this.timeLeft, this.overtime && this.state !== 'ended', this.mode === 'practice');
  }

  onGoal(scorer: Team) {
    if (this.state !== 'playing') return;
    this.scores[scorer]++;
    this.lastScorer = scorer;
    this.state = 'goal';
    this.celebT = CONFIG.match.celebrationSec;
    if (this.overtime) this.timeLeft = 0; // golden goal ends the match after celebration
  }

  private end() {
    this.state = 'ended';
    this.showEndOverlay();
    SFX.crowd(0.6);
    this.onEnded?.();
  }

  private showEndOverlay() {
    this.hud.setCenter('');
    const [b, o] = this.scores;
    const winner: Team | null = b > o ? TEAM.BLUE : o > b ? TEAM.ORANGE : null;
    const title = winner === null ? 'DRAW' : `${TEAM_NAME[winner]} WINS`;
    const css = winner === TEAM.BLUE ? S.blueColor : winner === TEAM.ORANGE ? S.orangeColor : '#e8f0ff';
    this.hud.showOverlay(title, `Final score ${b} — ${o} · Enter = rematch · Esc = menu`, css);
  }

  // ---------------------------------------------------------------- online

  /** Host: serialize the state the guest mirrors. */
  snapshot(): MatchSnap {
    return {
      state: this.state,
      scores: [this.scores[0], this.scores[1]],
      timeLeft: this.timeLeft,
      overtime: this.overtime,
      countdown: this.countdownT,
      lastScorer: this.lastScorer,
    };
  }

  /** Guest: enter (or re-enter, on rematch) an online match as a follower. */
  netStart() {
    this.mode = 'match';
    this.netFollow = true;
    this.paused = false;
    this.scores = [0, 0];
    this.timeLeft = S.matchLength;
    this.overtime = false;
    this.state = 'countdown';
    this.countdownT = CONFIG.match.countdownSec;
    this.hud.hideOverlay();
    this.hud.setCenter('');
  }

  /**
   * Guest: apply a host state snapshot and mirror the HUD transitions.
   * oneWay is the estimated transit latency (s): the host clock read that far
   * in the past. The local clock keeps ticking between snapshots; we only snap
   * to the corrected host value when drift exceeds the display resolution.
   */
  netApply(s: MatchSnap, oneWay = 0) {
    if (!this.netFollow) return;
    const prev = this.state;
    this.scores = [s.scores[0], s.scores[1]];
    const corrected = s.state === 'playing' && !s.overtime
      ? Math.max(0, s.timeLeft - oneWay)
      : s.timeLeft;
    if (Math.abs(corrected - this.timeLeft) > 0.35 || s.state !== 'playing') {
      this.timeLeft = corrected;
    }
    this.overtime = s.overtime;
    this.lastScorer = s.lastScorer as Team;
    this.state = s.state as GameState;

    if (this.state === 'countdown') {
      const n = Math.max(1, Math.ceil(s.countdown));
      this.hud.setCenter(String(n), this.overtime ? 'OVERTIME — next goal wins' : '');
      if (n !== this.lastBeepN) {
        this.lastBeepN = n;
        SFX.countdownBeep();
      }
    } else if (this.state === 'playing' && prev === 'countdown') {
      this.goFlashT = CONFIG.match.goFlashSec;
      this.hud.setCenter('GO!', '', false);
      SFX.goBeep();
    } else if (this.state === 'goal') {
      this.hud.setCenter('GOAL!', `${TEAM_NAME[this.lastScorer]} scores`, true);
    } else if (this.state === 'ended' && prev !== 'ended') {
      this.showEndOverlay();
      SFX.crowd(0.6); // mirror the host's end-of-match crowd
    }
  }

  restart() {
    if (this.state !== 'ended') return;
    this.startGame(this.mode);
  }
}
