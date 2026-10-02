import { Counter } from './components/Counter';
import { Even } from './components/Even';
import { ThemeProvider, Themed } from './components/Theme';
import { Title } from './components/Title';

export function App() {
  return (
    <main>
      <Title label="Hello" />
      <Counter initial={1} />
      <ThemeProvider theme="dark">
        <Themed />
      </ThemeProvider>
      <Even depth={2} />
    </main>
  );
}
