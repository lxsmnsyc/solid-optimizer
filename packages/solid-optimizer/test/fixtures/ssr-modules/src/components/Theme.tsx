import type { JSX } from 'solid-js';
import { createContext, useContext } from 'solid-js';

const Theme = createContext<string>();

export function ThemeProvider(props: { theme: string; children: JSX.Element }) {
  return <Theme.Provider value={props.theme}>{props.children}</Theme.Provider>;
}

export function Themed() {
  const theme = useContext(Theme);
  return <p class={theme}>themed</p>;
}
