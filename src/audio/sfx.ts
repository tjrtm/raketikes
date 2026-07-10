import { S, onSettingsChange } from '../game/settings';

/**
 * Procedural WebAudio sound: no assets, everything synthesized.
 * The AudioContext is created lazily on the first user gesture (browsers
 * block audio before one). All one-shots run through a master gain that
 * follows the persisted volume/mute settings.
 *
 * Continuous layers:
 *  - engine: two detuned saws through a lowpass; pitch & level track speed
 *  - boost roar: bandpass-filtered noise, faded in while boosting
 *  - wind: lowpass noise whose level tracks speed (sells velocity)
 */
class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  // continuous engine layers
  private engOsc1: OscillatorNode | null = null;
  private engOsc2: OscillatorNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  private engGain: GainNode | null = null;
  private boostGain: GainNode | null = null;
  private windGain: GainNode | null = null;

  constructor() {
    const unlock = () => this.ensure();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock, { passive: true });
    onSettingsChange((key) => {
      if (key === 'volume' || key === 'muted') this.applyVolume();
    });
  }

  private applyVolume() {
    if (!this.ctx || !this.master) return;
    const v = S.muted ? 0 : (S.volume / 100) ** 1.6; // perceptual-ish curve
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Create the context + persistent graph. Safe to call repeatedly. */
  private ensure(): AudioContext | null {
    if (this.ctx) {
      // covers 'suspended' AND iOS Safari's non-standard 'interrupted'
      // (phone call / Siri / screen lock), which also needs an explicit resume
      if (this.ctx.state !== 'running') void this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.applyVolume();

    // shared noise source material (2s of white noise, looped by consumers)
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // --- engine: saw pair -> lowpass -> gain ---
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 220;
    this.engFilter.Q.value = 1.2;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter.connect(this.engGain).connect(this.master);
    this.engOsc1 = ctx.createOscillator();
    this.engOsc1.type = 'sawtooth';
    this.engOsc1.frequency.value = 42;
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'square';
    this.engOsc2.frequency.value = 21.3; // ~half, slightly detuned -> beating rumble
    this.engOsc1.connect(this.engFilter);
    this.engOsc2.connect(this.engFilter);
    this.engOsc1.start();
    this.engOsc2.start();

    // --- boost roar: bandpassed noise ---
    const boostSrc = ctx.createBufferSource();
    boostSrc.buffer = buf;
    boostSrc.loop = true;
    const boostBp = ctx.createBiquadFilter();
    boostBp.type = 'bandpass';
    boostBp.frequency.value = 640;
    boostBp.Q.value = 0.7;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    boostSrc.connect(boostBp).connect(this.boostGain).connect(this.master);
    boostSrc.start();

    // --- wind: dark noise, speed-scaled ---
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = buf;
    windSrc.loop = true;
    windSrc.playbackRate.value = 0.5;
    const windLp = ctx.createBiquadFilter();
    windLp.type = 'lowpass';
    windLp.frequency.value = 420;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(windLp).connect(this.windGain).connect(this.master);
    windSrc.start();

    return ctx;
  }

  /**
   * Per-frame: drive the continuous layers from the local car state.
   * speed/boostMax normalized outside — pass raw speed in game units.
   */
  updateEngine(speed: number, boosting: boolean, active: boolean) {
    if (!this.ctx || !this.engGain) return;
    const t = this.ctx.currentTime;
    const s = Math.min(speed / 46, 1); // 46 = boost max speed
    const level = active ? 0.055 + s * 0.075 : 0;
    this.engGain.gain.setTargetAtTime(level, t, 0.08);
    this.engOsc1!.frequency.setTargetAtTime(42 + s * 130, t, 0.06);
    this.engOsc2!.frequency.setTargetAtTime(21.3 + s * 64, t, 0.06);
    this.engFilter!.frequency.setTargetAtTime(220 + s * 900, t, 0.08);
    this.boostGain!.gain.setTargetAtTime(boosting && active ? 0.14 : 0, t, boosting ? 0.05 : 0.12);
    this.windGain!.gain.setTargetAtTime(active ? s * s * 0.1 : 0, t, 0.15);
  }

  /** Ball contact thump; strength 0..1 (powerHit already computes it). */
  ballHit(strength: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const k = Math.min(Math.max(strength, 0.1), 1);
    // low thump
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140 + 80 * k, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * k, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
    // click of the contact
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25 * k, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(bp).connect(ng).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.1);
  }

  /** Goal scored: explosion + crowd swell. */
  goal() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t = ctx.currentTime;
    // explosion: noise burst, lowpass sweeping down
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 1.1);
    // sub boom
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.7);
    this.crowd(1.0);
  }

  /** Crowd swell; intensity 0..1. Also used quietly at match end. */
  crowd(intensity: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    // slow wobble so it reads as a crowd, not static
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.3;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 180;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start(t);
    lfo.stop(t + 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * intensity, t + 0.35);
    g.gain.setValueAtTime(0.22 * intensity, t + 1.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.9);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 3);
  }

  /** Countdown "3, 2, 1" tick. */
  countdownBeep() {
    this.beep(440, 0.09, 0.18);
  }

  /** "GO!" hit — brighter, longer. */
  goBeep() {
    this.beep(880, 0.22, 0.22);
  }

  /** UI click for menu focus/activate. */
  click() {
    this.beep(1320, 0.035, 0.08);
  }

  /** Boost pad pickup blip. */
  pickup() {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /** Landing thud; strength ~ vertical impact speed 0..1. */
  land(strength: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const k = Math.min(strength, 1);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3 * k, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.14);
  }

  /** Jump/flip whoosh. */
  jump() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(1100, t + 0.16);
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.22);
  }

  private beep(freq: number, dur: number, vol: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }
}

/** Singleton, same pattern as settings' S. */
export const SFX = new SfxEngine();
