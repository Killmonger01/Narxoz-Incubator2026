import { useEffect, useState } from 'react';
import { DIFFICULTY_LABEL, type Difficulty } from '../../shared/bot.ts';
import { api, useUser } from '../api.ts';
import { navigate } from '../router.ts';
import { setSettings, tutorialDone, useSettings } from '../store.ts';
import { unlockAudio } from '../audio.ts';

const DIFF_TEXT: Record<Difficulty, string> = {
  easy: 'Часто сбивается с ритма и тянет до изнеможения. Для первого матча.',
  medium: 'Держит ритм, отдыхает вовремя и иногда упирается против рывка.',
  hard: 'Точный ритм, бьёт рывком, когда ты отдыхаешь, пережидает твой упор.',
  champion: 'Почти идеальный ритм и быстрая реакция. Победа — повод для скриншота.',
};

export function Home() {
  const user = useUser();
  const firstTime = !tutorialDone();
  return (
    <div className="page home">
      <section className="hero">
        <h1>
          Тянем<span>‑</span>Потянем
        </h1>
        <p className="lead">
          Перетягивание каната, где побеждает не тот, кто быстрее жмёт, а тот, кто держит ритм, бережёт силы и
          выбирает момент для рывка.
        </p>
        {firstTime && (
          <button className="btn primary big" onClick={() => navigate('/tutorial')}>
            Первый раз? Пройди обучение за 1 минуту
          </button>
        )}
      </section>
      <div className="modes">
        <ModeCard icon="🤖" title="Против бота" text="4 уровня сложности, серии раундов" onClick={() => navigate('/play/bot')} primary={!firstTime} />
        <ModeCard icon="🌐" title="Онлайн с другом" text="Комната по ссылке, 1×1 или 2×2, рейтинг" onClick={() => navigate('/online')} />
        <ModeCard icon="👥" title="Вдвоём на одном экране" text="Клавиатура пополам или телефон на столе" onClick={() => navigate('/play/hotseat')} />
        <ModeCard icon="🎯" title="Испытания" text="Метроном, спринт, камбэк — побей свой рекорд" onClick={() => navigate('/challenges')} />
        <ModeCard icon="🎓" title="Обучение" text="Пошаговая тренировка с манекеном" onClick={() => navigate('/tutorial')} />
        <ModeCard icon="📖" title="Правила" text="Как устроены ритм, рывок, упор и отдых" onClick={() => navigate('/rules')} />
      </div>
      {!user && (
        <p className="muted center">
          <a onClick={() => navigate('/login')}>Войди или зарегистрируйся</a>, чтобы история матчей, рекорды и рейтинг
          были доступны с любого устройства.
        </p>
      )}
    </div>
  );
}

function ModeCard({ icon, title, text, onClick, primary }: { icon: string; title: string; text: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      className={`mode ${primary ? 'primary' : ''}`}
      onClick={() => {
        unlockAudio();
        onClick();
      }}
    >
      <span className="mode-icon">{icon}</span>
      <b>{title}</b>
      <span>{text}</span>
    </button>
  );
}

export function MatchOptions() {
  const s = useSettings();
  return (
    <div className="options">
      <label>
        Серия
        <Seg value={s.bestOf} onChange={(v) => setSettings({ bestOf: v })} items={[[1, '1 раунд'], [3, 'до 2 побед'], [5, 'до 3 побед']]} />
      </label>
      <label>
        Длительность раунда
        <Seg value={s.durationSec} onChange={(v) => setSettings({ durationSec: v })} items={[[45, '45 с'], [60, '60 с'], [90, '90 с']]} />
      </label>
    </div>
  );
}

export function Seg<T extends string | number | boolean>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="seg" role="radiogroup">
      {items.map(([v, label]) => (
        <button key={String(v)} role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function BotSetup() {
  const s = useSettings();
  return (
    <div className="page">
      <h1>Против бота</h1>
      <p className="muted">Бот играет по тем же правилам: тратит выносливость, выдыхается и не видит больше, чем ты на экране.</p>
      <div className="diffs">
        {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d, i) => (
          <button key={d} className={`diff ${s.difficulty === d ? 'on' : ''}`} onClick={() => setSettings({ difficulty: d })}>
            <b>
              {'★'.repeat(i + 1)}
              {'☆'.repeat(3 - i)} {DIFFICULTY_LABEL[d]}
            </b>
            <span>{DIFF_TEXT[d]}</span>
          </button>
        ))}
      </div>
      <MatchOptions />
      <button className="btn primary big" onClick={() => navigate('/game', { kind: 'bot', difficulty: s.difficulty })}>
        Начать матч
      </button>
      <Controls />
    </div>
  );
}

export function HotseatSetup() {
  return (
    <div className="page">
      <h1>Вдвоём на одном устройстве</h1>
      <div className="two-col">
        <div className="keys-card" style={{ ['--team' as string]: '#e5484d' }}>
          <h3>Левый игрок</h3>
          <Key k="A" t="тянуть" />
          <Key k="S" t="упор (держать)" />
          <Key k="D" t="рывок" />
        </div>
        <div className="keys-card" style={{ ['--team' as string]: '#3e63dd' }}>
          <h3>Правый игрок</h3>
          <Key k="L" t="тянуть" />
          <Key k="K" t="упор (держать)" />
          <Key k="J" t="рывок" />
        </div>
      </div>
      <p className="muted">На телефоне или планшете у каждого игрока свои кнопки у своего края экрана — положите устройство горизонтально.</p>
      <MatchOptions />
      <button className="btn primary big" onClick={() => navigate('/game', { kind: 'hotseat' })}>
        Начать матч
      </button>
    </div>
  );
}

const Key = ({ k, t }: { k: string; t: string }) => (
  <p className="key-row">
    <kbd>{k}</kbd> {t}
  </p>
);

export function Controls() {
  return (
    <div className="controls-hint">
      <Key k="Пробел / A" t="тянуть — каждое нажатие отдельно" />
      <Key k="S" t="упор — держать" />
      <Key k="D" t="рывок — когда шкала заполнена" />
      <Key k="Esc" t="пауза" />
    </div>
  );
}

export function OnlineSetup() {
  const user = useUser();
  const [teamSize, setTeamSize] = useState(1);
  const [bestOf, setBestOf] = useState(3);
  const [duration, setDuration] = useState(60);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [live, setLive] = useState<{ code: string; team_size: number; players: string }[]>([]);

  useEffect(() => {
    api('/rooms/live')
      .then((d) => setLive(d.rooms))
      .catch(() => {});
  }, []);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const { code } = await api('/rooms', { body: { teamSize, bestOf, durationSec: duration } });
      navigate(`/r/${code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(c)) return setError('Код комнаты — 5 символов');
    try {
      await api(`/rooms/${c}`);
      navigate(`/r/${c}`);
    } catch {
      setError('Комната не найдена');
    }
  };

  return (
    <div className="page">
      <h1>Онлайн</h1>
      <p className="muted">
        Матч идёт на сервере: он сам считает выносливость, ритм и победителя, так что оба игрока видят одинаковый итог.
        {!user && ' Без входа можно играть как гость, но рейтинг и история сохраняются только для аккаунтов.'}
      </p>
      <div className="two-col">
        <div className="card flat">
          <h3>Создать комнату</h3>
          <div className="options">
            <label>
              Формат
              <Seg value={teamSize} onChange={setTeamSize} items={[[1, '1 × 1'], [2, '2 × 2']]} />
            </label>
            <label>
              Серия
              <Seg value={bestOf} onChange={setBestOf} items={[[1, '1 раунд'], [3, 'до 2'], [5, 'до 3']]} />
            </label>
            <label>
              Раунд
              <Seg value={duration} onChange={setDuration} items={[[45, '45 с'], [60, '60 с'], [90, '90 с']]} />
            </label>
          </div>
          <button className="btn primary big" onClick={create} disabled={busy}>
            {busy ? 'Создаём…' : 'Создать и пригласить'}
          </button>
        </div>
        <div className="card flat">
          <h3>Войти по коду</h3>
          <form className="form" onSubmit={join}>
            <input
              placeholder="Например, K7QXM"
              value={code}
              maxLength={5}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              style={{ textTransform: 'uppercase', letterSpacing: '0.2em' }}
            />
            <button className="btn">Войти</button>
          </form>
          <h3 style={{ marginTop: 24 }}>Идут сейчас</h3>
          {live.length === 0 && <p className="muted small">Сейчас никто не играет. Создай комнату первым!</p>}
          {live.map((r) => (
            <div key={r.code} className="live-row">
              <span>
                <b>{r.code}</b> · {r.team_size}×{r.team_size} · {r.players}
              </span>
              <button className="btn small" onClick={() => navigate(`/r/${r.code}?watch=1`)}>
                👁 Смотреть
              </button>
            </div>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function Rules() {
  return (
    <div className="page prose">
      <h1>Правила</h1>
      <p>
        Две команды тянут канат. Посередине — красная отметка. <b>Перетяни отметку за свою линию</b> (цветная черта
        на твоей стороне) — и раунд твой.
      </p>
      <h2>Время</h2>
      <p>
        Раунд длится 45, 60 или 90 секунд. Если никто не перетянул, побеждает сторона, на чьей половине отметка. Если
        отметка ближе 10% к центру — ничья. В серии «до 2 побед» ничейный раунд не засчитывается никому (максимум 5
        раундов).
      </p>
      <h2>Четыре действия</h2>
      <ul>
        <li>
          <b>Тянуть</b> (Пробел / A, кнопка «Тянуть»). Каждое нажатие — одна тяга. Удерживать кнопку бесполезно, а нажатия
          чаще ~8 в секунду не засчитываются.
        </li>
        <li>
          <b>Ритм.</b> Над канатом пульсирует кольцо (100 ударов в минуту). Тяга в момент, когда кольцо зелёное (±0,1 с),
          — <b>в 3 раза сильнее</b> и стоит 4 выносливости вместо 6. Тяги в ритм подряд копят серию.
        </li>
        <li>
          <b>Рывок</b> (D). Каждая тяга в ритм заряжает шкалу на 25%. Полная шкала — мощный рывок за 15 выносливости.
          Если соперник в этот момент отдыхает или выдохся — <b>«Срыв!»</b> ×1.5. Если он в упоре — <b>«Отбит!»</b>, рывок
          теряет большую часть силы.
        </li>
        <li>
          <b>Упор</b> (держать S). Через 0,1 с после начала упора соперник тянет в 2,5 раза слабее. В упоре нельзя тянуть и
          силы понемногу тратятся (5 в секунду).
        </li>
      </ul>
      <h2>Выносливость</h2>
      <p>
        Зелёная полоса. Чем её меньше, тем слабее тяга (до −45%). Если потратить всё — <b>«Выдохся»</b>: 1,5 секунды нельзя
        ничего делать. Силы восстанавливаются, если 0,4 с не тянуть и не упираться, — но пока ты отдыхаешь, соперник тянет
        свободно. Ритм почти окупается: между ударами ты чуть-чуть успеваешь восстановиться, а спам «на скорость»
        выжигает силы за пару секунд.
      </p>
      <h2>Тактика</h2>
      <ul>
        <li>Видишь у соперника «РЫВОК» — готовь упор.</li>
        <li>Соперник упёрся — отдыхай: тянуть в упор невыгодно.</li>
        <li>Соперник отдыхает или выдохся — самое время для рывка.</li>
        <li>В 2×2 тяните на один бит с напарником — «Синхрон!» ×1.5, а одновременные рывки — «Командный рывок» ×1.4.</li>
      </ul>
      <h2>Честность</h2>
      <p>
        Игра считается с фиксированной частотой 60 шагов в секунду — скорость не зависит от FPS. Ввод до старта и после
        финиша игнорируется. В онлайне всё считает сервер: клиент отправляет только нажатия.
      </p>
      <button className="btn primary" onClick={() => navigate('/tutorial')}>
        Попробовать в обучении
      </button>
    </div>
  );
}
