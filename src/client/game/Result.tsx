import type { EndReason, MatchState, PlayerStats, Team } from '../../shared/engine.ts';

export function reasonText(reason: EndReason | null, winner: Team | 'draw' | null) {
  if (reason === 'forfeit') return 'Соперник отключился и не вернулся — техническая победа.';
  if (reason === 'line') return 'Отметка перетянута за линию.';
  if (winner === 'draw') return 'Время вышло, отметка у центра — ничья.';
  return 'Время вышло — побеждает сторона, на чьей половине отметка.';
}

/** One practical tip after a match, based on how the player actually played. */
export function coachTip(st: PlayerStats, won: boolean) {
  const accuracy = st.pulls ? st.onBeat / st.pulls : 0;
  if (st.pulls > 0 && accuracy < 0.4)
    return `В ритм попало только ${Math.round(accuracy * 100)}% тяг. Тяга в ритм втрое сильнее и дешевле — жми, когда кольцо сжимается.`;
  if (st.exhaustions >= 2) return `Ты выдыхался ${st.exhaustions} раза. Отдыхай заранее — например, пока соперник в упоре.`;
  if (st.burstsBlocked > 0) return 'Рывок в упор теряет силу. Жди, когда соперник отдыхает или выдохся — будет «Срыв!» ×1.5.';
  if (st.bursts === 0) return 'Серия тяг в ритм заряжает рывок. Не забывай его использовать!';
  if (!won) return 'Когда у соперника горит «РЫВОК», зажми упор — так его рывок почти не сдвинет канат.';
  return 'Отлично! Попробуй уровень сложнее или вызови друга онлайн.';
}

export function StatsGrid({ st }: { st: PlayerStats }) {
  const accuracy = st.pulls ? Math.round((st.onBeat / st.pulls) * 100) : 0;
  const items: [string, string | number][] = [
    ['Тяг', st.pulls],
    ['В ритм', `${accuracy}%`],
    ['Лучшая серия', st.maxCombo],
    ['Рывков', st.bursts],
    ['Срывов', st.breaks],
    ['Отбито', st.burstsBlocked],
    ['Выдохся', st.exhaustions],
  ];
  if (st.syncs) items.push(['Синхрон', st.syncs]);
  return (
    <div className="stats-grid">
      {items.map(([k, v]) => (
        <div key={k}>
          <b>{v}</b>
          <span>{k}</span>
        </div>
      ))}
    </div>
  );
}

export const durationOf = (s: MatchState) => Math.round((Math.min(s.tick, s.endTick) - s.startTick) / 60);
