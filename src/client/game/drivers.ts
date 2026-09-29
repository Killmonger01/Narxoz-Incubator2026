// A driver feeds the game view: the local one runs the engine in the browser
// (bot, same-device and training modes), the online one mirrors the server.
import { applyAction, createMatch, step, TICK_HZ, type Action, type GameEvent, type MatchConfig, type MatchState } from '../../shared/engine.ts';
import { Bot, type Difficulty } from '../../shared/bot.ts';

export interface Driver {
  state(): MatchState | null;
  tickF(): number;
  drain(): GameEvent[];
  act(player: number, a: Action): void;
  update(dtMs: number): void;
  paused(): boolean;
}

/**
 * Fixed-timestep simulation: game speed is independent of the frame rate.
 * Inputs are queued and applied at the start of the next tick, so a 144 Hz
 * screen gives no advantage over a 60 Hz one.
 */
export class LocalDriver implements Driver {
  s: MatchState;
  bots: (Bot | null)[];
  private acc = 0;
  private queue: { p: number; a: Action }[] = [];
  private events: GameEvent[] = [];
  private hold = false;

  constructor(cfg: MatchConfig, bots: (Difficulty | null)[] = []) {
    this.s = createMatch(cfg);
    this.bots = this.s.players.map((_, i) => (bots[i] ? new Bot(i, bots[i]!, Math.floor(Math.random() * 1e9)) : null));
  }

  state() {
    return this.s;
  }
  tickF() {
    return this.s.tick + this.acc;
  }
  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }
  act(p: number, a: Action) {
    if (this.s.phase === 'finished') return;
    this.queue.push({ p, a });
  }
  setPaused(v: boolean) {
    this.hold = v;
  }
  paused() {
    return this.hold;
  }

  update(dtMs: number) {
    if (this.hold || this.s.phase === 'finished') return;
    // After a long frame (tab switch) do not fast-forward the match.
    this.acc += Math.min(dtMs, 250) * (TICK_HZ / 1000);
    let n = 0;
    while (this.acc >= 1 && n++ < 15) {
      this.acc -= 1;
      const ev: GameEvent[] = [];
      for (const { p, a } of this.queue) applyAction(this.s, p, a, ev);
      this.queue = [];
      this.bots.forEach((b, i) => b && b.think(this.s).forEach((a) => applyAction(this.s, i, a, ev)));
      step(this.s, ev);
      this.bots.forEach((b) => b?.observe(this.s, ev));
      this.events.push(...ev);
      if ((this.s.phase as string) === 'finished') {
        this.acc = 0;
        break;
      }
    }
  }
}

/** Mirrors the authoritative server state and estimates the current server tick. */
export class OnlineDriver implements Driver {
  s: MatchState | null = null;
  private events: GameEvent[] = [];
  private lastTick = 0;
  private lastRecv = 0;
  private held = false;
  send: (a: Action, at: number) => void = () => {};

  onState(s: MatchState, ev: GameEvent[], paused: boolean) {
    // A new round starts from tick 0 again.
    this.s = s;
    this.events.push(...ev);
    this.lastTick = s.tick;
    this.lastRecv = performance.now();
    this.held = paused;
  }
  setHeld(v: boolean) {
    this.held = v;
  }
  state() {
    return this.s;
  }
  tickF() {
    if (!this.s) return 0;
    if (this.held || this.s.phase === 'finished') return this.s.tick;
    // Extrapolate between 20 Hz snapshots, but never run far ahead of the server.
    const ahead = ((performance.now() - this.lastRecv) * TICK_HZ) / 1000;
    return this.lastTick + Math.min(ahead, 6);
  }
  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }
  act(_p: number, a: Action) {
    if (!this.s || this.s.phase !== 'playing') return;
    this.send(a, Math.floor(this.tickF()));
  }
  update() {}
  paused() {
    return this.held;
  }
}
