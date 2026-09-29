import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent, MatchConfig, MatchState, Team } from '../../shared/engine.ts';
import { DIFFICULTY_LABEL, type Difficulty } from '../../shared/bot.ts';
import { CHALLENGES, type ChallengeDef } from '../../shared/challenges.ts';
import { arenaById, colorById, COLORS, ropeById, type Cosmetics } from '../../shared/cosmetics.ts';
import { LocalDriver } from './drivers.ts';
import { GameView, LEFT_HINT, LEFT_KEYS, RIGHT_HINT, RIGHT_KEYS, SOLO_HINT, SOLO_KEYS, type Control } from './GameView.tsx';
import { coachTip, durationOf, reasonText, StatsGrid } from './Result.tsx';
import { api, useUser } from '../api.ts';
import { addLocalMatch, localBests, saveLocalBest, useSettings } from '../store.ts';
import { navigate } from '../router.ts';

export type LocalMode =
  | { kind: 'bot'; difficulty: Difficulty }
  | { kind: 'hotseat' }
  | { kind: 'challenge'; id: string };

export function useCosmetics(): Cosmetics {
  const user = useUser();
  const settings = useSettings();
  return user?.cosmetics ?? settings.guestCosmetics;
}

/** Team colors: the player's color, and a contrasting one for the other side. */
export function teamColors(own: string, other?: string): [string, string] {
  const a = colorById(own).hex;
  let b = other ? colorById(other).hex : a === COLORS[1].hex ? COLORS[0].hex : COLORS[1].hex;
  if (b === a) b = a === COLORS[1].hex ? COLORS[0].hex : COLORS[1].hex;
  return [a, b];
}

type Outcome = { winner: Team | 'draw'; s: MatchState };

export function LocalGame({ mode }: { mode: LocalMode }) {
  const settings = useSettings();
  const user = useUser();
  const cos = useCosmetics();
  const challenge: ChallengeDef | undefined = mode.kind === 'challenge' ? CHALLENGES.find((c) => c.id === mode.id) : undefined;
  const bestOf = mode.kind === 'challenge' ? 1 : settings.bestOf;
  const [series, setSeries] = useState<[number, number]>([0, 0]);
  const [round, setRound] = useState(1);
  const [between, setBetween] = useState<Outcome | null>(null);
  const [final, setFinal] = useState<{ o: Outcome; series: [number, number]; score?: number; record?: boolean } | null>(null);
  const [pausedUi, setPausedUi] = useState(false);
  const [gen, setGen] = useState(0); // bump to restart the whole series

  const driver = useMemo(() => {
    const cfg: MatchConfig = {
      durationSec: challenge ? challenge.durationSec : settings.durationSec,
      teamSize: 1,
      practice: challenge?.practice,
      startPos: challenge?.startPos,
    };
    const bot: Difficulty | null = mode.kind === 'bot' ? mode.difficulty : challenge?.opponent ?? null;
    return new LocalDriver(cfg, [null, bot]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, gen]);

  const controls: Control[] =
    mode.kind === 'hotseat'
      ? [
          { player: 0, keys: LEFT_KEYS, hint: LEFT_HINT },
          { player: 1, keys: RIGHT_KEYS, hint: RIGHT_HINT },
        ]
      : [{ player: 0, keys: SOLO_KEYS, hint: SOLO_HINT }];

  const opponentName =
    mode.kind === 'bot'
      ? `Бот · ${DIFFICULTY_LABEL[mode.difficulty]}`
      : mode.kind === 'hotseat'
        ? 'Игрок 2'
        : challenge?.opponent
          ? `Бот · ${DIFFICULTY_LABEL[challenge.opponent]}`
          : 'Манекен';
  const myName = mode.kind === 'hotseat' ? 'Игрок 1' : user?.username || settings.name || 'Вы';

  // Pause: Esc / P, and automatically when the tab is hidden.
  const setPaused = useCallback(
    (v: boolean) => {
      if (driver.state().phase === 'finished') return;
      driver.setPaused(v);
      setPausedUi(v);
    },
    [driver],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') setPaused(!driver.paused());
    };
    const vis = () => document.hidden && setPaused(true);
    window.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [driver, setPaused]);

  const nextTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(nextTimer.current), []);

  const onEvents = (ev: GameEvent[], s: MatchState) => {
    const end = ev.find((e) => e.type === 'end');
    if (!end || end.type !== 'end') return;
    const o: Outcome = { winner: end.winner, s: structuredClone(s) };
    const next: [number, number] = [...series];
    if (end.winner !== 'draw') next[end.winner]++;
    setSeries(next);
    const need = Math.ceil(bestOf / 2);
    const done = next[0] >= need || next[1] >= need || round >= bestOf + 2;
    if (!done) {
      setBetween(o);
      nextTimer.current = setTimeout(() => {
        setBetween(null);
        setRound((r) => r + 1);
      }, 3500);
      return;
    }
    const score = challenge ? challengeScore(challenge, s, end.winner) : undefined;
    const record = challenge && score !== undefined ? saveLocalBest(challenge.id, score, challenge.lowerIsBetter) : false;
    setFinal({ o, series: next, score, record });
    persist(o, next, score);
  };

  function persist(o: Outcome, sr: [number, number], score?: number) {
    if (challenge) {
      if (score !== undefined && user) api('/challenges', { body: { id: challenge.id, score } }).catch(() => {});
      return;
    }
    const result = sr[0] === sr[1] ? 'draw' : sr[0] > sr[1] ? 'win' : 'loss';
    const m = {
      mode: mode.kind === 'bot' ? ('bot' as const) : ('hotseat' as const),
      opponent: opponentName,
      result: result as 'win' | 'loss' | 'draw',
      roundsWon: sr[0],
      roundsLost: sr[1],
      durationSec: durationOf(o.s),
      stats: { ...o.s.players[0].stats },
    };
    addLocalMatch({ ...m, at: Date.now() });
    if (user) api('/matches', { body: m }).catch(() => {});
  }

  const restart = () => {
    clearTimeout(nextTimer.current);
    setSeries([0, 0]);
    setRound(1);
    setBetween(null);
    setFinal(null);
    setPausedUi(false);
    setGen((g) => g + 1);
  };

  const colors = mode.kind === 'hotseat' ? teamColors('red', 'blue') : teamColors(cos.color);
  const title = challenge ? challenge.name : mode.kind === 'bot' ? `Против бота · ${DIFFICULTY_LABEL[mode.difficulty]}` : 'Вдвоём на одном устройстве';

  let overlay = null;
  if (final) {
    const { o, series: sr } = final;
    const leftWon = sr[0] > sr[1] || (bestOf === 1 && o.winner === 0);
    const draw = bestOf === 1 ? o.winner === 'draw' : sr[0] === sr[1];
    const heading =
      mode.kind === 'hotseat'
        ? draw
          ? 'Ничья!'
          : `Победил ${leftWon ? 'Игрок 1' : 'Игрок 2'}!`
        : challenge
          ? final.score !== undefined
            ? `${formatScore(final.score)} ${challenge.unit}`
            : 'Не получилось'
          : draw
            ? 'Ничья'
            : leftWon
              ? 'Победа!'
              : 'Поражение';
    overlay = (
      <div className="overlay">
        <div className="card result">
          <p className="eyebrow">{title}</p>
          <h2 className={leftWon && !draw ? 'win' : ''}>{heading}</h2>
          {final.record && <p className="badge">Новый личный рекорд!</p>}
          {challenge && final.score === undefined && <p>{challenge.goal}</p>}
          {bestOf > 1 && (
            <p className="big-score">
              <span style={{ color: colors[0] }}>{sr[0]}</span> : <span style={{ color: colors[1] }}>{sr[1]}</span>
            </p>
          )}
          <p className="muted">{reasonText(o.s.reason, o.winner)}</p>
          <StatsGrid st={o.s.players[0].stats} />
          {mode.kind !== 'hotseat' && <p className="tip">💡 {coachTip(o.s.players[0].stats, leftWon && !draw)}</p>}
          {!user && mode.kind !== 'hotseat' && (
            <p className="muted small">
              Результат сохранён в этом браузере. <a onClick={() => navigate('/login')}>Войди</a>, чтобы видеть историю на любом устройстве.
            </p>
          )}
          <div className="row">
            <button className="btn primary" onClick={restart} autoFocus>
              {challenge ? 'Ещё попытка' : 'Реванш'}
            </button>
            <button className="btn" onClick={() => navigate(challenge ? '/challenges' : '/')}>
              {challenge ? 'К испытаниям' : 'В меню'}
            </button>
          </div>
        </div>
      </div>
    );
  } else if (between) {
    const w = between.winner;
    overlay = (
      <div className="overlay soft">
        <div className="card">
          <h2>{w === 'draw' ? 'Ничья в раунде' : `Раунд за ${w === 0 ? myName : opponentName}`}</h2>
          <p className="big-score">
            <span style={{ color: colors[0] }}>{series[0]}</span> : <span style={{ color: colors[1] }}>{series[1]}</span>
          </p>
          <p className="muted">Следующий раунд через пару секунд…</p>
        </div>
      </div>
    );
  } else if (pausedUi) {
    overlay = (
      <div className="overlay">
        <div className="card">
          <h2>Пауза</h2>
          <div className="row">
            <button className="btn primary" onClick={() => setPaused(false)} autoFocus>
              Продолжить
            </button>
            <button className="btn" onClick={restart}>
              Заново
            </button>
            <button className="btn" onClick={() => navigate('/')}>
              В меню
            </button>
          </div>
        </div>
      </div>
    );
  }

  const bests = localBests();
  return (
    <div className="play-screen">
      <div className="play-top">
        <button className="btn ghost small" onClick={() => navigate(challenge ? '/challenges' : '/')}>
          ← Выйти
        </button>
        <span className="play-title">
          {title}
          {bestOf > 1 && ` · раунд ${round}`}
          {challenge && bests[challenge.id] !== undefined && ` · рекорд ${formatScore(bests[challenge.id])} ${challenge.unit}`}
        </span>
        <button className="btn ghost small" onClick={() => setPaused(!pausedUi)} disabled={!!final}>
          {pausedUi ? '▶' : '❚❚'} <span className="hide-sm">Esc</span>
        </button>
      </div>
      <GameView
        key={`${gen}-${round}`}
        driver={driver}
        controls={controls}
        names={[myName, opponentName]}
        colors={colors}
        arena={arenaById(cos.arena)}
        rope={ropeById(cos.rope)}
        series={series}
        bestOf={bestOf}
        overlay={overlay}
        onEvents={onEvents}
      />
      {challenge && <p className="challenge-goal">{challenge.goal}</p>}
    </div>
  );
}

function challengeScore(c: ChallengeDef, s: MatchState, winner: Team | 'draw'): number | undefined {
  const secs = Math.round(((Math.min(s.tick, s.endTick) - s.startTick) / 60) * 10) / 10;
  switch (c.id) {
    case 'metronome':
      return s.players[0].stats.maxCombo;
    case 'sprint':
    case 'comeback':
      return winner === 0 ? secs : undefined;
    case 'survive':
      return winner === 1 ? secs : c.durationSec;
  }
  return undefined;
}

export const formatScore = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
