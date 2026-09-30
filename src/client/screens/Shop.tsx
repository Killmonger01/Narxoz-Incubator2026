import { useEffect, useRef, useState } from 'react';
import { ARENAS, cardBrand, COLORS, luhnValid, PRO_PRICE_KZT, ROPES, TEST_CARD, TEST_CARD_DECLINED, type Cosmetics } from '../../shared/cosmetics.ts';
import { createMatch } from '../../shared/engine.ts';
import { api, getToken, setAuth, useUser } from '../api.ts';
import { navigate } from '../router.ts';
import { setSettings, useSettings } from '../store.ts';
import { draw, Fx } from '../game/render.ts';
import { teamColors, useCosmetics } from '../game/LocalGame.tsx';
import { arenaById, ropeById } from '../../shared/cosmetics.ts';
import { Seg } from './Menu.tsx';

export function Shop() {
  const user = useUser();
  const cos = useCosmetics();
  const [checkout, setCheckout] = useState(false);
  const pro = !!user?.pro;

  const choose = async (patch: Partial<Cosmetics>) => {
    const next = { ...cos, ...patch };
    if (user) {
      const d = await api('/me', { method: 'PATCH', body: { cosmetics: next } });
      setAuth(getToken(), d.user);
    } else setSettings({ guestCosmetics: next });
  };

  const Item = ({ id, name, isPro, active, onPick, swatch }: { id: string; name: string; isPro: boolean; active: boolean; onPick: () => void; swatch: React.ReactNode }) => {
    const locked = isPro && !pro;
    return (
      <button key={id} className={`item ${active ? 'on' : ''} ${locked ? 'locked' : ''}`} onClick={() => (locked ? setCheckout(true) : onPick())}>
        {swatch}
        <span>{name}</span>
        {locked && <small>🔒 PRO</small>}
      </button>
    );
  };

  return (
    <div className="page">
      <h1>Оформление и Pro</h1>
      <p className="muted">
        Pro меняет только внешний вид: арены, канаты и цвета команд. На силу, выносливость и правила он не влияет — в
        соревновании все равны. В онлайне все игроки видят арену и канат хозяина комнаты.
      </p>

      <Preview cos={cos} />

      <h3>Арена</h3>
      <div className="items">
        {ARENAS.map((a) => (
          <Item key={a.id} id={a.id} name={a.name} isPro={a.pro} active={cos.arena === a.id} onPick={() => choose({ arena: a.id })}
            swatch={<i className="sw" style={{ background: `linear-gradient(${a.sky[0]}, ${a.sky[1]} 60%, ${a.ground} 60%)` }} />} />
        ))}
      </div>
      <h3>Канат</h3>
      <div className="items">
        {ROPES.map((r) => (
          <Item key={r.id} id={r.id} name={r.name} isPro={r.pro} active={cos.rope === r.id} onPick={() => choose({ rope: r.id })}
            swatch={<i className="sw" style={{ background: `repeating-linear-gradient(45deg, ${r.colors[0]} 0 8px, ${r.colors[1]} 8px 16px)` }} />} />
        ))}
      </div>
      <h3>Цвет команды</h3>
      <div className="items">
        {COLORS.map((c) => (
          <Item key={c.id} id={c.id} name={c.name} isPro={c.pro} active={cos.color === c.id} onPick={() => choose({ color: c.id })}
            swatch={<i className="sw round" style={{ background: c.hex }} />} />
        ))}
      </div>

      <div className="card flat pro-card">
        <div>
          <h2>
            Тянем-Потянем <span className="pill pro">PRO</span>
          </h2>
          <ul>
            <li>3 арены: ночной стадион, пляж Капчагая, Медеу зимой</li>
            <li>3 каната и 3 цвета команд</li>
            <li>Твоя арена — у всех в комнате, где ты хозяин</li>
            <li>Значок PRO в рейтинге</li>
          </ul>
          <p className="muted small">Дальше в планах: Pro-кабинет организатора — турнирные сетки и приватные турниры для групп и мероприятий.</p>
        </div>
        <div className="pro-buy">
          {pro ? (
            <>
              <p>
                Активен до <b>{new Date(user!.proUntil).toLocaleDateString('ru-RU')}</b>
              </p>
              <button
                className="btn ghost small"
                onClick={async () => {
                  const d = await api('/shop/cancel', { method: 'POST' });
                  setAuth(getToken(), d.user);
                }}
              >
                Отменить (тест)
              </button>
            </>
          ) : (
            <>
              <p className="price">
                {PRO_PRICE_KZT} ₸ <small>/ месяц</small>
              </p>
              <button className="btn primary big" onClick={() => (user ? setCheckout(true) : navigate('/login', { back: '/shop' }))}>
                {user ? 'Оформить Pro' : 'Войти и оформить'}
              </button>
            </>
          )}
        </div>
      </div>

      {checkout && <Checkout onClose={() => setCheckout(false)} signedIn={!!user} />}
    </div>
  );
}

/** Static scene preview with the current look. */
function Preview({ cos }: { cos: Cosmetics }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const s = createMatch({ durationSec: 60, teamSize: 1 });
    s.phase = 'playing';
    s.tick = s.startTick + 10;
    s.players.forEach((p) => (p.force = 3));
    const fx = new Fx();
    let raf = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const c = cv.getContext('2d')!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.pos = Math.sin(t / 900) * 0.25;
      draw(c, w, h, { s, pos: s.pos, tickF: s.startTick + 20, arena: arenaById(cos.arena), rope: ropeById(cos.rope), colors: teamColors(cos.color), reducedMotion: true, highlight: [] }, fx, t);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [cos]);
  return <canvas ref={ref} className="preview" />;
}

export function Settings() {
  const s = useSettings();
  return (
    <div className="page narrow">
      <h1>Настройки</h1>
      <p className="muted small">Сохраняются в этом браузере.</p>
      <div className="options">
        <label>
          Звук
          <Seg value={s.sound} onChange={(v) => setSettings({ sound: v })} items={[[true, 'Вкл'], [false, 'Выкл']]} />
        </label>
        <label>
          Громкость
          <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => setSettings({ volume: +e.target.value })} />
        </label>
        <label>
          Тряска экрана и анимации
          <Seg value={s.reducedMotion} onChange={(v) => setSettings({ reducedMotion: v })} items={[[false, 'Полные'], [true, 'Спокойные']]} />
        </label>
        <label>
          Серия по умолчанию
          <Seg value={s.bestOf} onChange={(v) => setSettings({ bestOf: v })} items={[[1, '1 раунд'], [3, 'до 2'], [5, 'до 3']]} />
        </label>
        <label>
          Длительность раунда
          <Seg value={s.durationSec} onChange={(v) => setSettings({ durationSec: v })} items={[[45, '45 с'], [60, '60 с'], [90, '90 с']]} />
        </label>
        <label>
          Имя для онлайна (для гостей)
          <input value={s.name} maxLength={20} placeholder="Гость" onChange={(e) => setSettings({ name: e.target.value })} />
        </label>
      </div>
    </div>
  );
}

interface Payment {
  id: string;
  amount: number;
  currency: string;
  last4: string;
  createdAt: number;
  until: number;
}

const formatCard = (v: string) => v.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();
const formatExp = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

/**
 * Checkout window in the style of a payment provider's test mode: the card is
 * validated like a real one, then the server records the payment and turns
 * Pro on. No money moves — the banner says so on every step.
 */
function Checkout({ onClose, signedIn }: { onClose: () => void; signedIn: boolean }) {
  const [card, setCard] = useState('');
  const [exp, setExp] = useState('');
  const [cvc, setCvc] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<'form' | 'processing' | 'done'>('form');
  const [payment, setPayment] = useState<Payment | null>(null);
  const digits = card.replace(/\s/g, '');
  const brand = cardBrand(digits);
  const cardOk = luhnValid(digits);

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!cardOk) return setError('Проверь номер карты');
    if (!/^\d{2}\/\d{2}$/.test(exp)) return setError('Срок в формате ММ/ГГ');
    if (!/^\d{3,4}$/.test(cvc)) return setError('CVC — 3 цифры');
    if (name.trim().length < 2) return setError('Укажи имя, как на карте');
    setStep('processing');
    const started = Date.now();
    try {
      const d = await api('/shop/test-purchase', { body: { card: digits, exp, cvc, name } });
      // A short pause so the "processing" state reads as a real authorisation.
      await new Promise((r) => setTimeout(r, Math.max(0, 1400 - (Date.now() - started))));
      setAuth(getToken(), d.user);
      setPayment(d.payment);
      setStep('done');
    } catch (err) {
      await new Promise((r) => setTimeout(r, Math.max(0, 900 - (Date.now() - started))));
      setError((err as Error).message);
      setStep('form');
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && step !== 'processing' && onClose()}>
      <div className="card checkout">
        <div className="checkout-head">
          <span className="pill warn">Тестовый режим · деньги не списываются</span>
          <b>Касса</b>
        </div>
        {!signedIn ? (
          <>
            <h2>Pro на 30 дней · {PRO_PRICE_KZT} ₸</h2>
            <p>Pro привязывается к аккаунту.</p>
            <button className="btn primary" onClick={() => navigate('/login', { back: '/shop' })}>
              Войти
            </button>
          </>
        ) : step === 'done' && payment ? (
          <div className="receipt">
            <span className="receipt-ok">✓</span>
            <h2>Платёж принят</h2>
            <p className="muted">Pro активен до {new Date(payment.until).toLocaleDateString('ru-RU')}</p>
            <dl>
              <dt>Номер платежа</dt>
              <dd>{payment.id}</dd>
              <dt>Сумма</dt>
              <dd>
                {payment.amount} {payment.currency === 'KZT' ? '₸' : payment.currency}
              </dd>
              <dt>Карта</dt>
              <dd>•••• {payment.last4}</dd>
              <dt>Дата</dt>
              <dd>{new Date(payment.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</dd>
              <dt>Режим</dt>
              <dd>test — реальное списание не выполнялось</dd>
            </dl>
            <button className="btn primary" onClick={onClose} autoFocus>
              К оформлению
            </button>
          </div>
        ) : step === 'processing' ? (
          <div className="receipt">
            <span className="spinner" aria-hidden="true" />
            <h2>Обрабатываем платёж…</h2>
            <p className="muted">Проверяем карту и подтверждаем подписку</p>
          </div>
        ) : (
          <form className="form checkout-form" onSubmit={pay}>
            <div className="checkout-sum">
              <span>Тянем‑Потянем Pro · 30 дней</span>
              <b>{PRO_PRICE_KZT} ₸</b>
            </div>
            <label className="field">
              Номер карты
              <span className="card-input">
                <input
                  inputMode="numeric"
                  autoComplete="cc-number"
                  placeholder="0000 0000 0000 0000"
                  value={card}
                  onChange={(e) => setCard(formatCard(e.target.value))}
                  autoFocus
                />
                <span className={`brand ${brand}`}>{brand === 'visa' ? 'VISA' : brand === 'mastercard' ? 'MC' : ''}</span>
              </span>
            </label>
            <div className="field-row">
              <label className="field">
                Срок
                <input inputMode="numeric" autoComplete="cc-exp" placeholder="ММ/ГГ" value={exp} onChange={(e) => setExp(formatExp(e.target.value))} />
              </label>
              <label className="field">
                CVC
                <input inputMode="numeric" autoComplete="cc-csc" placeholder="123" maxLength={4} value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, ''))} />
              </label>
            </div>
            <label className="field">
              Имя на карте
              <input autoComplete="cc-name" placeholder="IVAN IVANOV" required value={name} onChange={(e) => setName(e.target.value.toUpperCase())} />
            </label>
            <div className="test-cards">
              <span>Нажми, чтобы подставить тестовые данные (срок 12/29, CVC 123):</span>
              <button type="button" className="btn small" onClick={() => (setCard(TEST_CARD), setExp('12/29'), setCvc('123'), setError(''))}>
                {TEST_CARD} · успех
              </button>
              <button type="button" className="btn small" onClick={() => (setCard(TEST_CARD_DECLINED), setExp('12/29'), setCvc('123'), setError(''))}>
                {TEST_CARD_DECLINED} · отказ банка
              </button>
              <span>Реальные карты не принимаются.</span>
            </div>
            {error && <p className="error">{error}</p>}
            <div className="row">
              <button className="btn primary">Оплатить {PRO_PRICE_KZT} ₸</button>
              <button type="button" className="btn ghost" onClick={onClose}>
                Отмена
              </button>
            </div>
            <p className="muted small">🔒 Данные карты проверяются на сервере и не сохраняются: остаются только последние 4 цифры.</p>
          </form>
        )}
      </div>
    </div>
  );
}
