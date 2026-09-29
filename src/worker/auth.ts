import { DEFAULT_COSMETICS, sanitizeCosmetics, type Cosmetics } from '../shared/cosmetics.ts';

export interface Env {
  DB: D1Database;
  ROOMS: DurableObjectNamespace;
}

export interface UserRow {
  id: string;
  username: string;
  pass_hash: string;
  salt: string;
  group_name: string;
  rating: number;
  pro_until: number;
  cosmetics: string;
  created_at: number;
}

export interface PublicUser {
  id: string;
  username: string;
  group: string;
  rating: number;
  pro: boolean;
  proUntil: number;
  cosmetics: Cosmetics;
}

const SESSION_TTL = 30 * 24 * 3600 * 1000;
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function randomHex(bytes: number) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100_000 },
    key,
    256,
  );
  return hex(bits);
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

export async function createSession(env: Env, userId: string) {
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, Date.now() + SESSION_TTL)
    .run();
  return token;
}

export async function deleteSession(env: Env, token: string) {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

export async function userFromToken(env: Env, token: string | null | undefined): Promise<UserRow | null> {
  if (!token || token.length !== 64) return null;
  return env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), Date.now())
    .first<UserRow>();
}

export function bearer(req: Request) {
  const h = req.headers.get('Authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

export function publicUser(u: UserRow): PublicUser {
  const pro = u.pro_until > Date.now();
  let cos: Partial<Cosmetics> = DEFAULT_COSMETICS;
  try {
    cos = JSON.parse(u.cosmetics);
  } catch {}
  return {
    id: u.id,
    username: u.username,
    group: u.group_name,
    rating: u.rating,
    pro,
    proUntil: u.pro_until,
    cosmetics: sanitizeCosmetics(cos, pro),
  };
}
