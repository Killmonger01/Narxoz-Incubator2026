import { useMemo, useRef, useState } from 'react';
import { isBracing, isResting, type GameEvent, type MatchState } from '../../shared/engine.ts';
import { arenaById, ropeById } from '../../shared/cosmetics.ts';
import { LocalDriver } from './drivers.ts';
import { GameView, SOLO_HINT, SOLO_KEYS } from './GameView.tsx';
import { teamColors, useCosmetics } from './LocalGame.tsx';
import { markTutorialDone } from '../store.ts';
import { navigate } from '../router.ts';

interface Step {
  title: string;
  text: string;
  goal: number;
  /** Returns progress increment for this frame's events. */
  track: (ev: GameEvent[], s: MatchState, ctx: { holdTicks: number; restTicks: number }) => number;
}

const STEPS: Step[] = [
  {
    title: 'Тяни',
    text: 'Нажимай Пробел (или кнопку «Тянуть»). Каждое нажатие — рывок руками. Удерживать бесполезно: считается только новое нажатие.',
    goal: 5,
    track: (ev) => ev.filter((e) => e.type === 'pull' && e.p === 0).length,
  },
  {
    title: 'Попадай в ритм',
    text: 'Над канатом пульсирует кольцо. Жми, когда жёлтый круг сжимается до центра и кольцо загорается зелёным. Тяга в ритм втрое сильнее и тратит меньше сил. Промежутки между ударами каждый раз разные — следи за кольцом, а не считай про себя.',
    goal: 4,
    track: (ev) => ev.filter((e) => e.type === 'pull' && e.p === 0 && e.onBeat).length,
  },
  {
    title: 'Рывок',
    text: 'Каждая тяга в ритм заряжает шкалу рывка. Когда она заполнится — нажми D (или «Рывок»). Лучше всего бить, когда соперник отдыхает или выдохся: будет «Срыв!».',
    goal: 1,
    track: (ev) => ev.filter((e) => e.type === 'burst' && e.p === 0).length,
  },
  {
    title: 'Упор',
    text: 'Зажми S (или «Упор») и держи секунду. В упоре ты не тянешь, но соперник тянет в 2,5 раза слабее, а его рывок почти гаснет. Упор тратит силы.',
    goal: 60,
    track: (_ev, _s, c) => (c.holdTicks > 0 ? 1 : 0),
  },
  {
    title: 'Отдых',
    text: 'Выносливость (зелёная полоса) тратится на каждую тягу. Если она кончится — выдохнешься на 1,5 с. Отпусти всё на 2 секунды: силы восстановятся, но канат в это время твой соперник тянет свободно.',
    goal: 120,
    track: (_ev, _s, c) => (c.restTicks > 0 ? 1 : 0),
  },
];

export function Tutorial() {
  const cos = useCosmetics();
  const driver = useMemo(() => new LocalDriver({ durationSec: 600, teamSize: 1, practice: true }), []);
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const lastTick = useRef(0);
  const done = step >= STEPS.length;

  const onEvents = (ev: GameEvent[], s: MatchState) => {
    if (done) return;
    const me = s.players[0];
    const ticks = s.tick - lastTick.current;
    lastTick.current = s.tick;
    const cur = STEPS[step];
    let inc = cur.track(ev, s, {
      holdTicks: isBracing(s, me) ? 1 : 0,
      restTicks: isResting(s, me) ? 1 : 0,
    });
    // Time-based steps count ticks, event-based steps count events.
    if (cur.goal >= 60) inc = inc ? ticks : -progress;
    const next = Math.max(0, progress + inc);
    if (next >= cur.goal) {
      setStep(step + 1);
      setProgress(0);
      if (step + 1 >= STEPS.length) markTutorialDone();
    } else setProgress(next);
  };

  const cur = STEPS[Math.min(step, STEPS.length - 1)];
  const pct = done ? 100 : Math.min(100, (progress / cur.goal) * 100);

  return (
    <div className="play-screen">
      <div className="play-top">
        <button className="btn ghost small" onClick={() => navigate('/')}>
          ← Выйти
        </button>
        <span className="play-title">Обучение · тренировка с манекеном</span>
        <span />
      </div>
      <GameView
        driver={driver}
        controls={[{ player: 0, keys: SOLO_KEYS, hint: SOLO_HINT }]}
        names={['Вы', 'Манекен']}
        colors={teamColors(cos.color)}
        arena={arenaById(cos.arena)}
        rope={ropeById(cos.rope)}
        onEvents={onEvents}
        overlay={
          <div className={`coach ${done ? 'done' : ''}`}>
            {!done ? (
              <>
                <p className="eyebrow">
                  Шаг {step + 1} из {STEPS.length}
                </p>
                <h3>{cur.title}</h3>
                <p>{cur.text}</p>
                <div className="bar progress">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <button className="btn ghost small" onClick={() => setStep(step + 1)}>
                  Пропустить шаг
                </button>
              </>
            ) : (
              <>
                <h3>Готово! 🎉</h3>
                <p>
                  Главное: тяни в ритм, копи рывок, упирайся, когда у соперника горит «РЫВОК», и отдыхай до того, как
                  выдохнешься. Если время выйдет — побеждает тот, на чьей половине отметка.
                </p>
                <div className="row">
                  <button className="btn primary" onClick={() => navigate('/game', { kind: 'bot', difficulty: 'easy' })}>
                    Сыграть с «Новичком»
                  </button>
                  <button className="btn" onClick={() => navigate('/')}>
                    В меню
                  </button>
                </div>
              </>
            )}
          </div>
        }
      />
    </div>
  );
}
