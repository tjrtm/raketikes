// Live, persisted game settings. `S` is a singleton read directly by gameplay code;
// updateSetting() persists to localStorage and notifies listeners for things that
// need explicit re-application (environment rebuild, colors, FOV).

export interface Settings {
  stadium: 'neon' | 'space' | 'sunset';
  botLevel: 'rookie' | 'pro' | 'allstar';
  matchLength: number;   // seconds
  gameSpeed: number;     // global time scale
  blueColor: string;     // css hex
  orangeColor: string;
  unlimitedBoost: boolean;
  cameraFov: number;
  particles: boolean;
}

export const DEFAULTS: Settings = {
  stadium: 'neon',
  botLevel: 'pro',
  matchLength: 180,
  gameSpeed: 1,
  blueColor: '#2fa3ff',
  orangeColor: '#ff8a2a',
  unlimitedBoost: false,
  cameraFov: 72,
  particles: true,
};

const KEY = 'rocket-arena-settings';

export const S: Settings = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
})();

type Listener = (key: keyof Settings) => void;
const listeners: Listener[] = [];

export function onSettingsChange(fn: Listener) {
  listeners.push(fn);
}

export function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  S[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch { /* private mode etc — settings just won't persist */ }
  for (const fn of listeners) fn(key);
}

export function colorNum(css: string): number {
  return parseInt(css.replace('#', ''), 16);
}
