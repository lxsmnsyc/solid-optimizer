/**
 * The tidy step: empty braces go, strings in braces become plain JSX, and a
 * fragment around one element goes. Each case also checks that Solid's JSX
 * transform lowers the tidied output to the same code as the untidied one.
 */
import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import { cleanText } from '../src/tidy';
import { lower, optimize } from './utils';

/** The output without its import lines, and the same output untidied, lowered both ways. */
function tidyAndCheck(code: string): string {
  const tidied = optimize(code);
  const untidied = optimize(code, { tidy: false });
  for (const generate of ['dom', 'ssr'] as const) {
    expect(lower(tidied, generate), `lowered for ${generate}`).toBe(lower(untidied, generate));
  }
  return tidied;
}

describe('cleanText', () => {
  // Each pair is a text and what Solid's JSX transform writes into the template for it.
  const MEASURED: [string, string][] = [
    ['a  b', 'a b'],
    [' a ', ' a '],
    ['  ', ' '],
    ['a \n b', 'a b'],
    ['\n  a  \n  b  \n', 'a b '],
    ['a\t\tb', 'a b'],
    ['\n \n a', 'a'],
    ['a \n', 'a '],
    [' \n a', 'a'],
    ['x\n\n\ny', 'x y'],
    ['  a\n', ' a'],
    ['\ta', ' a'],
    ['\n  Add\n  ', 'Add'],
  ];

  it('cleans a text the way Solid does', () => {
    for (const [raw, clean] of MEASURED) {
      expect(cleanText(raw), JSON.stringify(raw)).toBe(clean);
    }
  });

  it('matches what Solid writes into the template', () => {
    for (const [raw, clean] of MEASURED) {
      const lowered = lower(`export const v = <p><b />${raw}<i /></p>;`);
      expect(/<p><b><\/b>([\s\S]*?)<i>/.exec(lowered)?.[1], JSON.stringify(raw)).toBe(clean);
    }
  });
});

describe('empty braces', () => {
  it('drops the braces an inlined component leaves around its children', () => {
    const code = tidyAndCheck(`function Icon(props) {
  return <span class={\`icon icon-\${props.name}\`} />;
}

function Button(props) {
  return (
    <button type="button">
      <Icon name={props.icon} />
      {props.children}
    </button>
  );
}

export const v = (
  <p>
    <Button icon="plus">
      Add
    </Button>
  </p>
);`);
    expect(code).not.toContain('{}');
    expect(code).toContain('<span class="icon icon-plus" />');
  });

  it('keeps braces whose removal would join two runs of spaces', () => {
    // `{0} {} ` renders two spaces; without the braces, Solid writes one.
    expect(
      tidyAndCheck(
        "import { For, Show } from 'solid-js';\nfunction Badge(props) {\n  return <span class={props.tone}><For each={[0]}>{(item) => <i>{item}<For each={[0]}>{(item) => <i>{item}<Show when={props.tone}><Show when={props.tone}> </Show> </Show></i>}</For></i>}</For></span>;\n}\nexport function App() { return <div><Badge tone={0.5} /></div>; }",
      ),
    ).toContain('{0} {} </i>');
  });

  it('keeps braces that keep two texts apart', () => {
    // Without them, the line break would join the texts with a space.
    expect(tidyAndCheck('export const v = <span><><>a</></>\n  x\n  </span>;')).toContain('a{}');
  });
});

describe('strings in braces', () => {
  it('writes a folded attribute in quotes', () => {
    expect(
      tidyAndCheck(
        // oxlint-disable-next-line no-template-curly-in-string -- the code under test holds a template literal
        "const T = 'dark';\nexport const v = <p class={`card card-${T}`} title={T}>x</p>;",
      ),
    ).toContain('<p class="card card-dark" title="dark">x</p>');
  });

  it('writes an inlined string prop as text', () => {
    expect(
      tidyAndCheck(
        'function Title(props) { return <h1>{props.label}</h1>; }\nexport const v = <main><Title label="Hello" /></main>;',
      ),
    ).toContain('<main><h1>Hello</h1></main>');
  });

  it('keeps a string that JSX would read differently', () => {
    const code = tidyAndCheck(
      "const A = 'a & b';\nconst Q = 'say \"hi\"';\nconst S = ' x ';\nexport const v = <p title={Q}>{A}<b>{S}</b></p>;",
    );
    // `&` starts an entity in JSX, and a quote would end the attribute.
    expect(code).toContain('title={"say \\"hi\\""}');
    expect(code).toContain('{"a & b"}');
    // Spaces at the ends of a text next to a line break would be dropped.
    expect(code).toContain('{" x "}');
  });

  it('keeps a string apart from the text beside it in a fragment', () => {
    // In a fragment each text stays its own string, so joining them would change the output.
    expect(
      tidyAndCheck(
        "const B = 'b';\nexport const v = (on) => <div>{on() ? <>a{B}</> : null}</div>;",
      ),
    ).toContain('<>a{"b"}</>');
  });
});

describe('fragments', () => {
  it('unwraps a lowered <Show> branch that holds one element', () => {
    const code = tidyAndCheck(
      'import { Show } from \'solid-js\';\nexport const v = (on) => <Show when={on()} fallback={<p>No</p>}><p class="b">Yes</p></Show>;',
    );
    expect(code).toContain('? <p class="b">Yes</p> :');
    expect(code).not.toContain('<><p');
  });

  it('keeps a fragment whose space is text', () => {
    // `<> <b>x</b></>` renders a space before the element.
    expect(
      tidyAndCheck(
        "import { Show } from 'solid-js';\nexport const v = (on) => <div><Show when={on()}> <b>x</b></Show></div>;",
      ),
    ).toContain('<> <b>x</b></>');
  });
});

describe('when it runs', () => {
  it('leaves a module the passes did not change as it was', () => {
    const code = "export const v = <p class={'x'}>{'y'}{}</p>;";
    expect(optimize(code)).toBe(code);
  });

  it('can be turned off', () => {
    expect(
      optimize("const T = 'dark';\nexport const v = <p class={T}>x</p>;", { tidy: false }),
    ).toContain('class={"dark"}');
  });
});

describe('what the review found', () => {
  it('keeps a fragment outside a branch, where Solid lowers it differently', () => {
    expect(
      tidyAndCheck(
        'const F = true;\nexport function f(x) { return <>{F}<b>{x()}</b></>; }\nexport const g = (x) => <div>{<><b>{x()}</b></>}</div>;',
      ),
    ).toContain('{<><b>{x()}</b></>}');
  });

  it('unwraps a fragment that is a branch, with dynamic content, a spread or a ref', () => {
    const code = tidyAndCheck(
      'const F = true;\nexport const v = (c, x, a, r) => <div>{F}{c() ? <><b>{x()}</b></> : null}{c() && <><i {...a} /></>}{c() || <><u ref={r} /></>}</div>;',
    );
    expect(code).toContain('? <b>{x()}</b> :');
    expect(code).toContain('&& <i {...a} />');
    expect(code).toContain('|| <u ref={r} />');
  });

  it('keeps strings with whitespace Solid and JavaScript read differently', () => {
    const code = tidyAndCheck(
      "const N = '\\u0085';\nconst B = '\\uFEFF';\nconst S = '\\u00A0';\nexport const v = <p title={N}>{N}x{B}<b>{S}</b></p>;",
    );
    expect(code).not.toContain('<p title="');
  });

  it('keeps a fragment whose text is a byte order mark', () => {
    tidyAndCheck(
      'const F = true;\nexport const v = (c) => <div>{F}{c() ? <>\uFEFF\n<b /></> : null}</div>;',
    );
  });

  it('keeps a static style in braces, which Solid would move last', () => {
    expect(
      tidyAndCheck(
        "const C = 'color:red';\nexport const v = <p style={C} id={'x'} class={'c'} />;",
      ),
    ).toContain('style={"color:red"} id="x" class="c"');
  });

  it('keeps a comment beside a string', () => {
    expect(tidyAndCheck("const A = 'a';\nexport const v = <p>{A}{/* note */ 'b'}</p>;")).toContain(
      "/* note */ 'b'",
    );
  });
});

describe('any string', () => {
  // Strings of any characters, in each place a string can sit, tidy to the same lowered code.
  const SHAPES = [
    (value: string) => `export const v = <p>{V}</p>;`.replace('V', value),
    (value: string) => `export const v = <p>a{V}b</p>;`.replace('V', value),
    (value: string) => `export const v = <p title={V} />;`.replace('V', value),
    (value: string) => `export const v = <p>\n  {V}\n  <b />\n</p>;`.replace('V', value),
    (value: string) =>
      `export const v = (c) => <p>{c() ? <>{V}</> : null}</p>;`.replace('V', value),
    (value: string) => `export const v = <C>{V}x</C>;`.replace('V', value),
    (value: string) => `export const v = <p>{V}{}{V}</p>;`.replaceAll('V', value),
    (value: string) => `export const v = <p> {V} </p>;`.replace('V', value),
  ];

  it.prop([
    fc.string({ unit: 'binary', maxLength: 6 }),
    fc.integer({ min: 0, max: SHAPES.length - 1 }),
  ])('tidies to the same lowered code', (value, shape) => {
    // A folded constant makes the module change, so the tidy step runs.
    const code = `const V = ${JSON.stringify(value)};\n${SHAPES[shape]('V')}`;
    tidyAndCheck(code);
  });
});

describe('what the second review found', () => {
  it('keeps the children of an element that has a children attribute or a spread', () => {
    // An empty `{}` child overrides a `children` attribute, so it has to stay.
    const code = tidyAndCheck(
      "const K = 1;\nexport const a = <b>{K}</b>;\nexport const v = <p children={'x'}>{}</p>;\nexport const w = (s) => <p {...s}>{}</p>;\nexport const c = <C children={K}>{}</C>;",
    );
    expect(code).toContain('<p children="x">{}</p>');
    expect(code).toContain('<p {...s}>{}</p>');
  });

  it('keeps any attribute that starts with on in braces', () => {
    expect(
      tidyAndCheck("const H = 'go()';\nexport const v = <p onclick={H} title={H} />;"),
    ).toContain('onclick={"go()"} title="go()"');
  });
});
