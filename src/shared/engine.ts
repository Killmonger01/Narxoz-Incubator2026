// Pure, deterministic game logic shared by the browser (local modes),
// the bot and the server (online rooms). No DOM, no timers, no randomness:
// the caller advances the match with step() at a fixed 60 Hz tick and feeds
// player actions through applyAction().

export const TICK_HZ = 60;
export const COUNTDOWN_TICKS = 3 * TICK_HZ;
export const BEAT_TICKS = 36; // 0.6 s -> 100 BPM
export const BEAT_WINDOW = 6; // ±100 ms counts as "in rhythm"
export const MIN_PULL_GAP = 7; // ~117 ms: faster taps are ignored
export const REST_DELAY = 24; // 0.4 s without pulling before stamina regenerates
export const EXHAUST_TICKS = 90; // 1.5 s knocked out after running dry
export const BRACE_DELAY = 6; // brace needs 100 ms to take hold
export const DRAW_ZONE = 0.1; // on timeout |pos| below this is a draw

export const MAX_STAMINA = 100;
export const PULL_COST = 6;
export const PULL_COST_BEAT = 4;
export const PULL_POWER = 1;
export const PULL_POWER_BEAT = 3;
export const SYNC_BONUS = 1.5; // teammates hitting the same beat
export const BURST_COST = 15;
export const BURST_POWER = 8;
export const BURST_CHARGE_PER_BEAT = 25;
export const BURST_BREAK_BONUS = 1.5; // opponent exhausted or resting
export const BURST_BLOCKED = 0.5; // opponent braced when the burst lands
export const TEAM_BURST_WINDOW = 20;
export const TEAM_BURST_BONUS = 1.4;
export const BRACE_FACTOR = 0.4; // opponent force multiplier while braced
export const BRACE_DRAIN = 5 / TICK_HZ;
export const REGEN_REST = 18 / TICK_HZ;
export const REGEN_EXHAUSTED = 20 / TICK_HZ;
export const FORCE_DECAY = 0.94;
export const ROPE_K = 0.144; // rope speed per unit of net force (per second)
export const ROPE_SMOOTH = 0.1;

export type Team = 0 | 1; // 0 = left (pulls pos towards -1), 1 = right (+1)

export interface MatchConfig {
  durationSec: number;
  teamSize: number; // players per team (1 or 2)
  startPos?: number; // challenges can start off-center
  practice?: boolean; // training: the rope stops short of the lines
}

export interface PlayerStats {
  pulls: number;
  onBeat: number;
  bursts: number;
  burstsBlocked: number;
  breaks: number;
  exhaustions: number;
  maxCombo: number;
  syncs: number;
}

export interface PlayerState {
  team: Team;
  stamina: number;
  force: number;
  lastPullTick: number;
  lastBeatIdx: number; // beat index of the last in-rhythm pull
  combo: number;
  burstCharge: number;
  lastBurstTick: number;
  exhaustedUntil: number;
  braceSince: number; // -1 when not bracing
  stats: PlayerStats;
}

export type Phase = 'countdown' | 'playing' | 'finished';
export type EndReason = 'line' | 'time' | 'forfeit';

export interface MatchState {
  cfg: MatchConfig;
  phase: Phase;
  tick: number;
  startTick: number;
  endTick: number;
  pos: number;
  vel: number;
  players: PlayerState[];
  winner: Team | 'draw' | null;
  reason: EndReason | null;
}

export type GameEvent =
  | { type: 'countdown'; n: number }
  | { type: 'start' }
  | { type: 'beat'; idx: number }
  | { type: 'pull'; p: number; onBeat: boolean; sync: boolean; combo: number }
  | { type: 'burst'; p: number; result: 'normal' | 'blocked' | 'break'; teamBurst: boolean }
  | { type: 'burstReady'; p: number }
  | { type: 'exhausted'; p: number }
  | { type: 'brace'; p: number; on: boolean }
  | { type: 'end'; winner: Team | 'draw'; reason: EndReason };

export type Action = { t: 'pull' } | { t: 'burst' } | { t: 'brace'; on: boolean };
export type Reject = 'not-playing' | 'too-fast' | 'exhausted' | 'bracing' | 'no-charge' | 'no-stamina';

export function newPlayer(team: Team): PlayerState {
  return {
    team,
    stamina: MAX_STAMINA,
    force: 0,
    lastPullTick: -999,
    lastBeatIdx: -999,
    combo: 0,
    burstCharge: 0,
    lastBurstTick: -999,
    exhaustedUntil: -1,
    braceSince: -1,
    stats: { pulls: 0, onBeat: 0, bursts: 0, burstsBlocked: 0, breaks: 0, exhaustions: 0, maxCombo: 0, syncs: 0 },
  };
}

// Players are ordered team by team: [left..., right...].
export function createMatch(cfg: MatchConfig): MatchState {
  const players: PlayerState[] = [];
  for (let i = 0; i < cfg.teamSize; i++) players.push(newPlayer(0));
  for (let i = 0; i < cfg.teamSize; i++) players.push(newPlayer(1));
  return {
    cfg,
    phase: 'countdown',
    tick: 0,
    startTick: COUNTDOWN_TICKS,
    endTick: COUNTDOWN_TICKS + cfg.durationSec * TICK_HZ,
    pos: cfg.startPos ?? 0,
    vel: 0,
    players,
    winner: null,
    reason: null,
  };
}

export const isBracing = (s: MatchState, p: PlayerState) =>
  p.braceSince >= 0 && s.tick - p.braceSince >= BRACE_DELAY;
export const isExhausted = (s: MatchState, p: PlayerState) => s.tick < p.exhaustedUntil;
export const isResting = (s: MatchState, p: PlayerState) =>
  p.braceSince < 0 && !isExhausted(s, p) && s.tick - p.lastPullTick >= REST_DELAY;

/** Pull effectiveness drops as the player tires. */
export const fatigue = (p: PlayerState) => 0.55 + 0.45 * (p.stamina / MAX_STAMINA);

/** Offset (in ticks) of `tick` from the nearest beat, and that beat's index. */
export function beatInfo(s: MatchState, tick = s.tick) {
  const t = tick - s.startTick;
  const idx = Math.round(t / BEAT_TICKS);
  return { idx, offset: t - idx * BEAT_TICKS };
}

export const secondsLeft = (s: MatchState) =>
  Math.max(0, (s.endTick - Math.max(s.tick, s.startTick)) / TICK_HZ);

const opponents = (s: MatchState, team: Team) => s.players.filter((p) => p.team !== team);
const teammates = (s: MatchState, i: number) =>
  s.players.filter((p, j) => j !== i && p.team === s.players[i].team);

/**
 * Applies one player action at the current tick. `atTick` lets the server
 * judge rhythm at the moment the client pressed the key (lag compensation);
 * it is clamped by the caller to a short window in the past.
 */
export function applyAction(
  s: MatchState,
  i: number,
  a: Action,
  events: GameEvent[],
  atTick = s.tick,
): Reject | null {
  const p = s.players[i];
  if (!p) return 'not-playing';
  if (a.t === 'brace') {
    if (s.phase !== 'playing') {
      p.braceSince = -1;
      return a.on ? 'not-playing' : null;
    }
    const was = p.braceSince >= 0;
    if (a.on && !was && !isExhausted(s, p)) p.braceSince = s.tick;
    if (!a.on) p.braceSince = -1;
    if (was !== p.braceSince >= 0) events.push({ type: 'brace', p: i, on: p.braceSince >= 0 });
    return null;
  }
  if (s.phase !== 'playing') return 'not-playing';
  if (isExhausted(s, p)) return 'exhausted';
  if (p.braceSince >= 0) return 'bracing';

  if (a.t === 'pull') {
    if (atTick - p.lastPullTick < MIN_PULL_GAP) return 'too-fast';
    p.lastPullTick = atTick;
    const { idx, offset } = beatInfo(s, atTick);
    const onBeat = Math.abs(offset) <= BEAT_WINDOW && idx !== p.lastBeatIdx;
    let power = onBeat ? PULL_POWER_BEAT : PULL_POWER;
    let sync = false;
    if (onBeat) {
      p.combo = p.lastBeatIdx === idx - 1 ? p.combo + 1 : 1;
      p.lastBeatIdx = idx;
      p.stats.onBeat++;
      p.stats.maxCombo = Math.max(p.stats.maxCombo, p.combo);
      sync = teammates(s, i).some((m) => m.lastBeatIdx === idx);
      if (sync) {
        power *= SYNC_BONUS;
        p.stats.syncs++;
      }
      const before = p.burstCharge;
      p.burstCharge = Math.min(100, p.burstCharge + BURST_CHARGE_PER_BEAT);
      if (before < 100 && p.burstCharge >= 100) events.push({ type: 'burstReady', p: i });
    } else {
      p.combo = 0;
    }
    p.force += power * fatigue(p);
    p.stats.pulls++;
    spend(s, p, i, onBeat ? PULL_COST_BEAT : PULL_COST, events);
    events.push({ type: 'pull', p: i, onBeat, sync, combo: p.combo });
    return null;
  }

  // burst
  if (p.burstCharge < 100) return 'no-charge';
  if (p.stamina < BURST_COST) return 'no-stamina';
  const opp = opponents(s, p.team);
  const blocked = opp.some((o) => isBracing(s, o));
  const broken = !blocked && opp.every((o) => isExhausted(s, o) || isResting(s, o));
  const teamBurst = teammates(s, i).some((m) => s.tick - m.lastBurstTick <= TEAM_BURST_WINDOW);
  let power = BURST_POWER * fatigue(p);
  if (blocked) power *= BURST_BLOCKED;
  if (broken) power *= BURST_BREAK_BONUS;
  if (teamBurst) power *= TEAM_BURST_BONUS;
  p.force += power;
  p.burstCharge = 0;
  p.combo = 0;
  p.lastBurstTick = s.tick;
  p.stats.bursts++;
  if (blocked) p.stats.burstsBlocked++;
  if (broken) p.stats.breaks++;
  spend(s, p, i, BURST_COST, events);
  events.push({ type: 'burst', p: i, result: blocked ? 'blocked' : broken ? 'break' : 'normal', teamBurst });
  return null;
}

function spend(s: MatchState, p: PlayerState, i: number, cost: number, events: GameEvent[]) {
  p.stamina -= cost;
  if (p.stamina <= 0) {
    p.stamina = 0;
    p.exhaustedUntil = s.tick + EXHAUST_TICKS;
    p.combo = 0;
    p.braceSince = -1;
    p.stats.exhaustions++;
    events.push({ type: 'exhausted', p: i });
  }
}

/** Advances the match by exactly one tick. */
export function step(s: MatchState, events: GameEvent[]) {
  if (s.phase === 'finished') return;
  s.tick++;

  if (s.phase === 'countdown') {
    const left = s.startTick - s.tick;
    if (left > 0 && left % TICK_HZ === 0) events.push({ type: 'countdown', n: left / TICK_HZ });
    if (left <= 0) {
      s.phase = 'playing';
      events.push({ type: 'start' }, { type: 'beat', idx: 0 });
    }
    return;
  }

  const { idx, offset } = beatInfo(s);
  if (offset === 0 && idx > 0) events.push({ type: 'beat', idx });

  const teamForce = [0, 0];
  const braced = [false, false];
  for (const p of s.players) {
    if (p.braceSince >= 0) {
      p.stamina -= BRACE_DRAIN;
      if (p.stamina <= 0) {
        p.stamina = 0;
        p.braceSince = -1;
      }
    } else if (isExhausted(s, p)) {
      p.stamina += REGEN_EXHAUSTED;
    } else if (s.tick - p.lastPullTick >= REST_DELAY) {
      p.stamina += REGEN_REST;
    }
    p.stamina = Math.min(MAX_STAMINA, p.stamina);
    if (isBracing(s, p)) braced[p.team] = true;
    teamForce[p.team] += p.force;
    p.force *= FORCE_DECAY;
  }
  // Bracing weakens the *opposing* team's pull.
  const left = teamForce[0] * (braced[1] ? BRACE_FACTOR : 1);
  const right = teamForce[1] * (braced[0] ? BRACE_FACTOR : 1);
  const target = ((right - left) * ROPE_K) / s.cfg.teamSize;
  s.vel += (target - s.vel) * ROPE_SMOOTH;
  s.pos += s.vel / TICK_HZ;

  if (s.cfg.practice) {
    s.pos = Math.max(-0.95, Math.min(0.95, s.pos));
    if (Math.abs(s.pos) >= 0.95) s.vel = 0;
    if (s.tick >= s.endTick) finish(s, 'draw', 'time', events);
  } else if (s.pos <= -1 || s.pos >= 1) {
    s.pos = Math.max(-1, Math.min(1, s.pos));
    finish(s, s.pos < 0 ? 0 : 1, 'line', events);
  } else if (s.tick >= s.endTick) {
    finish(s, Math.abs(s.pos) < DRAW_ZONE ? 'draw' : s.pos < 0 ? 0 : 1, 'time', events);
  }
}

export function finish(s: MatchState, winner: Team | 'draw', reason: EndReason, events: GameEvent[]) {
  if (s.phase === 'finished') return;
  s.phase = 'finished';
  s.winner = winner;
  s.reason = reason;
  for (const p of s.players) p.braceSince = -1;
  events.push({ type: 'end', winner, reason });
}

/** Sum of stats for one team (for result screens). */
export function teamStats(s: MatchState, team: Team): PlayerStats {
  const sum: PlayerStats = { pulls: 0, onBeat: 0, bursts: 0, burstsBlocked: 0, breaks: 0, exhaustions: 0, maxCombo: 0, syncs: 0 };
  for (const p of s.players) {
    if (p.team !== team) continue;
    for (const k of Object.keys(sum) as (keyof PlayerStats)[])
      sum[k] = k === 'maxCombo' ? Math.max(sum[k], p.stats[k]) : sum[k] + p.stats[k];
  }
  return sum;
}
