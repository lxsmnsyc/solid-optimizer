import { createSignal } from 'solid-js';
import { Avatar } from '../../../examples/demo/src/components/Avatar';
import { Banner } from '../../../examples/demo/src/components/Banner';
import { NavLink } from '../../../examples/demo/src/components/NavLink';
import About from '../../../examples/demo/src/pages/About';
import { Home } from '../../../examples/demo/src/pages/Home';
import Settings from '../../../examples/demo/src/pages/Settings';
import { Dashboard } from './Dashboard';

// The demo with every page rendered at once and none of them lazy, so one
// render creates all of the demo's components.
export function App() {
  const [page, setPage] = createSignal('home');
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
      </nav>
      <Banner />
      <Home />
      <About />
      <Dashboard />
      <Settings />
    </main>
  );
}
