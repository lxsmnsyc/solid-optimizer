import { describe, expect, it } from 'vitest';
import { nameNamespaceTags } from '../src/vite/namespace';

describe('nameNamespaceTags', () => {
  it('imports each member a JSX tag reads by name', () => {
    const result = nameNamespaceTags(
      `import * as Button from '@kobalte/core/button';
export const A = (props) => <Button.Root class="a">{props.children}</Button.Root>;
export const B = () => <Button.Root />;
export const value = Button.Root;`,
      'a.jsx',
    );
    expect(result?.code).toContain(`import { Root as Button$Root } from "@kobalte/core/button";`);
    expect(result?.code).toContain('<Button$Root class="a">{props.children}</Button$Root>');
    expect(result?.code).toContain('<Button$Root />');
    // Code outside JSX resolves its member when bundled.
    expect(result?.code).toContain('export const value = Button.Root;');
  });

  it('picks a name nothing else uses', () => {
    const result = nameNamespaceTags(
      `import * as Button from 'lib';
const Button$Root = 1;
export const A = () => <Button.Root />;`,
      'a.jsx',
    );
    expect(result?.code).toContain('import { Root as Button$Root$1 } from "lib";');
  });

  it('leaves modules without namespace tags alone', () => {
    expect(nameNamespaceTags(`import * as lib from 'lib'; lib.run();`, 'a.jsx')).toBeUndefined();
    expect(
      nameNamespaceTags(`import type * as T from 'lib'; export const A = () => <p />;`, 'a.tsx'),
    ).toBeUndefined();
  });
});
