import { describe, expect, it } from 'vitest';
import { optimize } from './utils';

function server(code: string): string {
  return optimize(code, { server: true, fold: false, inline: false, memos: false });
}

/**
 * The ways a module can refer to a Solid export, as a callee and its import.
 */
function importForms(name: string): { callee: string; header: string }[] {
  return [
    { callee: name, header: `import { ${name} } from 'solid-js';` },
    { callee: 'x', header: `import { ${name} as x } from 'solid-js';` },
    { callee: 'x', header: `import { '${name}' as x } from 'solid-js';` },
    { callee: `solid.${name}`, header: "import * as solid from 'solid-js';" },
  ];
}

function each(name: string, body: (callee: string) => string, expected: string): void {
  for (const { callee, header } of importForms(name)) {
    expect(server(`${header}\n${body(callee)}`)).toBe(`${header}\n${expected}`);
  }
}

describe('server pass', () => {
  it('only runs for the server', () => {
    const code = "import { createEffect } from 'solid-js';\ncreateEffect(() => update());";
    expect(optimize(code, { fold: false, inline: false, memos: false })).toBe(code);
  });

  it('removes createEffect and onMount', () => {
    each('createEffect', (callee) => `${callee}(() => update());`, '');
    each('onMount', (callee) => `${callee}(() => {\n  update();\n});`, '');
    each('createEffect', (callee) => `${callee}((prev) => update(prev), 0);`, '');
  });

  it('removes an effect built with on()', () => {
    const code =
      "import { createEffect, on } from 'solid-js';\ncreateEffect(on(count, (value) => log(value)));";
    expect(server(code)).toBe("import { createEffect, on } from 'solid-js';\n");
  });

  it('keeps an effect whose arguments do something', () => {
    const code = "import { createEffect } from 'solid-js';\ncreateEffect(makeEffect());";
    expect(server(code)).toBe(code);
  });

  it('leaves an empty statement where a statement is required', () => {
    expect(server("import { onMount } from 'solid-js';\nif (ready) onMount(() => update());")).toBe(
      "import { onMount } from 'solid-js';\nif (ready) ;",
    );
  });

  it('turns a removed call used as a value into undefined', () => {
    expect(
      server("import { createEffect } from 'solid-js';\nconst x = createEffect(() => 1);"),
    ).toBe("import { createEffect } from 'solid-js';\nconst x = void 0;");
  });

  it('runs untrack and batch in place', () => {
    for (const name of ['untrack', 'batch']) {
      each(name, (callee) => `${callee}(() => update());`, 'update();');
      each(name, (callee) => `${callee}(() => {\n  update();\n});`, '(() => {\n  update();\n})();');
      each(
        name,
        (callee) => `${callee}(function () {\n  update();\n});`,
        '(function () {\n  update();\n})();',
      );
      each(name, (callee) => `${callee}(read);`, 'read();');
      each(
        name,
        (callee) => `const value = ${callee}(() => a() + b());`,
        'const value = a() + b();',
      );
    }
  });

  it('calls a method without its object as this', () => {
    expect(server("import { untrack } from 'solid-js';\nuntrack(store.read);")).toBe(
      "import { untrack } from 'solid-js';\n(0, store.read)();",
    );
  });

  it('leaves spread arguments alone', () => {
    for (const name of ['untrack', 'batch', 'createDeferred', 'startTransition', 'createEffect']) {
      const code = `import { ${name} } from 'solid-js';\n${name}(...example);`;
      expect(server(code)).toBe(code);
    }
  });

  it('runs startTransition and returns nothing', () => {
    each('startTransition', (callee) => `${callee}(() => update());`, 'update();');
    each(
      'startTransition',
      (callee) => `const done = ${callee}(() => update());`,
      'const done = (update(), void 0);',
    );
  });

  it('returns the source of createDeferred', () => {
    each(
      'createDeferred',
      (callee) => `const deferred = ${callee}(() => update());`,
      'const deferred = () => update();',
    );
    each(
      'createDeferred',
      (callee) => `const deferred = ${callee}(source, { timeoutMs: 100 });`,
      'const deferred = source;',
    );
  });

  it('turns getListener into null', () => {
    each('getListener', (callee) => `const listener = ${callee}();`, 'const listener = null;');
  });

  it('runs a memo once', () => {
    each(
      'createMemo',
      (callee) => `const double = ${callee}(() => count() * 2);`,
      'const double = ((value) => () => value)(count() * 2);',
    );
    each(
      'createMemo',
      (callee) => `const total = ${callee}((prev) => prev + 1, 0, { equals: false });`,
      'const total = ((value) => () => value)(((prev) => prev + 1)(0));',
    );
  });

  it('runs render effects once', () => {
    each(
      'createRenderEffect',
      (callee) => `${callee}(() => setTitle(title()));`,
      'setTitle(title());',
    );
    each(
      'createComputed',
      (callee) => `${callee}((prev) => track(prev), 0);`,
      '((prev) => track(prev))(0);',
    );
  });

  it('keeps calls to other modules', () => {
    const code = "import { createEffect } from './effects';\ncreateEffect(() => update());";
    expect(server(code)).toBe(code);
  });

  it('keeps each rewrite valid inside another', () => {
    expect(
      server(
        "import { batch, untrack } from 'solid-js';\nconst value = batch(() => untrack(() => a()) + 1);",
      ),
    ).toBe("import { batch, untrack } from 'solid-js';\nconst value = a() + 1;");
  });
});

describe('server and client builds', () => {
  it('make the same inlining decisions', () => {
    // On the server `onMount` does nothing, which would leave `Widget` with no
    // statements. It still has to stay a component, as it does on the client.
    const code = `import { onMount, Show } from 'solid-js';
function Widget() {
  onMount(() => measure());
  return <canvas />;
}
export function App(props) {
  return <main><Show when={props.open}><Widget /></Show></main>;
}
`;
    const client = optimize(code);
    const serverCode = optimize(code, { server: true });
    expect(client).toContain('<Widget />');
    expect(serverCode).toContain('<Widget />');
    expect(serverCode).not.toContain('measure');
  });
});
