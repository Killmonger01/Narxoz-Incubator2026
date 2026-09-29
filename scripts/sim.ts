// Headless balance check: runs many bot-vs-bot and scripted matches.
import { createMatch, step, applyAction, type GameEvent, type MatchState, type Action } from '../src/shared/engine.ts';
import { Bot, type Difficulty } from '../src/shared/bot.ts';

type Brain = { think(s: MatchState): Action[]; observe?(s: MatchState, e: GameEvent[]): void };

const spammer = (i: number): Brain => ({ think: (s) => (s.tick % 7 === 0 ? [{ t: 'pull' }] : []) });
const holder = (i: number): Brain => ({ think: () => [{ t: 'pull' }] }); // "holding the key" = pull every tick
const idle = (): Brain => ({ think: () => [] });

function play(a: Brain, b: Brain, seconds = 60) {
  const s = createMatch({ durationSec: seconds, teamSize: 1 });
  let ev: GameEvent[] = [];
  while (s.phase !== 'finished') {
    for (const [i, br] of [a, b].entries()) for (const act of br.think(s)) applyAction(s, i, act, ev);
    const e2: GameEvent[] = [];
    step(s, e2);
    ev = [...ev, ...e2];
    a.observe?.(s, ev); b.observe?.(s, ev);
    ev = [];
  }
  return s;
}

function series(name: string, mk: (seed: number) => [Brain, Brain], n = 200) {
  let l = 0, r = 0, d = 0, line = 0, dur = 0;
  for (let k = 0; k < n; k++) {
    const s = play(...mk(k * 7919 + 1));
    if (s.winner === 0) l++; else if (s.winner === 1) r++; else d++;
    if (s.reason === 'line') line++;
    dur += (s.tick - s.startTick) / 60;
  }
  console.log(`${name.padEnd(28)} L ${(l/n*100).toFixed(0)}%  R ${(r/n*100).toFixed(0)}%  draw ${(d/n*100).toFixed(0)}%  byLine ${(line/n*100).toFixed(0)}%  avg ${(dur/n).toFixed(1)}s`);
}

const D: Difficulty[] = ['easy', 'medium', 'hard', 'champion'];
for (const x of D) series(`${x} vs ${x}`, (sd) => [new Bot(0, x, sd), new Bot(1, x, sd + 1)]);
for (let i = 0; i < 3; i++) series(`${D[i]} vs ${D[i+1]}`, (sd) => [new Bot(0, D[i], sd), new Bot(1, D[i+1], sd + 1)]);
series('easy vs champion', (sd) => [new Bot(0, 'easy', sd), new Bot(1, 'champion', sd + 1)]);
for (const x of D) series(`spammer vs ${x}`, (sd) => [spammer(0), new Bot(1, x, sd)], 50);
for (const x of D) series(`holder vs ${x}`, (sd) => [holder(0), new Bot(1, x, sd)], 50);
series('idle vs easy', (sd) => [idle(), new Bot(1, 'easy', sd)], 20);
series('spammer vs idle', () => [spammer(0), idle()], 1);
// A skilled human: perfect rhythm ±2 ticks, rests at 25, bursts when ready.
import { rng } from '../src/shared/bot.ts';
const human = (jit: number) => (seed: number): Brain => {
  const r = rng(seed); let resting = false; let next = -1;
  return { think(s) {
    if (s.phase !== 'playing') return [];
    const me = s.players[0]; const out: Action[] = [];
    if (me.stamina < 25) resting = true; if (me.stamina > 75) resting = false;
    if (me.burstCharge >= 100 && me.stamina > 20) out.push({ t: 'burst' });
    if (resting) return out;
    if (next < s.tick) { const t = s.tick - s.startTick; next = s.startTick + Math.ceil((t + 3) / 36) * 36 + Math.round((r() * 2 - 1) * jit); }
    if (s.tick === next) out.push({ t: 'pull' });
    return out;
  } };
};
for (const j of [2, 4, 6]) for (const x of D) series(`human±${j} vs ${x}`, (sd) => [human(j)(sd), new Bot(1, x, sd)], 100);
