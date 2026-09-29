// Solo trials with a personal best. Scores are reported by the client and
// stored per user; they are personal records, not part of the online rating.
import type { Difficulty } from './bot.ts';

export interface ChallengeDef {
  id: string;
  name: string;
  goal: string;
  unit: string;
  lowerIsBetter: boolean;
  maxScore: number;
  durationSec: number;
  opponent: Difficulty | null; // null = training dummy that does nothing
  practice: boolean; // rope never crosses the line
  startPos?: number;
}

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 'metronome',
    name: 'Метроном',
    goal: 'Самая длинная серия тяг точно в ритм за 30 секунд.',
    unit: 'в ритм подряд',
    lowerIsBetter: false,
    maxScore: 60,
    durationSec: 30,
    opponent: null,
    practice: true,
  },
  {
    id: 'sprint',
    name: 'Спринт',
    goal: 'Перетяни манекен за линию как можно быстрее. Спам выдохнется.',
    unit: 'сек',
    lowerIsBetter: true,
    maxScore: 60,
    durationSec: 30,
    opponent: null,
    practice: false,
  },
  {
    id: 'survive',
    name: 'Выстоять против Чемпиона',
    goal: 'Продержись как можно дольше против сильнейшего бота. 60 с — это победа по времени.',
    unit: 'сек',
    lowerIsBetter: false,
    maxScore: 60,
    durationSec: 60,
    opponent: 'champion',
    practice: false,
  },
  {
    id: 'comeback',
    name: 'Камбэк',
    goal: 'Канат почти у твоей линии. Отыграйся у «Любителя» — чем быстрее, тем лучше.',
    unit: 'сек',
    lowerIsBetter: true,
    maxScore: 60,
    durationSec: 60,
    opponent: 'medium',
    practice: false,
    startPos: 0.7, // the player is on the left: +0.7 is close to losing
  },
];
