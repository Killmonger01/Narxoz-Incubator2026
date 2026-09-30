import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent, MatchState } from '../../shared/engine.ts';
import { DIFFICULTY_LABEL, type Difficulty } from '../../shared/bot.ts';
import { arenaById, ropeById } from '../../shared/cosmetics.ts';
import type { ClientMsg, RoomInfo, ServerMsg } from '../../shared/protocol.ts';
import { OnlineDriver } from './drivers.ts';
import { GameView, SOLO_HINT, SOLO_KEYS } from './GameView.tsx';
import { reasonText, StatsGrid } from './Result.tsx';
import { teamColors } from './LocalGame.tsx';
import { getToken, useUser } from '../api.ts';
import { addLocalMatch, clientId, setSettings, useSettings } from '../store.ts';
import { navigate } from '../router.ts';
import { setRoomInMatch } from '../chrome.ts';

type Conn = 'connecting' | 'open' | 'reconnecting' | 'closed';

export function OnlineGame({ code, watch }: { code: string; watch: boolean }) {
  const user = useUser();
  const settings = useSettings();
  const [name, setName] = useState(user?.username || settings.name);
  const [joined, setJoined] = useState(!!(user || settings.name || watch));
  useEffect(() => {
    if (!joined) setRoomInMatch(false);
  }, [joined]);
  useEffect(() => () => setRoomInMatch(false), []);

  if (!joined)
    return (
      <div className="page narrow">
        <h1>Комната {code}</h1>
        <p>Тебя пригласили на перетягивание каната. Как тебя подписать?</p>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setSettings({ name: name.trim().slice(0, 20) });
            setJoined(true);
          }}
        >
          <input autoFocus maxLength={20} placeholder="Твоё имя" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary">Войти в комнату</button>
          <p className="muted small">
            Или <a onClick={() => navigate('/login', { back: `/r/${code}` })}>войди в аккаунт</a> — тогда матч попадёт в
            историю и рейтинг.
          </p>
        </form>
      </div>
    );
  return <Room code={code} watch={watch} name={user?.username || settings.name || 'Гость'} />;
}

function Room({ code, watch, name }: { code: string; watch: boolean; name: string }) {
  const driver = useMemo(() => new OnlineDriver(), []);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [conn, setConn] = useState<Conn>('connecting');
  const [error, setError] = useState('');
  const [rtt, setRtt] = useState<number | null>(null);
  const [last, setLast] = useState<MatchState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<RoomInfo | null>(null);
  const savedRef = useRef(false);

  useEffect(() => {
    let stop = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout>;
    let ping: ReturnType<typeof setInterval>;
    const send = (m: ClientMsg) => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(m));
    driver.send = (a, at) => send({ t: 'act', a, at });

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/room/${code}`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConn('open');
        ws.send(JSON.stringify({ t: 'hello', cid: clientId(), name, token: getToken() ?? undefined, watch } satisfies ClientMsg));
        clearInterval(ping);
        ping = setInterval(() => send({ t: 'ping', c: performance.now() }), 3000);
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data) as ServerMsg;
        if (m.t === 'room') {
          roomRef.current = m.room;
          setRoom(m.room);
          driver.setHeld(!!m.room.pausedFor);
        } else if (m.t === 'state') {
          driver.onState(m.s, m.ev, m.paused);
          if (m.s.phase === 'finished') setLast(m.s);
        } else if (m.t === 'pong') setRtt(Math.round(performance.now() - m.c));
        else if (m.t === 'error') setError(m.msg);
      };
      ws.onclose = (e) => {
        clearInterval(ping);
        if (stop) return;
        if (e.code === 4000) {
          setConn('closed');
          setError('Эта комната открыта в другой вкладке.');
          return;
        }
        if (attempt++ > 12) {
          setConn('closed');
          return;
        }
        setConn('reconnecting');
        retry = setTimeout(connect, Math.min(1000 * attempt, 3000));
      };
    };
    connect();
    return () => {
      stop = true;
      clearTimeout(retry);
      clearInterval(ping);
      wsRef.current?.close();
    };
  }, [code, name, watch, driver]);

  const send = (m: ClientMsg) => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(m));

  // Keep a local copy of finished series (for guests' history).
  useEffect(() => {
    if (!room || room.phase !== 'done' || room.you < 0 || savedRef.current || !last) return;
    savedRef.current = true;
    const t = room.slots[room.you].team;
    const w = room.seriesWinner;
    addLocalMatch({
      at: Date.now(),
      mode: 'online',
      opponent: room.slots.filter((s) => s.team !== t).map((s) => s.name).join(' & '),
      result: w === 'draw' ? 'draw' : w === t ? 'win' : 'loss',
      roundsWon: room.series[t],
      roundsLost: room.series[t === 0 ? 1 : 0],
      durationSec: 0,
      stats: { ...last.players[room.you].stats },
    });
  }, [room, last]);
  useEffect(() => {
    if (room?.phase === 'match') savedRef.current = false;
    setRoomInMatch(!!room && room.phase !== 'lobby');
  }, [room?.phase, !!room]);

  if (conn === 'closed' && !room)
    return (
      <div className="page narrow">
        <h1>Не удалось подключиться</h1>
        <p>{error || `Комната ${code} не найдена или сервер недоступен.`}</p>
        <button className="btn primary" onClick={() => navigate('/online')}>
          К онлайн-играм
        </button>
      </div>
    );
  if (!room) return <div className="page narrow"><p className="muted">Подключаемся к комнате {code}…</p></div>;

  const host = room.slots[room.host];
  const hostCos = host?.cosmetics ?? room.slots[0].cosmetics;
  const colors = teamColors(room.slots[0].cosmetics.color, room.slots[room.teamSize].cosmetics.color);
  const status =
    conn === 'reconnecting' ? <span className="pill warn">Переподключение…</span> : rtt !== null ? <span className="pill">пинг {rtt} мс</span> : null;

  if (room.phase === 'lobby') return <Lobby room={room} send={send} status={status} colors={colors} />;

  const you = room.you;
  const myTeam = you >= 0 ? room.slots[you].team : null;
  let overlay = null;
  if (room.pausedFor) overlay = <PauseOverlay name={room.pausedFor} endsAt={room.pauseEndsAt!} />;
  else if (room.phase === 'between')
    overlay = (
      <div className="overlay soft">
        <div className="card">
          <h2>Раунд {room.round} завершён</h2>
          <p className="big-score">
            <span style={{ color: colors[0] }}>{room.series[0]}</span> : <span style={{ color: colors[1] }}>{room.series[1]}</span>
          </p>
          <p className="muted">Следующий раунд через несколько секунд…</p>
        </div>
      </div>
    );
  else if (room.phase === 'done') {
    const w = room.seriesWinner;
    const heading =
      w === 'draw' ? 'Ничья' : myTeam === null ? `Победили ${w === 0 ? 'левые' : 'правые'}` : w === myTeam ? 'Победа!' : 'Поражение';
    const delta = you >= 0 ? room.ratingDelta[you] : undefined;
    const voted = room.rematch.includes(you);
    overlay = (
      <div className="overlay">
        <div className="card result">
          <p className="eyebrow">Онлайн · комната {room.code}</p>
          <h2 className={w === myTeam ? 'win' : ''}>{heading}</h2>
          {room.bestOf > 1 && (
            <p className="big-score">
              <span style={{ color: colors[0] }}>{room.series[0]}</span> : <span style={{ color: colors[1] }}>{room.series[1]}</span>
            </p>
          )}
          <p className="muted">{last ? reasonText(last.reason, last.winner) : ''}</p>
          {delta !== undefined && delta !== 0 && (
            <p className={`badge ${delta > 0 ? '' : 'bad'}`}>
              Рейтинг {delta > 0 ? '+' : ''}
              {delta}
            </p>
          )}
          {last && you >= 0 && <StatsGrid st={last.players[you].stats} />}
          <div className="row">
            {you >= 0 && (
              <button className="btn primary" onClick={() => send({ t: 'rematch' })} disabled={voted}>
                {voted ? `Ждём соперника… (${room.rematch.length})` : 'Реванш'}
              </button>
            )}
            <button className="btn" onClick={() => navigate('/')}>
              В меню
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="play-screen">
      <div className="play-top">
        <button className="btn ghost small" onClick={() => navigate('/')}>
          ← Выйти
        </button>
        <span className="play-title">
          {you < 0 ? '👁 Режим зрителя · ' : ''}Комната {room.code} · раунд {room.round}
          {room.spectators > 0 && ` · зрителей: ${room.spectators}`}
        </span>
        {status}
      </div>
      <GameView
        driver={driver}
        controls={you >= 0 ? [{ player: you, keys: SOLO_KEYS, hint: SOLO_HINT }] : []}
        names={room.slots.map((s) => s.name)}
        colors={colors}
        arena={arenaById(hostCos.arena)}
        rope={ropeById(hostCos.rope)}
        series={room.series}
        bestOf={room.bestOf}
        overlay={overlay}
        onEvents={(_ev: GameEvent[]) => {}}
      />
    </div>
  );
}

function PauseOverlay({ name, endsAt }: { name: string; endsAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="overlay">
      <div className="card">
        <h2>Пауза</h2>
        <p>
          <b>{name}</b> потерял соединение. Ждём ещё {Math.max(0, Math.ceil((endsAt - now) / 1000))} с — потом засчитаем
          техническое поражение.
        </p>
      </div>
    </div>
  );
}

function Lobby({
  room,
  send,
  status,
  colors,
}: {
  room: RoomInfo;
  send: (m: ClientMsg) => void;
  status: React.ReactNode;
  colors: [string, string];
}) {
  const link = `${location.origin}/r/${room.code}`;
  const [copied, setCopied] = useState(false);
  const me = room.you >= 0 ? room.slots[room.you] : null;
  const isHost = room.you === room.host;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Тянем-Потянем', text: 'Го на перетягивание каната!', url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {}
  };
  const missing = room.slots.filter((s) => s.empty).length;
  const notReady = room.slots.filter((s) => !s.empty && !s.ready).length;

  return (
    <div className="page">
      <div className="lobby-head">
        <div>
          <p className="eyebrow">
            Комната · 1×1 · {room.bestOf === 1 ? '1 раунд' : `до ${Math.ceil(room.bestOf / 2)} побед`} · {room.durationSec} с
          </p>
          <h1 className="code">{room.code}</h1>
        </div>
        {status}
      </div>
      <div className="invite">
        <input readOnly value={link} onFocus={(e) => e.target.select()} />
        <button className="btn primary" onClick={share}>
          {copied ? 'Скопировано!' : 'Пригласить'}
        </button>
      </div>
      <p className="muted small">
        Отправь ссылку другу — он откроет её на своём телефоне или компьютере и сразу попадёт в комнату. Код комнаты
        можно ввести и вручную в разделе «Онлайн».
      </p>
      {!me && <p className="pill">Все места заняты — ты смотришь как зритель.</p>}

      <div className="teams">
        {([0, 1] as const).map((t) => (
          <div key={t} className="team-col" style={{ ['--team' as string]: colors[t] }}>
            <h3>{t === 0 ? 'Левая команда' : 'Правая команда'}</h3>
            {room.slots.map((s, i) =>
              s.team !== t ? null : (
                <div key={i} className={`slot ${s.empty ? 'empty' : ''} ${i === room.you ? 'you' : ''}`}>
                  {s.empty ? (
                    <>
                      <span className="muted">Свободно</span>
                      <div className="slot-actions">
                        {me && (
                          <button className="btn small" onClick={() => send({ t: 'team', slot: i })}>
                            Сесть сюда
                          </button>
                        )}
                        {isHost && (
                          <select
                            value=""
                            onChange={(e) => send({ t: 'bot', slot: i, difficulty: e.target.value as Difficulty })}
                          >
                            <option value="">+ Бот</option>
                            {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => (
                              <option key={d} value={d}>
                                {DIFFICULTY_LABEL[d]}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <span>
                        {s.name}
                        {i === room.you && ' (ты)'}
                        {i === room.host && ' 👑'}
                      </span>
                      <span className="slot-actions">
                        <span className={`pill ${s.ready ? 'ok' : ''}`}>{s.ready ? 'Готов' : 'Не готов'}</span>
                        {isHost && s.bot && (
                          <button className="btn small ghost" onClick={() => send({ t: 'bot', slot: i, difficulty: null })}>
                            ✕
                          </button>
                        )}
                      </span>
                    </>
                  )}
                </div>
              ),
            )}
          </div>
        ))}
      </div>

      {me && (
        <button className={`btn big ${me.ready ? '' : 'primary'}`} onClick={() => send({ t: 'ready', on: !me.ready })}>
          {me.ready ? 'Не готов' : 'Я готов!'}
        </button>
      )}
      <p className="muted">
        {missing > 0
          ? `Ждём игроков: свободно мест — ${missing}.${isHost ? ' Можно посадить бота.' : ''}`
          : notReady > 0
            ? `Ждём готовности: ${notReady}.`
            : 'Все готовы — начинаем!'}
      </p>
      <p className="muted small">Управление: Пробел/A — тянуть, S — упор (держать), D — рывок. На телефоне — кнопки внизу.</p>
    </div>
  );
}
