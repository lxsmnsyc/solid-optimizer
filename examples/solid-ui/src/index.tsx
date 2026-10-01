/**
 * The entry this example adds: a router over the solid-ui example pages,
 * each loaded on its own.
 */
import { MetaProvider } from '@solidjs/meta';
import { A, Router } from '@solidjs/router';
import type { RouteDefinition } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { lazy } from 'solid-js';
import { render } from 'solid-js/web';

const routes: RouteDefinition[] = [
  { path: '/', component: lazy(() => import('./routes/(app)/examples/cards')) },
  { path: '/dashboard', component: lazy(() => import('./routes/(app)/examples/dashboard')) },
  { path: '/mail', component: lazy(() => import('./routes/(app)/examples/mail')) },
  { path: '/tasks', component: lazy(() => import('./routes/(app)/examples/tasks')) },
  {
    path: '/authentication',
    component: lazy(() => import('./routes/(app)/examples/authentication')),
  },
];

function Layout(props: { children?: JSX.Element }) {
  return (
    <MetaProvider>
      <nav class="examples-nav">
        <A href="/">Cards</A>
        <A href="/dashboard">Dashboard</A>
        <A href="/mail">Mail</A>
        <A href="/tasks">Tasks</A>
        <A href="/authentication">Authentication</A>
      </nav>
      <main>{props.children}</main>
    </MetaProvider>
  );
}

const root = document.querySelector('#root');
if (root) {
  render(() => <Router root={Layout}>{routes}</Router>, root);
}
