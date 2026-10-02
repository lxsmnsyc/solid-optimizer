/**
 * Rewrites JSX tags that read a member of a namespace import, like
 * `<Button.Root>` with `import * as Button from '...'`, to a named import.
 *
 * A bundler resolves `Button.Root` in code to the export it reads, and
 * drops the namespace. In a JSX tag name it does not, so a module that
 * keeps its JSX through bundling would make the bundle build a namespace
 * object with every export of the module.
 */
import MagicString from 'magic-string';
import { collectParents, parse } from '../ast';
import { analyzeScopes } from '../scope';
import type { EditResult } from './runtime';

export function nameNamespaceTags(code: string, filename: string): EditResult | undefined {
  const program = parse(filename, code);
  const scopes = analyzeScopes(program);
  const parents = collectParents(program);
  const s = new MagicString(code);
  const names = new Set(scopes.names);
  const imports: string[] = [];
  for (const binding of scopes.root.bindings.values()) {
    const statement = parents.get(binding.declaration);
    if (
      binding.kind !== 'import' ||
      binding.imported !== '*' ||
      binding.source === undefined ||
      statement?.type !== 'ImportDeclaration' ||
      statement.importKind === 'type'
    ) {
      continue;
    }
    // One local name for each member, shared by its opening and closing tags.
    const locals = new Map<string, string>();
    for (const reference of binding.references) {
      const member = parents.get(reference);
      if (
        reference.type !== 'JSXIdentifier' ||
        member?.type !== 'JSXMemberExpression' ||
        member.object !== reference
      ) {
        continue;
      }
      const { name } = member.property;
      let local = locals.get(name);
      if (local === undefined) {
        local = `${binding.name}$${name}`;
        for (let index = 1; names.has(local); index += 1) {
          local = `${binding.name}$${name}$${String(index)}`;
        }
        names.add(local);
        locals.set(name, local);
        imports.push(`import { ${name} as ${local} } from ${JSON.stringify(binding.source)};`);
      }
      s.overwrite(member.start, member.end, local);
    }
  }
  if (imports.length === 0) {
    return undefined;
  }
  s.prepend(`${imports.join('\n')}\n`);
  return {
    code: s.toString(),
    map: s.generateMap({ source: filename, hires: true, includeContent: true }).toString(),
  };
}
