import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BURST_COST,
  isBracing,
  isExhausted,
  isResting,
  secondsLeft,
  type GameEvent,
  type MatchState,
  type PlayerState,
} from '../../shared/engine.ts';
import type { Arena, RopeSkin } from '../../shared/cosmetics.ts';
import { draw, Fx } from './render.ts';
import type { Driver } from './drivers.ts';
import { sfx, unlockAudio } from '../audio.ts';
import { useSettings } from '../store.ts';

export interface Control {
  player: number;
  keys: { pull: string[]; brace: string[]; burst: string[] };
  hint: { pull: string; brace: string; burst: string };
}

export const SOLO_KEYS: Control['keys'] = { pull: ['Space', 'KeyA'], brace: ['KeyS', 'ArrowDown'], burst: ['KeyD', 'ArrowUp'] };
export const SOLO_HINT = { pull: 'Пробел / A', brace: 'S (держать)', burst: 'D' };
export const LEFT_KEYS: Control['keys'] = { pull: ['KeyA'], brace: ['KeyS'], burst: ['KeyD'] };
export const LEFT_HINT = { pull: 'A', brace: 'S (держать)', burst: 'D' };
export const RIGHT_KEYS: Control['keys'] = { pull: ['KeyL'], brace: ['KeyK'], burst: ['KeyJ'] };
export const RIGHT_HINT = { pull: 'L', brace: 'K (держать)', burst: 'J' };

interface Props {
  driver: Driver;
  controls: Control[];
  names: string[]; // per player
  colors: [string, string];
  arena: Arena;
  rope: RopeSkin;
  series?: [number, number];
  bestOf?: number;
  overlay?: ReactNode;
  onEvents?: (ev: GameEvent[], s: MatchState) => void;
}

interface Hud {
  s: MatchState;
  time: number;
}

export function GameView({ driver, controls, names, colors, arena, rope, series, bestOf, overlay, onEvents }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const settings = useSettings();
  const fxRef = useRef(new Fx());
  const posRef = useRef<number | null>(null);
  const propsRef = useRef({ controls, colors, arena, rope, onEvents, reduced: settings.reducedMotion });
  propsRef.current = { controls, colors, arena, rope, onEvents, reduced: settings.reducedMotion };

  // Render loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = now - last;
      last = now;
      driver.update(dt);
      const s = driver.state();
      const cv = canvas.current;
      if (!s || !cv) return;
      const p = propsRef.current;
      const fx = fxRef.current;
      // Rope position is eased for display only.
      if (posRef.current === null || s.tick < 5) posRef.current = s.pos;
      posRef.current += (s.pos - posRef.current) * Math.min(1, (dt / 1000) * 14);
      const ev = driver.drain();
      for (const e of ev) {
        // Only explain failed bursts to the player who pressed the key.
        if (e.type === 'burstFail' && !p.controls.some((c) => c.player === e.p)) continue;
        fx.on(e, s, posRef.current);
        playSound(e, s, p.controls.map((c) => c.player));
      }
      p.onEvents?.(ev, s); // called every frame, also with no events
      fx.update(dt / 1000);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      fx.w = w;
      fx.h = h;
      const c = cv.getContext('2d')!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(
        c,
        w,
        h,
        {
          s,
          pos: posRef.current,
          tickF: driver.tickF(),
          arena: p.arena,
          rope: p.rope,
          colors: p.colors,
          reducedMotion: p.reduced,
          highlight: p.controls.map((x) => x.player),
        },
        fx,
        now,
      );
      if (now - lastHud > 66) {
        lastHud = now;
        setHud({ s: structuredClone(s), time: now });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [driver]);

  // Keyboard: uses physical key codes so any keyboard layout works; auto-repeat is ignored,
  // so holding "pull" does nothing — every pull needs its own press.
  useEffect(() => {
    const find = (code: string, kind: 'pull' | 'brace' | 'burst') =>
      propsRef.current.controls.filter((c) => c.keys[kind].includes(code));
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const all = [...find(e.code, 'pull'), ...find(e.code, 'brace'), ...find(e.code, 'burst')];
      if (!all.length) return;
      e.preventDefault();
      unlockAudio();
      if (e.repeat) return;
      for (const c of find(e.code, 'pull')) driver.act(c.player, { t: 'pull' });
      for (const c of find(e.code, 'burst')) driver.act(c.player, { t: 'burst' });
      for (const c of find(e.code, 'brace')) driver.act(c.player, { t: 'brace', on: true });
    };
    const up = (e: KeyboardEvent) => {
      for (const c of find(e.code, 'brace')) driver.act(c.player, { t: 'brace', on: false });
    };
    const blur = () => propsRef.current.controls.forEach((c) => driver.act(c.player, { t: 'brace', on: false }));
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [driver]);

  const s = hud?.s;
  const teamOf = (t: 0 | 1) => (s ? s.players.map((p, i) => ({ p, i })).filter((x) => x.p.team === t) : []);
  const countdown = s && s.phase === 'countdown' ? Math.ceil((s.startTick - s.tick) / 60) : 0;
  const touchSides = controls.length > 1;

  return (
    <div className="game" ref={wrap}>
      <div className="hud">
        {([0, 1] as const).map((t) => (
          <div key={t} className={`hud-team ${t === 1 ? 'right' : ''}`} style={{ ['--team' as string]: colors[t] }}>
            {teamOf(t).map(({ p, i }) => (
              <PlayerHud key={i} p={p} s={s!} name={names[i] ?? `Игрок ${i + 1}`} mine={controls.some((c) => c.player === i)} />
            ))}
          </div>
        ))}
        <div className="hud-center">
          <div className="timer">{!s ? '—' : s.cfg.practice && s.cfg.durationSec >= 600 ? '∞' : formatTime(secondsLeft(s))}</div>
          {series && bestOf && bestOf > 1 && (
            <div className="series">
              <span style={{ color: colors[0] }}>{series[0]}</span> : <span style={{ color: colors[1] }}>{series[1]}</span>
              <small> до {Math.ceil(bestOf / 2)}</small>
            </div>
          )}
        </div>
      </div>
      <canvas ref={canvas} className="stage" aria-label="Игровое поле: канат и две команды" />
      {countdown > 0 && !driver.paused() && <div className="countdown" key={countdown}>{countdown}</div>}
      {s && s.phase === 'playing' && s.tick - s.startTick < 50 && <div className="countdown go">Тяни!</div>}
      <div className={`touch ${touchSides ? 'sides' : ''}`}>
        {controls.map((c) => {
          const p = s?.players[c.player];
          const ready = !!p && p.burstCharge >= 100 && p.stamina >= BURST_COST;
          return (
            <TouchPad key={c.player} control={c} driver={driver} ready={ready} team={p?.team ?? 0} colors={colors} />
          );
        })}
      </div>
      {overlay}
    </div>
  );
}

function PlayerHud({ p, s, name, mine }: { p: PlayerState; s: MatchState; name: string; mine: boolean }) {
  const status = isExhausted(s, p)
    ? 'Выдохся'
    : p.braceSince >= 0
      ? isBracing(s, p)
        ? 'Упор'
        : 'Упираюсь…'
      : s.phase === 'playing' && isResting(s, p) && p.stamina < 99.9
        ? 'Отдых'
        : p.combo > 1
          ? `Ритм ×${p.combo}`
          : '';
  const low = p.stamina < 25;
  return (
    <div className={`phud ${mine ? 'mine' : ''}`}>
      <div className="phud-name">
        {name}
        {status && <span className={`tag ${isExhausted(s, p) ? 'bad' : ''}`}>{status}</span>}
      </div>
      <div className={`bar stamina ${low ? 'low' : ''}`} title="Выносливость">
        <i style={{ width: `${p.stamina}%` }} />
      </div>
      <div className={`bar burst ${p.burstCharge >= 100 ? (p.stamina < BURST_COST ? 'full weak' : 'full') : ''}`} title="Заряд рывка">
        <i style={{ width: `${p.burstCharge}%` }} />
        {p.burstCharge >= 100 && <span>{p.stamina < BURST_COST ? 'МАЛО СИЛ' : 'РЫВОК'}</span>}
      </div>
    </div>
  );
}

function TouchPad({
  control,
  driver,
  ready,
  team,
  colors,
}: {
  control: Control;
  driver: Driver;
  ready: boolean;
  team: 0 | 1;
  colors: [string, string];
}) {
  const p = control.player;
  const down = (fn: () => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    unlockAudio();
    fn();
  };
  const braceOff = () => driver.act(p, { t: 'brace', on: false });
  return (
    <div className={`pad ${team === 1 ? 'right' : ''}`} style={{ ['--team' as string]: colors[team] }}>
      <button
        className="pad-brace"
        onPointerDown={down(() => driver.act(p, { t: 'brace', on: true }))}
        onPointerUp={braceOff}
        onPointerCancel={braceOff}
        onPointerLeave={braceOff}
        onContextMenu={(e) => e.preventDefault()}
      >
        Упор
        <small>{control.hint.brace}</small>
      </button>
      <button className={`pad-burst ${ready ? 'ready' : ''}`} onPointerDown={down(() => driver.act(p, { t: 'burst' }))}>
        Рывок
        <small>{control.hint.burst}</small>
      </button>
      <button className="pad-pull" onPointerDown={down(() => driver.act(p, { t: 'pull' }))}>
        Тянуть
        <small>{control.hint.pull}</small>
      </button>
    </div>
  );
}

function playSound(e: GameEvent, s: MatchState, mine: number[]) {
  switch (e.type) {
    case 'countdown':
      return sfx.countdown();
    case 'start':
      return sfx.start();
    case 'beat':
      return sfx.beat(e.idx);
    case 'pull':
      if (e.sync) sfx.sync();
      return e.onBeat ? sfx.pullBeat(e.combo) : sfx.pull();
    case 'burst':
      if (e.result === 'blocked') return sfx.blocked();
      sfx.burst();
      return sfx.crowd();
    case 'burstReady':
      return mine.includes(e.p) && sfx.burstReady();
    case 'exhausted':
      return sfx.exhausted();
    case 'burstFail':
      return sfx.denied();
    case 'brace':
      return e.on && sfx.brace();
    case 'end': {
      const myTeams = mine.map((i) => s.players[i]?.team);
      const single = new Set(myTeams).size === 1;
      if (e.winner === 'draw' || !single) return sfx.crowd();
      return e.winner === myTeams[0] ? sfx.win() : sfx.lose();
    }
  }
}

export function formatTime(sec: number) {
  const t = Math.ceil(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
