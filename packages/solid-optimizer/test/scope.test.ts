import { describe, expect, it } from 'vitest';
import { parse } from '../src/ast';
import type { Binding } from '../src/scope';
import { analyzeScopes } from '../src/scope';

/** Every binding named `name` in `code`, in declaration order. */
function bindingsNamed(code: string, name: string): Binding[] {
  const analysis = analyzeScopes(parse('input.tsx', code));
  const found = new Set<Binding>();
  for (const binding of analysis.references.values()) {
    if (binding?.name === name) {
      found.add(binding);
    }
  }
  for (const scope of analysis.scopes.values()) {
    const binding = scope.bindings.get(name);
    if (binding) {
      found.add(binding);
    }
  }
  return [...found];
}

describe('parameter scope', () => {
  it('resolves a default outside the body', () => {
    const bindings = bindingsNamed(
      'const x = 1;\nfunction f(a = x) {\n  const x = 2;\n  return x;\n}',
      'x',
    );
    const outer = bindings.at(0);
    const inner = bindings.at(1);
    // The default and the body each read their own `x`.
    expect(outer?.references).toHaveLength(1);
    expect(inner?.references).toHaveLength(1);
    expect(outer?.scope).not.toBe(inner?.scope);
  });

  it('keeps a body var named like a parameter as the parameter', () => {
    const bindings = bindingsNamed('function f(a = 1, b = a) {\n  var a;\n  return a;\n}', 'a');
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.kind).toBe('param');
    expect(bindings[0]?.mutated).toBe(true);
  });

  it('shares one scope when no parameter holds an expression', () => {
    const bindings = bindingsNamed('function f(a) {\n  var a;\n  return a;\n}', 'a');
    expect(bindings).toHaveLength(1);
  });
});
