// Settings and match results kept in the browser (works without an account).
import { useSyncExternalStore } from 'react';
import type { Difficulty } from '../shared/bot.ts';
import { DEFAULT_COSMETICS, type Cosmetics } from '../shared/cosmetics.ts';

export interface Settings {
  sound: boolean;
  volume: number;
  durationSec: number;
  bestOf: number;
  difficulty: Difficulty;
  reducedMotion: boolean;
  name: string;
  guestCosmetics: Cosmetics;
}

export interface LocalMatch {
  at: number;
  mode: 'bot' | 'hotseat' | 'online';
  opponent: string;
  result: 'win' | 'loss' | 'draw';
  roundsWon: number;
  roundsLost: number;
  durationSec: number;
  stats?: Record<string, number>;
}

const DEFAULTS: Settings = {
  sound: true,
  volume: 0.7,
  durationSec: 60,
  bestOf: 3,
  difficulty: 'easy',
  reducedMotion: false,
  name: '',
  guestCosmetics: DEFAULT_COSMETICS,
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

let settings: Settings = load('kanat.settings', DEFAULTS);
const listeners = new Set<() => void>();
const sub = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const getSettings = () => settings;
export function setSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  save('kanat.settings', settings);
  listeners.forEach((l) => l());
}
export const useSettings = () => useSyncExternalStore(sub, getSettings);

export function localHistory(): LocalMatch[] {
  try {
    return JSON.parse(localStorage.getItem('kanat.history') ?? '[]');
  } catch {
    return [];
  }
}
export function addLocalMatch(m: LocalMatch) {
  save('kanat.history', [m, ...localHistory()].slice(0, 50));
}

export function localBests(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem('kanat.bests') ?? '{}');
  } catch {
    return {};
  }
}
export function saveLocalBest(id: string, score: number, lowerIsBetter: boolean) {
  const b = localBests();
  const old = b[id];
  const better = old === undefined || (lowerIsBetter ? score < old : score > old);
  if (better) save('kanat.bests', { ...b, [id]: score });
  return better;
}

export function tutorialDone() {
  try {
    return localStorage.getItem('kanat.tutorial') === '1';
  } catch {
    return false;
  }
}
export function markTutorialDone() {
  try {
    localStorage.setItem('kanat.tutorial', '1');
  } catch {}
}

/** Stable id of this browser tab session, used to reclaim a seat after a reconnect. */
export function clientId() {
  try {
    let id = sessionStorage.getItem('kanat.cid');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('kanat.cid', id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
