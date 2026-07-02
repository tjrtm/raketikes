import { CONFIG, TEAM, TEAM_NAME, type Team } from '../config';
import { S } from './settings';
import type { Hud } from '../ui/hud';

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

  private countdownT = CONFIG.match.countdownSec;
  private celebT = 0;
  private goFlashT = 0;

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
    this.hud.setCenter('');
    this.hud.hideOverlay();
    this.onKickoff(); // tidy backdrop behind the menu
  }

  update(dt: number) {
    if (this.paused) return;

    switch (this.state) {
      case 'menu':
        break;
      case 'countdown': {
        this.countdownT -= dt;
        if (this.countdownT <= 0) {
          this.state = 'playing';
          this.goFlashT = CONFIG.match.goFlashSec;
          this.hud.setCenter('GO!', '', false);
        } else {
          this.hud.setCenter(String(Math.ceil(this.countdownT)), this.overtime ? 'OVERTIME — next goal wins' : '');
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
    this.hud.setCenter('');
    const [b, o] = this.scores;
    const winner: Team | null = b > o ? TEAM.BLUE : o > b ? TEAM.ORANGE : null;
    const title = winner === null ? 'DRAW' : `${TEAM_NAME[winner]} WINS`;
    const css = winner === TEAM.BLUE ? S.blueColor : winner === TEAM.ORANGE ? S.orangeColor : '#e8f0ff';
    this.hud.showOverlay(title, `Final score ${b} — ${o} · Enter = rematch · Esc = menu`, css);
    this.onEnded?.();
  }

  restart() {
    if (this.state !== 'ended') return;
    this.startGame(this.mode);
  }
}
