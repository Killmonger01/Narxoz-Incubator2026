// One online room = one Durable Object. It owns the authoritative match:
// clients only send intents ("pull", "burst", "brace"), the room validates
// them through the shared engine, advances time itself and broadcasts the
// resulting state. A client therefore cannot move the rope, skip stamina
// costs, replay an action or declare a winner on its own.

import { DurableObject } from 'cloudflare:workers';
import { applyAction, createMatch, finish, step, type Action, type GameEvent, type MatchState } from '../shared/engine.ts';
import { Bot, DIFFICULTY_LABEL, type Difficulty } from '../shared/bot.ts';
import { DEFAULT_COSMETICS, type Cosmetics } from '../shared/cosmetics.ts';
import { RECONNECT_GRACE_MS, type ClientMsg, type RoomInfo, type RoomPhase, type ServerMsg } from '../shared/protocol.ts';
import { publicUser, userFromToken, type Env } from './auth.ts';

interface RoomConfig {
  code: string;
  teamSize: number;
  bestOf: number;
  durationSec: number;
  createdAt: number;
}

interface Slot {
  cid: string | null;
  name: string;
  userId: string | null;
  rating: number;
  cosmetics: Cosmetics;
  bot: Difficulty | null;
  ws: WebSocket | null;
  ready: boolean;
  disconnectedAt: number | null;
  lastAt: number; // last accepted client tick (keeps claims monotonic)
}

interface Conn {
  cid: string;
  slot: number; // -1 = spectator
  budget: number;
  budgetAt: number;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'champion'];
const LOOP_MS = 50;
const LAG_TICKS = 9; // accept key presses up to 150 ms in the past
const BETWEEN_MS = 4000;
const RESUME_MS = 3000;
const MSG_PER_SEC = 40;

const emptySlot = (): Slot => ({
  cid: null,
  name: '',
  userId: null,
  rating: 1000,
  cosmetics: DEFAULT_COSMETICS,
  bot: null,
  ws: null,
  ready: false,
  disconnectedAt: null,
  lastAt: -1,
});

export class Room extends DurableObject<Env> {
  private cfg: RoomConfig | null = null;
  private slots: Slot[] = [];
  private conns = new Map<WebSocket, Conn>();
  private phase: RoomPhase = 'lobby';
  private match: MatchState | null = null;
  private bots: (Bot | null)[] = [];
  private series: [number, number] = [0, 0];
  private round = 0;
  private seriesWinner: 0 | 1 | 'draw' | null = null;
  private forfeit = false;
  private rematch = new Set<number>();
  private ratingDelta: Record<number, number> = {};
  private loop: ReturnType<typeof setInterval> | null = null;
  private lastTime = 0;
  private acc = 0;
  private pending: GameEvent[] = []; // events not yet broadcast
  private humanEv: GameEvent[] = []; // human actions not yet seen by bots
  private holdUntil = 0; // resume countdown after a reconnect
  private nextRoundAt = 0;
  private roundTicks = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const cfg = await ctx.storage.get<RoomConfig>('cfg');
      if (cfg) this.setup(cfg);
    });
  }

  private setup(cfg: RoomConfig) {
    this.cfg = cfg;
    this.slots = Array.from({ length: cfg.teamSize * 2 }, emptySlot);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/init' && req.method === 'POST') {
      if (this.cfg) return new Response('exists', { status: 409 });
      const b = (await req.json()) as Omit<RoomConfig, 'createdAt'>;
      const cfg = { ...b, createdAt: Date.now() };
      await this.ctx.storage.put('cfg', cfg);
      this.setup(cfg);
      await this.saveStatus();
      return new Response('ok');
    }
    if (!this.cfg) return new Response('no room', { status: 404 });
    if (url.pathname === '/info') {
      return Response.json({
        code: this.cfg.code,
        teamSize: this.cfg.teamSize,
        bestOf: this.cfg.bestOf,
        phase: this.phase,
        freeSlots: this.phase === 'lobby' ? this.slots.filter((s) => this.isEmpty(s)).length : 0,
      });
    }
    if (req.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      server.accept();
      server.addEventListener('message', (e) => this.onMessage(server, e.data).catch((err) => console.error(err)));
      server.addEventListener('close', () => this.onClose(server));
      server.addEventListener('error', () => this.onClose(server));
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('not found', { status: 404 });
  }

  // ---- helpers -------------------------------------------------------------

  private isEmpty = (s: Slot) => !s.bot && !s.cid;
  private isHuman = (s: Slot) => !s.bot && !!s.cid;
  private team = (i: number) => (i < this.cfg!.teamSize ? 0 : 1) as 0 | 1;
  private host() {
    return this.slots.findIndex((s) => this.isHuman(s) && s.ws);
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }

  private info(you: number): RoomInfo {
    const cfg = this.cfg!;
    const paused = this.pausedSlot();
    return {
      code: cfg.code,
      teamSize: cfg.teamSize,
      bestOf: cfg.bestOf,
      durationSec: cfg.durationSec,
      phase: this.phase,
      slots: this.slots.map((s, i) => ({
        name: s.bot ? `Бот · ${DIFFICULTY_LABEL[s.bot]}` : s.name,
        team: this.team(i),
        bot: s.bot,
        empty: this.isEmpty(s),
        connected: !!s.bot || !!s.ws,
        ready: !!s.bot || s.ready,
        userId: s.userId,
        cosmetics: s.cosmetics,
      })),
      you,
      host: this.host(),
      spectators: [...this.conns.values()].filter((c) => c.slot < 0).length,
      series: this.series,
      round: this.round,
      pausedFor: paused >= 0 ? this.slots[paused].name : null,
      pauseEndsAt: paused >= 0 ? this.slots[paused].disconnectedAt! + RECONNECT_GRACE_MS : null,
      seriesWinner: this.seriesWinner,
      forfeit: this.forfeit,
      rematch: [...this.rematch],
      ratingDelta: this.ratingDelta,
    };
  }

  private broadcastRoom() {
    for (const [ws, c] of this.conns) this.send(ws, { t: 'room', room: this.info(c.slot) });
  }

  /** Index of a human player who dropped during a match, or -1. */
  private pausedSlot() {
    if (this.phase !== 'match' || !this.match || this.match.phase === 'finished') return -1;
    return this.slots.findIndex((s) => this.isHuman(s) && !s.ws);
  }

  private async saveStatus() {
    const cfg = this.cfg!;
    const status = this.phase === 'lobby' ? 'lobby' : this.phase === 'done' ? 'done' : 'match';
    const players = this.slots
      .map((s) => (s.bot ? `Бот` : s.name))
      .filter(Boolean)
      .join(', ');
    try {
      await this.env.DB.prepare(
        `INSERT INTO rooms (code, status, team_size, players, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET status = excluded.status, players = excluded.players, updated_at = excluded.updated_at`,
      )
        .bind(cfg.code, status, cfg.teamSize, players, Date.now())
        .run();
    } catch (e) {
      console.error('saveStatus', e);
    }
  }

  // ---- connections ---------------------------------------------------------

  private async onMessage(ws: WebSocket, raw: unknown) {
    if (typeof raw !== 'string' || raw.length > 2000) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const conn = this.conns.get(ws);
    if (!conn) {
      if (msg.t === 'hello') await this.onHello(ws, msg);
      return;
    }
    // Flood guard: a client cannot gain anything by spamming messages.
    const now = Date.now();
    if (now - conn.budgetAt > 1000) {
      conn.budget = MSG_PER_SEC;
      conn.budgetAt = now;
    }
    if (--conn.budget < 0) return;

    switch (msg.t) {
      case 'ping':
        if (typeof msg.c === 'number') this.send(ws, { t: 'pong', c: msg.c });
        return;
      case 'act':
        return this.onAct(conn, msg.a, msg.at);
      case 'ready':
        if (conn.slot >= 0 && this.phase === 'lobby') {
          this.slots[conn.slot].ready = !!msg.on;
          this.broadcastRoom();
          this.maybeStart();
        }
        return;
      case 'team':
        return this.onTeam(conn, msg.slot);
      case 'bot':
        return this.onBot(conn, msg.slot, msg.difficulty);
      case 'rematch':
        if (conn.slot >= 0 && this.phase === 'done') {
          this.rematch.add(conn.slot);
          const humans = this.slots.map((s, i) => (this.isHuman(s) && s.ws ? i : -1)).filter((i) => i >= 0);
          if (humans.every((i) => this.rematch.has(i))) this.backToLobby();
          else this.broadcastRoom();
        }
        return;
    }
  }

  private async onHello(ws: WebSocket, msg: Extract<ClientMsg, { t: 'hello' }>) {
    const cid = typeof msg.cid === 'string' ? msg.cid.slice(0, 64) : '';
    if (cid.length < 8) return ws.close(1008, 'bad hello');
    let name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 20) : '';
    let userId: string | null = null;
    let rating = 1000;
    let cosmetics = DEFAULT_COSMETICS;
    const user = await userFromToken(this.env, msg.token);
    if (user) {
      const pub = publicUser(user);
      name = pub.username;
      userId = pub.id;
      rating = pub.rating;
      cosmetics = pub.cosmetics;
    }
    if (!name) name = 'Гость';

    // Reconnect to the same seat (same browser tab id, or same account).
    let slot = this.slots.findIndex((s) => !s.bot && (s.cid === cid || (userId && s.userId === userId)));
    if (msg.watch) slot = -1;
    else if (slot >= 0) {
      const s = this.slots[slot];
      if (s.ws && s.ws !== ws) {
        this.conns.delete(s.ws);
        try {
          s.ws.close(4000, 'replaced');
        } catch {}
      }
      const wasPaused = this.pausedSlot() === slot;
      Object.assign(s, { cid, ws, disconnectedAt: null });
      if (wasPaused && this.pausedSlot() < 0) this.holdUntil = Date.now() + RESUME_MS;
    } else if (this.phase === 'lobby') {
      // Take a free seat on the team with fewer humans.
      const free = this.slots.map((s, i) => (this.isEmpty(s) ? i : -1)).filter((i) => i >= 0);
      const humans = (t: number) => this.slots.filter((s, i) => this.team(i) === t && this.isHuman(s)).length;
      free.sort((a, b) => humans(this.team(a)) - humans(this.team(b)) || a - b);
      slot = free.length ? free[0] : -1;
      if (slot >= 0)
        this.slots[slot] = { ...emptySlot(), cid, name, userId, rating, cosmetics, ws };
    } else slot = -1;

    this.conns.set(ws, { cid, slot, budget: MSG_PER_SEC, budgetAt: Date.now() });
    this.broadcastRoom();
    if (this.match) this.send(ws, { t: 'state', s: this.match, ev: [], paused: this.isHeld() });
    this.ensureLoop();
  }

  private onClose(ws: WebSocket) {
    const conn = this.conns.get(ws);
    if (!conn) return;
    this.conns.delete(ws);
    if (conn.slot >= 0) {
      const s = this.slots[conn.slot];
      if (s.ws === ws) {
        s.ws = null;
        if (this.phase === 'lobby') this.slots[conn.slot] = emptySlot();
        else s.disconnectedAt = Date.now();
      }
    }
    this.rematch.delete(conn.slot);
    this.broadcastRoom();
    if (this.phase === 'done' && this.rematch.size) {
      const humans = this.slots.map((s, i) => (this.isHuman(s) && s.ws ? i : -1)).filter((i) => i >= 0);
      if (humans.length && humans.every((i) => this.rematch.has(i))) this.backToLobby();
    }
  }

  private onTeam(conn: Conn, target: number) {
    if (this.phase !== 'lobby' || conn.slot < 0 || !Number.isInteger(target)) return;
    const t = this.slots[target];
    if (!t || !this.isEmpty(t)) return;
    this.slots[target] = { ...this.slots[conn.slot], ready: false };
    this.slots[conn.slot] = emptySlot();
    conn.slot = target;
    this.broadcastRoom();
  }

  private onBot(conn: Conn, target: number, difficulty: Difficulty | null) {
    if (this.phase !== 'lobby' || conn.slot !== this.host() || !Number.isInteger(target)) return;
    const t = this.slots[target];
    if (!t || this.isHuman(t)) return;
    if (difficulty === null) this.slots[target] = emptySlot();
    else if (DIFFICULTIES.includes(difficulty)) this.slots[target] = { ...emptySlot(), bot: difficulty };
    this.broadcastRoom();
    this.maybeStart();
  }

  private onAct(conn: Conn, a: Action, at: unknown) {
    const m = this.match;
    if (!m || this.phase !== 'match' || conn.slot < 0 || this.isHeld()) return;
    if (!a || (a.t !== 'pull' && a.t !== 'burst' && a.t !== 'brace')) return;
    const action: Action = a.t === 'brace' ? { t: 'brace', on: !!a.on } : { t: a.t };
    const s = this.slots[conn.slot];
    // Lag compensation: judge rhythm at the client's key-press tick, but only
    // within a short window and never before the previously accepted press.
    let claimed = typeof at === 'number' && Number.isFinite(at) ? Math.floor(at) : m.tick;
    claimed = Math.min(m.tick, Math.max(claimed, m.tick - LAG_TICKS, s.lastAt));
    if (action.t === 'pull') s.lastAt = claimed;
    applyAction(m, conn.slot, action, this.humanEv, action.t === 'pull' ? claimed : m.tick);
  }

  // ---- match flow ----------------------------------------------------------

  private maybeStart() {
    if (this.phase !== 'lobby') return;
    const filled = this.slots.every((s) => s.bot || (s.cid && s.ws));
    const ready = this.slots.every((s) => s.bot || s.ready);
    const humans = this.slots.some((s) => this.isHuman(s));
    if (filled && ready && humans) this.startSeries();
  }

  /** Rematch: seats of players who left are freed, voters are marked ready. */
  private backToLobby() {
    this.phase = 'lobby';
    this.slots.forEach((s, i) => {
      if (this.isHuman(s) && !s.ws) this.slots[i] = emptySlot();
      else s.ready = this.rematch.has(i);
    });
    this.rematch.clear();
    this.seriesWinner = null;
    this.broadcastRoom();
    this.saveStatus();
    this.maybeStart();
  }

  private startSeries() {
    this.series = [0, 0];
    this.round = 0;
    this.seriesWinner = null;
    this.forfeit = false;
    this.rematch.clear();
    this.ratingDelta = {};
    this.startRound();
    this.saveStatus();
  }

  private startRound() {
    const cfg = this.cfg!;
    this.round++;
    this.phase = 'match';
    this.match = createMatch({ durationSec: cfg.durationSec, teamSize: cfg.teamSize });
    this.bots = this.slots.map((s, i) => (s.bot ? new Bot(i, s.bot, Date.now() + i) : null));
    for (const s of this.slots) s.lastAt = -1;
    this.pending = [];
    this.humanEv = [];
    this.acc = 0;
    this.lastTime = Date.now();
    this.holdUntil = 0;
    this.roundTicks = 0;
    this.broadcastRoom();
    this.ensureLoop();
  }

  private isHeld() {
    return this.pausedSlot() >= 0 || Date.now() < this.holdUntil;
  }

  private ensureLoop() {
    if (!this.loop) this.loop = setInterval(() => this.tick(), LOOP_MS);
  }

  private tick() {
    const now = Date.now();
    if (this.conns.size === 0 && this.phase !== 'match') {
      clearInterval(this.loop!);
      this.loop = null;
      return;
    }
    if (this.phase === 'between' && now >= this.nextRoundAt) this.startRound();
    if (this.phase !== 'match' || !this.match) return;
    const m = this.match;

    const paused = this.pausedSlot();
    if (paused >= 0) {
      this.lastTime = now;
      if (now - this.slots[paused].disconnectedAt! >= RECONNECT_GRACE_MS) this.onGraceExpired(paused);
      return;
    }
    if (now < this.holdUntil) {
      this.lastTime = now;
      return;
    }

    this.acc += ((now - this.lastTime) * 60) / 1000;
    this.lastTime = now;
    const n = Math.min(Math.floor(this.acc), 30);
    this.acc -= n;
    for (let k = 0; k < n && m.phase !== 'finished'; k++) {
      const ev = this.humanEv;
      this.humanEv = [];
      this.bots.forEach((b, i) => b && b.think(m).forEach((a) => applyAction(m, i, a, ev)));
      step(m, ev);
      this.bots.forEach((b) => b?.observe(m, ev));
      this.pending.push(...ev);
      if (m.phase === 'playing') this.roundTicks++;
    }
    if (n === 0 && this.humanEv.length) {
      this.pending.push(...this.humanEv);
      this.bots.forEach((b) => b?.observe(m, this.humanEv));
      this.humanEv = [];
    }
    const msg = JSON.stringify({ t: 'state', s: m, ev: this.pending, paused: false } satisfies ServerMsg);
    this.pending = [];
    for (const ws of this.conns.keys())
      try {
        ws.send(msg);
      } catch {}
    if (m.phase === 'finished') this.endRound();
  }

  private onGraceExpired(slot: number) {
    const m = this.match!;
    const team = this.team(slot);
    const mateOnline = this.slots.some((s, i) => i !== slot && this.team(i) === team && this.isHuman(s) && s.ws);
    if (mateOnline) {
      // 2v2: a bot takes over the seat so the teammate can keep playing.
      this.slots[slot] = { ...emptySlot(), bot: 'medium' };
      this.bots[slot] = new Bot(slot, 'medium', Date.now());
      this.holdUntil = Date.now() + RESUME_MS;
      this.broadcastRoom();
      return;
    }
    const ev: GameEvent[] = [];
    finish(m, team === 0 ? 1 : 0, 'forfeit', ev);
    this.forfeit = true;
    for (const ws of this.conns.keys()) this.send(ws, { t: 'state', s: m, ev, paused: false });
    this.endRound();
  }

  private endRound() {
    const m = this.match!;
    const cfg = this.cfg!;
    if (m.winner === 0 || m.winner === 1) this.series[m.winner]++;
    const need = Math.ceil(cfg.bestOf / 2);
    const decided = this.forfeit || this.series[0] >= need || this.series[1] >= need || this.round >= cfg.bestOf + 2;
    if (!decided) {
      this.phase = 'between';
      this.nextRoundAt = Date.now() + BETWEEN_MS;
      this.broadcastRoom();
      return;
    }
    this.seriesWinner = this.forfeit
      ? (m.winner as 0 | 1)
      : this.series[0] === this.series[1]
        ? 'draw'
        : this.series[0] > this.series[1]
          ? 0
          : 1;
    this.phase = 'done';
    for (const s of this.slots) s.ready = false;
    this.recordResults().then(() => this.broadcastRoom());
    this.broadcastRoom();
    this.saveStatus();
  }

  /** Stores the series for every signed-in player and updates Elo (human-only matches). */
  private async recordResults() {
    const m = this.match!;
    const w = this.seriesWinner;
    // Elo changes only when every seat is a signed-in human (no bots, no guests).
    const humansOnly = this.slots.every((s) => !s.bot && s.userId);
    const avg = (t: 0 | 1) => {
      const r = this.slots.filter((_, i) => this.team(i) === t).map((s) => s.rating);
      return r.reduce((a, b) => a + b, 0) / r.length;
    };
    const stmts: D1PreparedStatement[] = [];
    this.slots.forEach((s, i) => {
      if (!s.userId || s.bot) return;
      const t = this.team(i);
      const result = w === 'draw' ? 'draw' : w === t ? 'win' : 'loss';
      let delta = 0;
      if (humansOnly) {
        const expected = 1 / (1 + 10 ** ((avg(t === 0 ? 1 : 0) - avg(t)) / 400));
        const score = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
        delta = Math.round(32 * (score - expected));
      }
      this.ratingDelta[i] = delta;
      const opponent = this.slots
        .filter((_, j) => this.team(j) !== t)
        .map((o) => (o.bot ? `Бот · ${DIFFICULTY_LABEL[o.bot]}` : o.name))
        .join(' & ');
      const stats = { ...m.players[i].stats, teamSize: this.cfg!.teamSize, forfeit: this.forfeit ? 1 : 0 };
      stmts.push(
        this.env.DB.prepare(
          `INSERT INTO matches (user_id, mode, verified, opponent, result, rounds_won, rounds_lost, duration_sec, stats, rating_delta, created_at)
           VALUES (?, 'online', 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          s.userId,
          opponent,
          result,
          this.series[t],
          this.series[t === 0 ? 1 : 0],
          Math.round(this.roundTicks / 60),
          JSON.stringify(stats),
          delta,
          Date.now(),
        ),
      );
      if (delta) stmts.push(this.env.DB.prepare('UPDATE users SET rating = rating + ? WHERE id = ?').bind(delta, s.userId));
    });
    if (stmts.length)
      try {
        await this.env.DB.batch(stmts);
      } catch (e) {
        console.error('recordResults', e);
      }
  }
}
