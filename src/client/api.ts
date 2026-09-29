import { useSyncExternalStore } from 'react';
import type { Cosmetics } from '../shared/cosmetics.ts';

export interface User {
  id: string;
  username: string;
  group: string;
  rating: number;
  pro: boolean;
  proUntil: number;
  cosmetics: Cosmetics;
}

const TOKEN_KEY = 'kanat.token';
const USER_KEY = 'kanat.user';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};

let token = read(TOKEN_KEY);
let user: User | null = (() => {
  try {
    return JSON.parse(read(USER_KEY) ?? 'null');
  } catch {
    return null;
  }
})();
const listeners = new Set<() => void>();

export function setAuth(t: string | null, u: User | null) {
  token = t;
  user = u;
  write(TOKEN_KEY, t);
  write(USER_KEY, u ? JSON.stringify(u) : null);
  listeners.forEach((l) => l());
}

export const getToken = () => token;
export const getUser = () => user;

export function useUser() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => user,
  );
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Нет соединения с сервером');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && !path.startsWith('/auth')) setAuth(null, null);
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Ошибка ${res.status}`);
  return data as T;
}

/** Refreshes the cached profile (e.g. after purchases on another device). */
export async function refreshMe() {
  if (!token) return null;
  try {
    const data = await api('/me');
    setAuth(token, data.user);
    return data;
  } catch {
    return null;
  }
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {}
  setAuth(null, null);
}
