import { render } from '@solidjs/web';
import { Loading, Match, Switch, createSignal, lazy } from 'solid-js';
import { Avatar } from './components/Avatar';
import { Banner } from './components/Banner';
import { NavLink } from './components/NavLink';
import { Home } from './pages/Home';

const About = lazy(async () => import('./pages/About'));
const Dashboard = lazy(async () => import('./pages/Dashboard'));
const Settings = lazy(async () => import('./pages/Settings'));

type Page = 'home' | 'about' | 'dashboard' | 'settings';

function App() {
  const [page, setPage] = createSignal<Page>('home');
  return (
    <main>
      <header>
        <h1>solid-optimizer demo</h1>
        <Avatar name="Ada" />
      </header>
      <nav>
        <NavLink
          active={page() === 'home'}
          onSelect={() => {
            setPage('home');
          }}
        >
          Home
        </NavLink>
        <NavLink
          active={page() === 'about'}
          onSelect={() => {
            setPage('about');
          }}
        >
          About
        </NavLink>
        <NavLink
          active={page() === 'dashboard'}
          onSelect={() => {
            setPage('dashboard');
          }}
        >
          Dashboard
        </NavLink>
        <NavLink
          active={page() === 'settings'}
          onSelect={() => {
            setPage('settings');
          }}
        >
          Settings
        </NavLink>
      </nav>
      <Banner />
      <Loading fallback={<p>Loading…</p>}>
        <Switch fallback={<Home />}>
          <Match when={page() === 'about'}>
            <About />
          </Match>
          <Match when={page() === 'dashboard'}>
            <Dashboard />
          </Match>
          <Match when={page() === 'settings'}>
            <Settings />
          </Match>
        </Switch>
      </Loading>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
