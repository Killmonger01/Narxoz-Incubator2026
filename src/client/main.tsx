import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { navigate, useRoute } from './router.ts';
import { refreshMe, useUser } from './api.ts';
import { useRoomInMatch } from './chrome.ts';
import { Home, BotSetup, HotseatSetup, OnlineSetup, Rules } from './screens/Menu.tsx';
import { Challenges, Leaderboard, Login, Profile } from './screens/Account.tsx';
import { Settings, Shop } from './screens/Shop.tsx';
import { LocalGame, type LocalMode } from './game/LocalGame.tsx';
import { OnlineGame } from './game/OnlineGame.tsx';
import { Tutorial } from './game/Tutorial.tsx';

function Nav() {
  const user = useUser();
  const { path } = useRoute();
  const link = (to: string, label: string) => (
    <a className={`${to === '/login' || to === '/profile' ? 'outline' : ''} ${path === to ? 'on' : ''}`} onClick={() => navigate(to)}>
      {label}
    </a>
  );
  return (
    <header className="poster-nav">
      <a className="poster-brand" onClick={() => navigate('/')}>
        Тянем‑Потянем
      </a>
      <nav>
        {link('/rules', 'Правила')}
        {link('/leaderboard', 'Рейтинг')}
        {link('/shop', 'Pro')}
        {link('/settings', 'Настройки')}
        {user ? link('/profile', user.username) : link('/login', 'Войти')}
      </nav>
    </header>
  );
}

const KNOWN = new Set(['/game', '/tutorial', '/play/bot', '/play/hotseat', '/online', '/rules', '/challenges', '/profile', '/leaderboard', '/shop', '/settings', '/login']);

function App() {
  const { path, state } = useRoute();
  const roomInMatch = useRoomInMatch();
  useEffect(() => {
    refreshMe();
  }, []);

  const room = path.match(/^\/r\/([A-Za-z0-9]{5})$/);
  const inGame = path === '/game' || path === '/tutorial' || (room && roomInMatch);
  const poster = path === '/' || (!room && !inGame && !KNOWN.has(path));
  let page: React.ReactNode;
  if (room) {
    const watch = new URLSearchParams(location.search).get('watch') === '1';
    page = <OnlineGame key={room[1]} code={room[1].toUpperCase()} watch={watch} />;
  } else
    switch (path) {
      case '/game':
        page = state?.kind ? <LocalGame key={JSON.stringify(state)} mode={state as LocalMode} /> : <Home />;
        break;
      case '/tutorial':
        page = <Tutorial />;
        break;
      case '/play/bot':
        page = <BotSetup />;
        break;
      case '/play/hotseat':
        page = <HotseatSetup />;
        break;
      case '/online':
        page = <OnlineSetup />;
        break;
      case '/rules':
        page = <Rules />;
        break;
      case '/challenges':
        page = <Challenges />;
        break;
      case '/profile':
        page = <Profile />;
        break;
      case '/leaderboard':
        page = <Leaderboard />;
        break;
      case '/shop':
        page = <Shop />;
        break;
      case '/settings':
        page = <Settings />;
        break;
      case '/login':
        page = <Login />;
        break;
      default:
        page = <Home />;
    }
  return (
    <div className={`app ${inGame ? 'in-game' : 'shell'}`}>
      {!inGame && !poster && <Nav />}
      <main>{page}</main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
