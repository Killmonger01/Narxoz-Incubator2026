// Computer opponent. It plays through the same applyAction() as humans, so it
// pays stamina, gets exhausted and is rate-limited exactly like a player.
// It only looks at information a human sees on screen (stamina bars, burst
// charge, rope position) and reacts to events with a human-like delay.

import {
  BRACE_DELAY,
  nextBeatTick,
  rng,
  BURST_COST,
  isExhausted,
  isResting,
  type Action,
  type GameEvent,
  type MatchState,
} from './engine.ts';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'champion';

interface Profile {
  jitter: number; // std-dev of rhythm error, ticks
  miss: number; // chance to skip a beat
  reaction: number; // ticks before the bot notices an event
  restLow: number; // start resting below this stamina
  restHigh: number; // resume pulling above this stamina
  smartBurst: boolean; // waits for a good moment to burst
  preBrace: number; // chance per threat to brace in advance
  reactBrace: boolean; // braces after seeing an enemy burst
  filler: number; // chance of an extra off-beat pull when pressing
  waitOutBrace: boolean; // rests instead of pulling into an enemy brace
}

export const PROFILES: Record<Difficulty, Profile> = {
  easy: { jitter: 9, miss: 0.5, reaction: 36, restLow: 5, restHigh: 40, smartBurst: false, preBrace: 0, reactBrace: false, filler: 0.5, waitOutBrace: false },
  medium: { jitter: 5, miss: 0.1, reaction: 24, restLow: 25, restHigh: 70, smartBurst: false, preBrace: 0.15, reactBrace: true, filler: 0.15, waitOutBrace: false },
  hard: { jitter: 3, miss: 0.05, reaction: 16, restLow: 30, restHigh: 80, smartBurst: true, preBrace: 0.3, reactBrace: true, filler: 0.2, waitOutBrace: true },
  champion: { jitter: 1.6, miss: 0.01, reaction: 10, restLow: 30, restHigh: 85, smartBurst: true, preBrace: 0.2, reactBrace: true, filler: 0.3, waitOutBrace: true },
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Новичок',
  medium: 'Любитель',
  hard: 'Капитан',
  champion: 'Чемпион',
};

export { rng };

export class Bot {
  private p: Profile;
  private rand: () => number;
  private resting = false;
  private nextPullTick = -1;
  private fillerTick = -1;
  private braceUntil = -1;
  private seen: { at: number; e: GameEvent }[] = [];
  private threatHandled = false;

  readonly index: number;
  readonly difficulty: Difficulty;

  constructor(index: number, difficulty: Difficulty, seed = Date.now()) {
    this.index = index;
    this.difficulty = difficulty;
    this.p = PROFILES[difficulty];
    this.rand = rng(seed);
  }

  private gauss() {
    const u = 1 - this.rand();
    const v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Feed the events produced this tick; the bot "sees" them after its reaction delay. */
  observe(s: MatchState, events: GameEvent[]) {
    for (const e of events) this.seen.push({ at: s.tick + this.p.reaction, e });
  }

  /** Decide what to do on the current tick. */
  think(s: MatchState): Action[] {
    if (s.phase !== 'playing') return [];
    const me = s.players[this.index];
    const out: Action[] = [];
    const opps = s.players.filter((o) => o.team !== me.team);
    const myDir = me.team === 0 ? -1 : 1;
    const danger = -s.pos * myDir; // > 0 when the rope is on the bot's side of danger
    const secsLeft = (s.endTick - s.tick) / 60;

    // React to events that have become "visible".
    let enemyBurst = false;
    while (this.seen.length && this.seen[0].at <= s.tick) {
      const { e } = this.seen.shift()!;
      if (e.type === 'burst' && s.players[e.p].team !== me.team) enemyBurst = true;
    }

    // Brace handling.
    if (me.braceSince >= 0) {
      if (s.tick >= this.braceUntil || me.stamina < 8) out.push({ t: 'brace', on: false });
      return out;
    }
    if (isExhausted(s, me)) return out;
    if (enemyBurst && this.p.reactBrace && me.stamina > 15) {
      this.braceUntil = s.tick + 18;
      return [{ t: 'brace', on: true }];
    }
    const threat = opps.some((o) => o.burstCharge >= 100 && o.stamina >= BURST_COST && !isExhausted(s, o));
    if (!threat) this.threatHandled = false;
    if (threat && !this.threatHandled) {
      this.threatHandled = true;
      if (this.rand() < this.p.preBrace && me.stamina > 25) {
        this.braceUntil = s.tick + BRACE_DELAY + 30 + Math.floor(this.rand() * 40);
        return [{ t: 'brace', on: true }];
      }
    }

    // Stamina management: rest to recover, unless the rope is about to be lost.
    if (!this.resting && me.stamina < this.p.restLow && danger < 0.75) this.resting = true;
    if (this.resting && (me.stamina >= this.p.restHigh || danger > 0.8 || secsLeft < 3)) this.resting = false;

    // Burst decisions.
    if (me.burstCharge >= 100 && me.stamina >= BURST_COST) {
      const oppsVulnerable = opps.every((o) => isExhausted(s, o) || isResting(s, o));
      const oppsBracing = opps.some((o) => o.braceSince >= 0);
      let go: boolean;
      if (!this.p.smartBurst) go = !oppsBracing || this.rand() < 0.02;
      else go = !oppsBracing && (oppsVulnerable || danger > 0.5 || secsLeft < 4 || opps.every((o) => o.stamina < 35));
      if (go) {
        out.push({ t: 'burst' });
        return out;
      }
    }
    const oppsBraced = opps.some((o) => o.braceSince >= 0);
    if (this.resting || (this.p.waitOutBrace && oppsBraced && danger < 0.6)) {
      this.nextPullTick = -1;
      return out;
    }

    // Rhythm: aim for the next beat (tempo may change) with some human error.
    if (this.nextPullTick < s.tick) {
      let nextBeat = nextBeatTick(s, s.tick + 3);
      if (this.rand() < this.p.miss) nextBeat = nextBeatTick(s, nextBeat + 1);
      this.nextPullTick = nextBeat + Math.round(this.gauss() * this.p.jitter);
      // Occasionally add an off-beat pull between beats when pressing an advantage.
      const pressing = opps.some((o) => isExhausted(s, o) || isResting(s, o)) || danger > 0.4;
      this.fillerTick =
        pressing && me.stamina > 50 && this.rand() < this.p.filler ? Math.round((s.tick + nextBeat) / 2) : -1;
    }
    if (s.tick === this.fillerTick) out.push({ t: 'pull' });
    if (s.tick === this.nextPullTick) out.push({ t: 'pull' });
    return out;
  }
}
