import { useEffect, useState } from 'react';
import { CHALLENGES } from '../../shared/challenges.ts';
import { api, getToken, logout, refreshMe, setAuth, useUser } from '../api.ts';
import { navigate, useRoute } from '../router.ts';
import { localBests, localHistory, type LocalMatch } from '../store.ts';
import { formatScore } from '../game/LocalGame.tsx';
import { Seg } from './Menu.tsx';

export function Login() {
  const route = useRoute();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [group, setGroup] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api(`/auth/${mode}`, { body: { username, password, group } });
      setAuth(data.token, data.user);
      navigate(route.state?.back ?? '/profile', null, true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <h1>{mode === 'login' ? 'Вход' : 'Регистрация'}</h1>
      <Seg value={mode} onChange={setMode} items={[['login', 'Вход'], ['register', 'Новый аккаунт']]} />
      <form className="form" onSubmit={submit}>
        <input autoComplete="username" placeholder="Ник" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          placeholder="Пароль (от 6 символов)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {mode === 'register' && (
          <input placeholder="Группа или команда (необязательно), напр. ИС-21" value={group} maxLength={30} onChange={(e) => setGroup(e.target.value)} />
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn primary big" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </button>
      </form>
      <p className="muted small">
        Для проверки есть тестовый аккаунт: <b>demo</b> / <b>demo123</b>.
      </p>
    </div>
  );
}

interface ServerMatch {
  id: number;
  mode: string;
  verified: number;
  opponent: string;
  result: 'win' | 'loss' | 'draw';
  rounds_won: number;
  rounds_lost: number;
  duration_sec: number;
  rating_delta: number;
  created_at: number;
  stats: Record<string, number>;
}

const MODE_LABEL: Record<string, string> = { bot: 'Бот', hotseat: 'Вдвоём', online: 'Онлайн' };
const RESULT_LABEL = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' };

export function Profile() {
  const user = useUser();
  const [data, setData] = useState<any>(null);
  const [matches, setMatches] = useState<ServerMatch[] | null>(null);
  const [group, setGroup] = useState(user?.group ?? '');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    refreshMe().then((d) => d && setData(d));
    api('/matches')
      .then((d) => setMatches(d.matches))
      .catch(() => setMatches([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const local = localHistory();
  const list: (ServerMatch | (LocalMatch & { local: true }))[] = user
    ? matches ?? []
    : local.map((m) => ({ ...m, local: true as const }));

  const count = (mode: string | null, r: string) =>
    list.filter((m) => (mode === null || m.mode === mode) && m.result === r).length;

  const bests: Record<string, number> = user && data ? Object.fromEntries(data.challenges.map((c: any) => [c.challenge_id, c.best])) : localBests();

  return (
    <div className="page">
      <div className="profile-head">
        <div>
          <h1>{user ? user.username : 'Гость'}</h1>
          {user ? (
            <p className="muted">
              Рейтинг <b>{user.rating}</b>
              {user.pro && <span className="pill pro">PRO</span>}
              {user.group && ` · ${user.group}`}
            </p>
          ) : (
            <p className="muted">
              История хранится только в этом браузере. <a onClick={() => navigate('/login')}>Войди</a>, чтобы видеть её
              везде.
            </p>
          )}
        </div>
        {user && (
          <button
            className="btn ghost"
            onClick={async () => {
              await logout();
              navigate('/');
            }}
          >
            Выйти
          </button>
        )}
      </div>

      <div className="stat-cards">
        {(['online', 'bot', 'hotseat'] as const).map((m) => (
          <div key={m} className="stat-card">
            <span>{MODE_LABEL[m]}</span>
            <b>
              {count(m, 'win')}–{count(m, 'loss')}
            </b>
            <small>побед–поражений{count(m, 'draw') ? `, ${count(m, 'draw')} ничьих` : ''}</small>
          </div>
        ))}
        <div className="stat-card">
          <span>Всего</span>
          <b>{list.length ? Math.round((count(null, 'win') / list.length) * 100) : 0}%</b>
          <small>побед из {list.length}</small>
        </div>
      </div>

      <h2>Рекорды испытаний</h2>
      <div className="stat-cards">
        {CHALLENGES.map((c) => (
          <div key={c.id} className="stat-card">
            <span>{c.name}</span>
            <b>{bests[c.id] !== undefined ? formatScore(bests[c.id]) : '—'}</b>
            <small>{c.unit}</small>
          </div>
        ))}
      </div>

      {user && (
        <form
          className="form inline"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = await api('/me', { method: 'PATCH', body: { group } });
            setAuth(getToken(), d.user);
            setSaved(true);
          }}
        >
          <input placeholder="Группа / команда для рейтинга групп" value={group} maxLength={30} onChange={(e) => (setGroup(e.target.value), setSaved(false))} />
          <button className="btn">{saved ? 'Сохранено' : 'Сохранить'}</button>
        </form>
      )}

      <h2>История матчей</h2>
      {user && matches === null && <p className="muted">Загрузка…</p>}
      {list.length === 0 && (matches !== null || !user) && <p className="muted">Пока пусто. Сыграй первый матч!</p>}
      <div className="history">
        {list.map((m, i) => {
          const at = 'local' in m ? m.at : m.created_at;
          const won = 'local' in m ? m.roundsWon : m.rounds_won;
          const lost = 'local' in m ? m.roundsLost : m.rounds_lost;
          const delta = 'local' in m ? 0 : m.rating_delta;
          const st = m.stats ?? {};
          return (
            <div key={i} className={`hrow ${m.result}`}>
              <span className="hres">{RESULT_LABEL[m.result]}</span>
              <span>
                <b>{m.opponent}</b>
                <small>
                  {MODE_LABEL[m.mode] ?? m.mode} · {new Date(at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                  {st.pulls ? ` · в ритм ${Math.round(((st.onBeat ?? 0) / st.pulls) * 100)}%` : ''}
                  {'verified' in m && m.verified ? ' · ✓ сервер' : ''}
                </small>
              </span>
              <span className="hscore">
                {won}:{lost}
                {delta ? <small className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? `+${delta}` : delta}</small> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Leaderboard() {
  const [data, setData] = useState<{ players: any[]; groups: any[] } | null>(null);
  const [tab, setTab] = useState<'players' | 'groups'>('players');
  const [error, setError] = useState('');
  useEffect(() => {
    api('/leaderboard')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="page">
      <h1>Рейтинг</h1>
      <p className="muted">Только онлайн-матчи, результат которых определил сервер. Рейтинг Эло меняется только в матчах, где все игроки вошли в аккаунт.</p>
      <Seg value={tab} onChange={setTab} items={[['players', 'Игроки'], ['groups', 'Группы']]} />
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Загрузка…</p>}
      {data && tab === 'players' && (
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Игрок</th>
              <th>Группа</th>
              <th>Рейтинг</th>
              <th>П–П</th>
            </tr>
          </thead>
          <tbody>
            {data.players.map((p, i) => (
              <tr key={p.username}>
                <td>{i + 1}</td>
                <td>
                  {p.username} {p.pro && <span className="pill pro">PRO</span>}
                </td>
                <td className="muted">{p.group || '—'}</td>
                <td>
                  <b>{p.rating}</b>
                </td>
                <td>
                  {p.wins}–{p.losses}
                </td>
              </tr>
            ))}
            {data.players.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Пока никто не сыграл онлайн. Стань первым!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {data && tab === 'groups' && (
        <>
          <p className="muted small">Укажи группу в профиле — и каждая твоя онлайн-победа пойдёт в зачёт группы.</p>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Группа</th>
                <th>Побед</th>
                <th>Игр</th>
                <th>Игроков</th>
                <th>Ср. рейтинг</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g, i) => (
                <tr key={g.name}>
                  <td>{i + 1}</td>
                  <td>
                    <b>{g.name}</b>
                  </td>
                  <td>{g.wins}</td>
                  <td>{g.games}</td>
                  <td>{g.members}</td>
                  <td>{g.rating}</td>
                </tr>
              ))}
              {data.groups.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Пока ни одна группа не сыграла.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function Challenges() {
  const user = useUser();
  const [server, setServer] = useState<Record<string, number>>({});
  useEffect(() => {
    if (user)
      refreshMe().then((d) => d && setServer(Object.fromEntries(d.challenges.map((c: any) => [c.challenge_id, c.best]))));
  }, [user?.id]);
  const bests = { ...localBests(), ...server };
  return (
    <div className="page">
      <h1>Испытания</h1>
      <p className="muted">Короткие задания на отдельные навыки. Лучший результат сохраняется{user ? ' в аккаунте' : ' в браузере'}.</p>
      <div className="modes">
        {CHALLENGES.map((c) => (
          <button key={c.id} className="mode" onClick={() => navigate('/game', { kind: 'challenge', id: c.id })}>
            <b>{c.name}</b>
            <span>{c.goal}</span>
            <span className="record">
              Рекорд: {bests[c.id] !== undefined ? `${formatScore(bests[c.id])} ${c.unit}` : '—'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
