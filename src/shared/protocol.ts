// Messages exchanged between the browser and a Room durable object.
import type { Action, GameEvent, MatchState } from './engine.ts';
import type { Difficulty } from './bot.ts';
import type { Cosmetics } from './cosmetics.ts';

export interface SlotInfo {
  name: string;
  team: 0 | 1;
  bot: Difficulty | null;
  empty: boolean;
  connected: boolean;
  ready: boolean;
  userId: string | null;
  cosmetics: Cosmetics;
}

export type RoomPhase = 'lobby' | 'match' | 'between' | 'done';

export interface RoomInfo {
  code: string;
  teamSize: number;
  bestOf: number;
  durationSec: number;
  phase: RoomPhase;
  slots: SlotInfo[];
  you: number; // slot index, -1 for spectators
  host: number;
  spectators: number;
  series: [number, number];
  round: number;
  pausedFor: string | null; // name of the disconnected player
  pauseEndsAt: number | null; // ms timestamp
  seriesWinner: 0 | 1 | 'draw' | null;
  forfeit: boolean;
  rematch: number[]; // slots that voted for a rematch
  ratingDelta: Record<number, number>; // slot -> Elo change after the series
}

export type ClientMsg =
  | { t: 'hello'; cid: string; name: string; token?: string; watch?: boolean }
  | { t: 'act'; a: Action; at: number }
  | { t: 'ready'; on: boolean }
  | { t: 'team'; slot: number } // move to an empty slot (lobby)
  | { t: 'bot'; slot: number; difficulty: Difficulty | null } // host adds/removes a bot
  | { t: 'rematch' }
  | { t: 'ping'; c: number };

export type ServerMsg =
  | { t: 'room'; room: RoomInfo }
  | { t: 'state'; s: MatchState; ev: GameEvent[]; paused: boolean }
  | { t: 'pong'; c: number }
  | { t: 'error'; msg: string };

export const ROOM_CODE_RE = /^[A-Z0-9]{5}$/;
export const RECONNECT_GRACE_MS = 15000;
