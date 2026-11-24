import type { JSX } from '@solidjs/web';
import { Icon } from '../components/Icon';
import { Footer, Header } from '../components/Layout';

/** Banig's NotFound: one ink tile with the code, a title, one sentence and two ways forward. */
export function NotFound(): JSX.Element {
  return (
    <>
      <Header page="not-found" />
      <main id="main" class="not-found">
        <span class="not-found-code">404</span>
        <h1>Page not found</h1>
        <p>The link may be old, or the page has moved. The docs list every page.</p>
        <div class="hero-actions">
          <a class="button" data-variant="primary" href="/docs/">
            Open the docs
            <Icon name="arrow-right" class="icon-arrow" />
          </a>
          <a class="button" data-variant="quiet" href="/">
            Go to the home page
          </a>
        </div>
      </main>
      <Footer />
    </>
  );
}
