// Purely visual items. Pro unlocks looks only: they never change game logic.

export interface Arena { id: string; name: string; pro: boolean; sky: [string, string]; ground: string; accent: string; night?: boolean; snow?: boolean }
export interface RopeSkin { id: string; name: string; pro: boolean; colors: string[] }
export interface Cosmetics { arena: string; rope: string; color: string }

export const ARENAS: Arena[] = [
  { id: 'yard', name: 'Школьный двор', pro: false, sky: ['#8fd3ff', '#dff3ff'], ground: '#6cbf5a', accent: '#c98b4b' },
  { id: 'stadium', name: 'Ночной стадион', pro: true, sky: ['#0b1433', '#23305e'], ground: '#2f7a3b', accent: '#f2f2f2', night: true },
  { id: 'beach', name: 'Пляж Капчагая', pro: true, sky: ['#ffb36b', '#ffe4b8'], ground: '#f1d49a', accent: '#2a9dd6' },
  { id: 'winter', name: 'Медеу зимой', pro: true, sky: ['#b9c9e8', '#eef3fb'], ground: '#f4f8ff', accent: '#6a8cc7', snow: true },
];

export const ROPES: RopeSkin[] = [
  { id: 'classic', name: 'Джутовый', pro: false, colors: ['#c8a165', '#a47b43'] },
  { id: 'neon', name: 'Неон', pro: true, colors: ['#39ff88', '#00c2ff'] },
  { id: 'flag', name: 'Небесный', pro: true, colors: ['#00afca', '#fec50c'] },
  { id: 'fire', name: 'Огонь', pro: true, colors: ['#ff4d2e', '#ffb400'] },
];

export const COLORS: { id: string; name: string; pro: boolean; hex: string }[] = [
  { id: 'red', name: 'Красные', pro: false, hex: '#e5484d' },
  { id: 'blue', name: 'Синие', pro: false, hex: '#3e63dd' },
  { id: 'green', name: 'Зелёные', pro: true, hex: '#30a46c' },
  { id: 'purple', name: 'Фиолетовые', pro: true, hex: '#8e4ec6' },
  { id: 'gold', name: 'Золотые', pro: true, hex: '#d4a017' },
];

export const DEFAULT_COSMETICS: Cosmetics = { arena: 'yard', rope: 'classic', color: 'red' };

/** Drops any Pro item the user does not own. */
export function sanitizeCosmetics(c: Partial<Cosmetics> | null | undefined, pro: boolean): Cosmetics {
  const pick = <T extends { id: string; pro: boolean }>(list: T[], id: string | undefined, def: string) => {
    const item = list.find((x) => x.id === id);
    return item && (pro || !item.pro) ? item.id : def;
  };
  return {
    arena: pick(ARENAS, c?.arena, DEFAULT_COSMETICS.arena),
    rope: pick(ROPES, c?.rope, DEFAULT_COSMETICS.rope),
    color: pick(COLORS, c?.color, DEFAULT_COSMETICS.color),
  };
}

export const arenaById = (id: string) => ARENAS.find((a) => a.id === id) ?? ARENAS[0];
export const ropeById = (id: string) => ROPES.find((a) => a.id === id) ?? ROPES[0];
export const colorById = (id: string) => COLORS.find((a) => a.id === id) ?? COLORS[0];

export const PRO_PRICE_KZT = 990;
export const TEST_CARD = '4242 4242 4242 4242';
export const TEST_CARD_DECLINED = '4000 0000 0000 0002';

/** Luhn checksum, as real card forms do. */
export function luhnValid(digits: string) {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

export function cardBrand(digits: string): 'visa' | 'mastercard' | 'unknown' {
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
  return 'unknown';
}
