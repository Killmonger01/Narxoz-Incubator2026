import {
  bearer,
  createSession,
  deleteSession,
  hashPassword,
  publicUser,
  randomHex,
  safeEqual,
  userFromToken,
  type Env,
  type UserRow,
} from './auth.ts';
import { PRO_PRICE_KZT, sanitizeCosmetics } from '../shared/cosmetics.ts';
import { ROOM_CODE_RE } from '../shared/protocol.ts';
import { CHALLENGES } from '../shared/challenges.ts';

export { Room } from './room.ts';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
const fail = (status: number, error: string) => json({ error }, status);

const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;
const MODES = new Set(['bot', 'hotseat']);
const RESULTS = new Set(['win', 'loss', 'draw']);
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function body<T>(req: Request): Promise<Partial<T>> {
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? (b as Partial<T>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // WebSocket upgrade for online rooms: /ws/room/ABCDE
    const ws = path.match(/^\/ws\/room\/([A-Z0-9]{5})$/);
    if (ws) {
      if (req.headers.get('Upgrade') !== 'websocket') return fail(426, 'Expected WebSocket');
      return env.ROOMS.get(env.ROOMS.idFromName(ws[1])).fetch(req);
    }

    if (!path.startsWith('/api/')) return new Response('Not found', { status: 404 });
    try {
      return await api(req, env, url);
    } catch (e) {
      console.error(e);
      return fail(500, 'Внутренняя ошибка сервера');
    }
  },
} satisfies ExportedHandler<Env>;

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.slice(4); // strip "/api"
  const method = req.method;
  const token = bearer(req);
  const me = () => userFromToken(env, token);

  if (path === '/auth/register' && method === 'POST') {
    const b = await body<{ username: string; password: string; group: string }>(req);
    const username = str(b.username, 40);
    const password = typeof b.password === 'string' ? b.password : '';
    if (!USERNAME_RE.test(username)) return fail(400, 'Ник: 3–20 символов, буквы, цифры, _ . -');
    if (password.length < 6 || password.length > 100) return fail(400, 'Пароль: от 6 символов');
    const exists = await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
    if (exists) return fail(409, 'Этот ник уже занят');
    const id = crypto.randomUUID();
    const salt = randomHex(16);
    await env.DB.prepare(
      'INSERT INTO users (id, username, pass_hash, salt, group_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(id, username, await hashPassword(password, salt), salt, str(b.group, 30), Date.now())
      .run();
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
    return json({ token: await createSession(env, id), user: publicUser(user!) });
  }

  if (path === '/auth/login' && method === 'POST') {
    const b = await body<{ username: string; password: string }>(req);
    const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?')
      .bind(str(b.username, 40))
      .first<UserRow>();
    const password = typeof b.password === 'string' ? b.password : '';
    if (!user || !safeEqual(await hashPassword(password, user.salt), user.pass_hash))
      return fail(401, 'Неверный ник или пароль');
    return json({ token: await createSession(env, user.id), user: publicUser(user) });
  }

  if (path === '/auth/logout' && method === 'POST') {
    if (token) await deleteSession(env, token);
    return json({ ok: true });
  }

  if (path === '/leaderboard' && method === 'GET') {
    const players = await env.DB.prepare(
      `SELECT u.username, u.group_name, u.rating, u.pro_until,
              SUM(m.result = 'win') AS wins, SUM(m.result = 'loss') AS losses
       FROM users u JOIN matches m ON m.user_id = u.id AND m.mode = 'online'
       GROUP BY u.id ORDER BY u.rating DESC, wins DESC LIMIT 50`,
    ).all();
    const groups = await env.DB.prepare(
      `SELECT u.group_name AS name, COUNT(DISTINCT u.id) AS members,
              SUM(m.result = 'win') AS wins, COUNT(m.id) AS games, ROUND(AVG(u.rating)) AS rating
       FROM users u JOIN matches m ON m.user_id = u.id AND m.mode = 'online'
       WHERE u.group_name != '' GROUP BY u.group_name ORDER BY wins DESC LIMIT 30`,
    ).all();
    return json({
      players: players.results.map((r: any) => ({
        username: r.username,
        group: r.group_name,
        rating: r.rating,
        pro: r.pro_until > Date.now(),
        wins: r.wins ?? 0,
        losses: r.losses ?? 0,
      })),
      groups: groups.results,
    });
  }

  if (path === '/rooms' && method === 'POST') {
    const b = await body<{ teamSize: number; bestOf: number; durationSec: number }>(req);
    const teamSize = b.teamSize === 2 ? 2 : 1;
    const bestOf = [1, 3, 5].includes(b.bestOf as number) ? (b.bestOf as number) : 3;
    const durationSec = [45, 60, 90].includes(b.durationSec as number) ? (b.durationSec as number) : 60;
    // A code that is already in use answers 409; try another one.
    for (let attempt = 0; attempt < 5; attempt++) {
      let code = '';
      for (const b of crypto.getRandomValues(new Uint8Array(5))) code += ROOM_ALPHABET[b % ROOM_ALPHABET.length];
      const res = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch('https://room/init', {
        method: 'POST',
        body: JSON.stringify({ code, teamSize, bestOf, durationSec }),
      });
      if (res.ok) return json({ code });
    }
    return fail(500, 'Не удалось создать комнату');
  }

  if (path === '/rooms/live' && method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT code, status, team_size, players, updated_at FROM rooms
       WHERE status = 'match' AND updated_at > ? ORDER BY updated_at DESC LIMIT 20`,
    )
      .bind(Date.now() - 3 * 60 * 1000)
      .all();
    return json({ rooms: rows.results });
  }

  const room = path.match(/^\/rooms\/([A-Z0-9]{5})$/);
  if (room && method === 'GET' && ROOM_CODE_RE.test(room[1])) {
    const res = await env.ROOMS.get(env.ROOMS.idFromName(room[1])).fetch('https://room/info');
    return res.ok ? json(await res.json()) : fail(404, 'Комната не найдена');
  }

  // Everything below requires a signed-in user.
  const user = await me();
  if (!user) return fail(401, 'Нужно войти в аккаунт');

  if (path === '/me' && method === 'GET') {
    const stats = await env.DB.prepare(
      `SELECT mode, SUM(result = 'win') AS wins, SUM(result = 'loss') AS losses, SUM(result = 'draw') AS draws
       FROM matches WHERE user_id = ? GROUP BY mode`,
    )
      .bind(user.id)
      .all();
    const challenges = await env.DB.prepare('SELECT challenge_id, best, attempts FROM challenges WHERE user_id = ?')
      .bind(user.id)
      .all();
    return json({ user: publicUser(user), stats: stats.results, challenges: challenges.results });
  }

  if (path === '/me' && method === 'PATCH') {
    const b = await body<{ group: string; cosmetics: unknown }>(req);
    const pub = publicUser(user);
    const group = b.group !== undefined ? str(b.group, 30) : user.group_name;
    const cosmetics = b.cosmetics !== undefined ? sanitizeCosmetics(b.cosmetics as any, pub.pro) : pub.cosmetics;
    await env.DB.prepare('UPDATE users SET group_name = ?, cosmetics = ? WHERE id = ?')
      .bind(group, JSON.stringify(cosmetics), user.id)
      .run();
    const fresh = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<UserRow>();
    return json({ user: publicUser(fresh!) });
  }

  if (path === '/matches' && method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT id, mode, verified, opponent, result, rounds_won, rounds_lost, duration_sec, stats, rating_delta, created_at
       FROM matches WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(user.id)
      .all();
    return json({ matches: rows.results.map((r: any) => ({ ...r, stats: JSON.parse(r.stats || '{}') })) });
  }

  // Local matches (vs bot / same device) are reported by the client and
  // stored as unverified: they count in personal history but not in rating.
  if (path === '/matches' && method === 'POST') {
    const b = await body<any>(req);
    if (!MODES.has(b.mode) || !RESULTS.has(b.result)) return fail(400, 'Неверные данные матча');
    const stats: Record<string, number> = {};
    if (b.stats && typeof b.stats === 'object')
      for (const [k, v] of Object.entries(b.stats).slice(0, 12)) stats[str(k, 20)] = num(v, 0, 1e5);
    await env.DB.prepare(
      `INSERT INTO matches (user_id, mode, verified, opponent, result, rounds_won, rounds_lost, duration_sec, stats, created_at)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        user.id,
        b.mode,
        str(b.opponent, 40) || 'Соперник',
        b.result,
        num(b.roundsWon, 0, 5),
        num(b.roundsLost, 0, 5),
        num(b.durationSec, 0, 3600),
        JSON.stringify(stats),
        Date.now(),
      )
      .run();
    return json({ ok: true });
  }

  if (path === '/challenges' && method === 'POST') {
    const b = await body<{ id: string; score: number }>(req);
    const def = CHALLENGES.find((c) => c.id === b.id);
    if (!def || typeof b.score !== 'number' || !Number.isFinite(b.score)) return fail(400, 'Неизвестное испытание');
    const score = num(b.score, 0, def.maxScore);
    // Keep the best attempt: higher is better or lower is better depending on the challenge.
    const better = def.lowerIsBetter ? 'MIN(best, excluded.best)' : 'MAX(best, excluded.best)';
    await env.DB.prepare(
      `INSERT INTO challenges (user_id, challenge_id, best, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, challenge_id) DO UPDATE SET best = ${better}, attempts = attempts + 1, updated_at = excluded.updated_at`,
    )
      .bind(user.id, def.id, score, Date.now())
      .run();
    return json({ ok: true });
  }

  // Test-mode checkout: no real money moves. Only the Stripe-style test card is accepted.
  if (path === '/shop/test-purchase' && method === 'POST') {
    const b = await body<{ card: string }>(req);
    const card = str(b.card, 30).replace(/\s+/g, '');
    if (card !== '4242424242424242') return fail(402, 'Тестовый режим: используйте карту 4242 4242 4242 4242');
    const now = Date.now();
    const base = Math.max(now, user.pro_until);
    const until = base + 30 * 24 * 3600 * 1000;
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pro_until = ? WHERE id = ?').bind(until, user.id),
      env.DB.prepare(
        `INSERT INTO payments (id, user_id, item, amount, mode, card_last4, created_at) VALUES (?, ?, 'pro-30d', ?, 'test', ?, ?)`,
      ).bind(crypto.randomUUID(), user.id, PRO_PRICE_KZT, card.slice(-4), now),
    ]);
    const fresh = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<UserRow>();
    return json({ user: publicUser(fresh!) });
  }

  if (path === '/shop/cancel' && method === 'POST') {
    await env.DB.prepare('UPDATE users SET pro_until = 0 WHERE id = ?').bind(user.id).run();
    const fresh = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<UserRow>();
    return json({ user: publicUser(fresh!) });
  }

  return fail(404, 'Not found');
}
