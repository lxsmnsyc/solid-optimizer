import { Dynamic } from '@solidjs/web';
import { Match, Show, Switch } from 'solid-js';
import { SHOW_BANNER, THEME } from '../config';

// Control flow that constants decide. It folds away, and what is left joins the template.
export function Banner() {
  return (
    <Show when={SHOW_BANNER}>
      {/* `<Dynamic>` is deprecated in favor of `dynamic()`, but only `<Dynamic>` folds. */}
      {/* oxlint-disable-next-line typescript/no-deprecated */}
      <Dynamic component="aside" class="banner">
        <Switch fallback={<em>default theme</em>}>
          <Match when={THEME === 'dark'}>
            <em>dark theme</em>
          </Match>
          <Match when={THEME === 'light'}>
            <em>light theme</em>
          </Match>
        </Switch>
      </Dynamic>
    </Show>
  );
}
