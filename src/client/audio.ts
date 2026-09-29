// Tiny WebAudio synth: every sound is generated, no audio files to load.
import { getSettings } from './store.ts';

let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;

function ac() {
  if (!getSettings().sound) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Call from a user gesture so browsers allow audio. */
export const unlockAudio = () => void ac();

const vol = () => getSettings().volume;

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, slideTo?: number, delay = 0) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain * vol(), t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, freq: number, gain = 0.3, q = 1, sweepTo?: number) {
  const c = ac();
  if (!c || !noiseBuf) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain * vol(), t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

export const sfx = {
  beat: (idx: number) => tone(idx % 2 === 0 ? 220 : 165, 0.07, 'triangle', 0.12),
  pull: () => noise(0.09, 500, 0.18, 2),
  pullBeat: (combo: number) => {
    tone(330 * Math.pow(1.06, Math.min(combo, 12)), 0.14, 'triangle', 0.22);
    noise(0.08, 900, 0.1, 3);
  },
  sync: () => tone(660, 0.18, 'sine', 0.15, 990),
  burst: () => {
    noise(0.45, 300, 0.45, 0.8, 2500);
    tone(90, 0.3, 'sine', 0.45, 45);
  },
  blocked: () => {
    tone(260, 0.15, 'square', 0.14, 180);
    noise(0.15, 1800, 0.15, 6);
  },
  burstReady: () => tone(520, 0.12, 'sine', 0.18, 780),
  exhausted: () => tone(300, 0.5, 'sawtooth', 0.1, 110),
  brace: () => noise(0.12, 200, 0.2, 1),
  countdown: () => tone(440, 0.15, 'square', 0.12),
  start: () => tone(880, 0.4, 'square', 0.14),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.2, undefined, i * 0.11)),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'triangle', 0.16, undefined, i * 0.15)),
  crowd: () => noise(1.2, 1200, 0.12, 0.5, 700),
  denied: () => tone(180, 0.12, 'square', 0.08, 140),
  click: () => tone(700, 0.04, 'triangle', 0.1),
};
