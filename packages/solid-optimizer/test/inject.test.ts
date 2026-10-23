import { describe, expect, it } from 'vitest';
import { exposeLocals, readExportedComponent } from '../src/vite/inject';

const SOURCES = ['solid-js', '@solidjs/web'];

describe('exposeLocals', () => {
  it('exports the local bindings exported components refer to', () => {
    const result = exposeLocals(
      `import { Icon } from './Icon';
const PREFIX = 'x-';
const Theme = createContext();
const unused = 1;
export function Badge(props) {
  return <span class={PREFIX + props.tone}><Icon /></span>;
}
export const Panel = () => <Theme value="dark"><p /></Theme>;
function Private() { return <i>{unused}</i>; }`,
      'a.jsx',
    );
    expect(result?.code).toContain(
      'export { PREFIX as __so_local$PREFIX, Theme as __so_local$Theme };',
    );
  });

  it('adds nothing when the components need no local binding', () => {
    expect(exposeLocals('export const A = () => <p />;', 'a.jsx')).toBeUndefined();
  });
});

describe('readExportedComponent', () => {
  const code = `import { createContext, useContext } from 'solid-js';
import { Icon as Glyph } from './Icon';
const Theme = createContext();
export function Badge(props) {
  __SOLID_OPTIMIZER_KEEP__({ "helper:template": t });
  const theme = useContext(Theme);
  return <span class={theme}><Glyph name={props.icon} /></span>;
}
export { Theme as __so_local$Theme };
export default () => <p />;`;

  it('lists the bindings a component needs from its module', () => {
    const component = readExportedComponent(code, 'a.jsx', 'Badge', SOURCES);
    expect(Object.fromEntries(component?.dependencies ?? [])).toEqual({
      useContext: { kind: 'import', source: 'solid-js', imported: 'useContext' },
      Theme: { kind: 'export', exported: '__so_local$Theme', context: true },
      Glyph: { kind: 'import', source: './Icon', imported: 'Icon' },
    });
  });

  it('copies the component under a new name without its marker', () => {
    const component = readExportedComponent(code, 'a.jsx', 'Badge', SOURCES);
    const copy = component?.copy(
      'Badge$1',
      new Map([
        ['useContext', 'useContext$1'],
        ['Theme', 'Theme$1'],
        ['Glyph', 'Icon$1'],
      ]),
    );
    expect(copy).not.toContain('__SOLID_OPTIMIZER_KEEP__');
    expect(copy).toContain('function Badge$1(props)');
    expect(copy).toContain('const theme = useContext$1(Theme$1);');
    expect(copy).toContain('<Icon$1 name={props.icon} />');
  });

  it('skips a component that needs a binding its module does not export', () => {
    expect(
      readExportedComponent(
        `const PREFIX = 'x';\nexport const A = () => <p class={PREFIX} />;`,
        'a.jsx',
        'A',
        SOURCES,
      ),
    ).toBeUndefined();
  });

  it('skips an export that is not a function', () => {
    expect(readExportedComponent('export const A = 1;', 'a.jsx', 'A', SOURCES)).toBeUndefined();
  });

  it('tells whether a component only wraps another component of its module', () => {
    const icons = `import { createContext } from 'solid-js';
import { Glyph } from './Glyph';
const Icon = (props) => <svg {...props} />;
export function IconBell(props) {
  return <Icon {...props}><path d="M1 1" /></Icon>;
}
export const IconStar = (props) => <Glyph {...props} />;
export const Panel = () => <section><Icon /></section>;
const Theme = createContext();
export const ThemeProvider = (props) => <Theme value={props.theme}>{props.children}</Theme>;
export { Icon as __so_local$Icon, Theme as __so_local$Theme };`;
    const wraps = (name: string): boolean | undefined =>
      readExportedComponent(icons, 'icons.jsx', name, SOURCES)?.wrapsLocal;
    expect(wraps('IconBell')).toBe(true);
    // An imported component's copy can still inline it.
    expect(wraps('IconStar')).toBe(false);
    expect(wraps('Panel')).toBe(false);
    // The provider pass can remove a provider from the copy.
    expect(wraps('ThemeProvider')).toBe(false);
  });
});
