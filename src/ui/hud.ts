import { TEAM_NAME, type Team } from '../config';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Hud {
  private scoreBlue = el('scoreBlue');
  private scoreOrange = el('scoreOrange');
  private timer = el('timer');
  private boostNum = el('boostNum');
  private boostFill = el('boostFill');
  private center = el('center');
  private centerSub = el('centerSub');
  private overlay = el('overlay');
  private overlayTitle = el('overlayTitle');
  private overlaySub = el('overlaySub');

  private lastCenter = '';
  private lastBlue = -1;
  private lastOrange = -1;
  private lastTimerText = '';
  private lastOvertime = false;
  private lastBoost = -1;

  // Each setter guards against redundant writes: match.update() calls these every
  // frame, and touching textContent / style / classList on every tick forces the
  // browser to re-validate layout/paint even when nothing changed. Only mutate the
  // DOM when the value actually differs.
  setScore(blue: number, orange: number) {
    if (blue !== this.lastBlue) {
      this.scoreBlue.textContent = String(blue);
      this.lastBlue = blue;
    }
    if (orange !== this.lastOrange) {
      this.scoreOrange.textContent = String(orange);
      this.lastOrange = orange;
    }
  }

  setTimer(secondsLeft: number, overtime: boolean, practice = false) {
    const s = Math.max(0, Math.ceil(secondsLeft));
    const text = practice ? '∞' : overtime ? '+OT' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (text !== this.lastTimerText) {
      this.timer.textContent = text;
      this.lastTimerText = text;
    }
    if (overtime !== this.lastOvertime) {
      this.timer.classList.toggle('overtime', overtime);
      this.lastOvertime = overtime;
    }
  }

  setScoreColors(blueCss: string, orangeCss: string) {
    this.scoreBlue.style.color = blueCss;
    this.scoreOrange.style.color = orangeCss;
  }

  /** Hide/show the in-game HUD chrome (scoreboard, boost) while in the main menu. */
  setInGame(inGame: boolean) {
    const vis = inGame ? '' : 'none';
    this.scoreBlue.parentElement!.style.display = inGame ? 'flex' : 'none';
    document.getElementById('boostWrap')!.style.display = vis;
  }

  setBoost(v: number) {
    const b = Math.round(v);
    if (b !== this.lastBoost) {
      this.boostNum.textContent = String(b);
      this.boostFill.style.width = `${b}%`;
      this.lastBoost = b;
    }
  }

  /** Big center text. Pass '' to hide. `goal` styles it gold with a pop animation. */
  setCenter(text: string, sub = '', goal = false) {
    if (text !== this.lastCenter) {
      this.center.textContent = text;
      this.center.classList.toggle('goal', goal);
      this.center.classList.toggle('show', text !== '');
      this.lastCenter = text;
    }
    this.centerSub.textContent = sub;
    this.centerSub.classList.toggle('show', sub !== '');
  }

  showOverlay(title: string, sub: string, color = '#e8f0ff') {
    this.overlayTitle.textContent = title;
    this.overlayTitle.style.color = color;
    this.overlaySub.textContent = sub;
    this.overlay.classList.add('show');
  }

  hideOverlay() {
    this.overlay.classList.remove('show');
  }

  teamLabel(team: Team): string {
    return TEAM_NAME[team];
  }
}
