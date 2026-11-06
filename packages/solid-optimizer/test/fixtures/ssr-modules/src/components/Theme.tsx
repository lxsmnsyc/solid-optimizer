import type { JSX } from '@solidjs/web';
import { createContext, useContext } from 'solid-js';

const Theme = createContext<string>();

export function ThemeProvider(props: { theme: string; children: JSX.Element }) {
  return <Theme value={props.theme}>{props.children}</Theme>;
}

export function Themed() {
  const theme = useContext(Theme);
  return <p class={theme}>themed</p>;
}
