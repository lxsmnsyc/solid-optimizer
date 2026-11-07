/**
 * Keeps every template valid HTML.
 *
 * Solid's JSX transform puts an element and the elements written inside it
 * into one HTML template. It rejects a template that a browser would parse
 * into another tree, such as `<p><div></div></p>`, which parses as
 * `<p></p><div></div><p></p>`. Before the passes, such an element is often
 * apart from the template: `<p><Box /></p>` inserts the `<div>` that `Box`
 * returns at runtime, which works. Inlining `Box`, resolving `<Show>`,
 * unrolling `<For>`, or resolving `<Dynamic>` puts the `<div>` into the
 * `<p>`'s template, and the build fails.
 *
 * This pass checks each template the way Solid does: it parses the
 * template's tags as the body's `innerHTML` and compares the result. When
 * the tree changes, the element that changes it is wrapped in `{}`. An
 * element in an expression container starts its own template and is
 * inserted at runtime, as it was before the pass.
 */
import type { JSXChild, JSXElement, Node } from 'oxc-parser';
import type { DefaultTreeAdapterMap } from 'parse5';
import { parseFragment, parse as parseHTML, serialize } from 'parse5';
import { forEachChild, isIntrinsicTag } from './ast';
import type { PassContext } from './context';

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

// Solid's list of SVG tags, from dom-expressions. `a`, `script`, `style`, and
// `title` are in both namespaces, so a template rooted at one is HTML.
const SVG_ELEMENTS = new Set([
  'altGlyph',
  'altGlyphDef',
  'altGlyphItem',
  'animate',
  'animateColor',
  'animateMotion',
  'animateTransform',
  'circle',
  'clipPath',
  'cursor',
  'defs',
  'desc',
  'ellipse',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
  'filter',
  'font',
  'foreignObject',
  'g',
  'glyph',
  'glyphRef',
  'hkern',
  'image',
  'line',
  'linearGradient',
  'marker',
  'mask',
  'metadata',
  'mpath',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'radialGradient',
  'rect',
  'set',
  'stop',
  'switch',
  'symbol',
  'text',
  'textPath',
  'tref',
  'tspan',
  'use',
  'view',
  'vkern',
]);

type ParentNode = DefaultTreeAdapterMap['parentNode'];

function findElement(parent: ParentNode, name: string): ParentNode {
  for (const child of parent.childNodes) {
    if (child.nodeName === name && 'childNodes' in child) {
      return child;
    }
  }
  throw new Error(`[solid-optimizer] no <${name}> in an empty document`);
}

let body: ParentNode | undefined;

/** What a browser makes of `html` set as the body's `innerHTML`. */
function parseAsBody(html: string): string {
  body ??= findElement(
    findElement(parseHTML('<!DOCTYPE html><html><body></body></html>'), 'html'),
    'body',
  );
  return serialize(parseFragment(body, html, {}));
}

/** The tag of an intrinsic element, or `undefined` for a component or a namespaced tag. */
function readIntrinsicTag(element: JSXElement): string | undefined {
  const name = element.openingElement.name;
  return name.type === 'JSXIdentifier' && isIntrinsicTag(name.name) ? name.name : undefined;
}

/** A template element and the elements in the same template. */
interface TemplateNode {
  readonly element: JSXElement;
  readonly tag: string;
  readonly children: TemplateNode[];
}

/**
 * The template rooted at `element`. Elements inside fragments join it.
 * Elements in expression containers or under a component start their own.
 */
function collectTemplate(element: JSXElement, tag: string): TemplateNode {
  const node: TemplateNode = { element, tag, children: [] };
  addTemplateChildren(node, element.children);
  return node;
}

function addTemplateChildren(node: TemplateNode, children: readonly JSXChild[]): void {
  for (const child of children) {
    if (child.type === 'JSXFragment') {
      addTemplateChildren(node, child.children);
    } else if (child.type === 'JSXElement') {
      const tag = readIntrinsicTag(child);
      if (tag !== undefined) {
        node.children.push(collectTemplate(child, tag));
      }
    }
  }
}

/**
 * The tags of a template, without text or attributes. Elements not in
 * `included` are left out with what they hold.
 */
function writeTags(node: TemplateNode, included: ReadonlySet<TemplateNode>): string {
  if (VOID_ELEMENTS.has(node.tag)) {
    return `<${node.tag}>`;
  }
  let inner = '';
  for (const child of node.children) {
    if (included.has(child)) {
      inner += writeTags(child, included);
    }
  }
  return `<${node.tag}>${inner}</${node.tag}>`;
}

/**
 * Table parts parse only inside a table, and SVG parts only inside an
 * `<svg>`, so a template rooted at one is checked inside one, as Solid
 * creates it.
 */
function placeInContext(tag: string, html: string): string {
  if (SVG_ELEMENTS.has(tag)) {
    return `<svg>${html}</svg>`;
  }
  switch (tag) {
    case 'td':
    case 'th':
      return `<table><tbody><tr>${html}</tr></tbody></table>`;
    case 'tr':
      return `<table><tbody>${html}</tbody></table>`;
    case 'col':
      return `<table><colgroup>${html}</colgroup></table>`;
    case 'thead':
    case 'tbody':
    case 'tfoot':
    case 'colgroup':
    case 'caption':
      return `<table>${html}</table>`;
    default:
      return html;
  }
}

/** Whether a `<template>` in the template holds an element, which Solid rejects. */
function hasTemplateContent(node: TemplateNode, included: ReadonlySet<TemplateNode>): boolean {
  for (const child of node.children) {
    if (included.has(child) && (node.tag === 'template' || hasTemplateContent(child, included))) {
      return true;
    }
  }
  return false;
}

function isValidTemplate(root: TemplateNode, included: ReadonlySet<TemplateNode>): boolean {
  if (hasTemplateContent(root, included)) {
    return false;
  }
  const html = placeInContext(root.tag, writeTags(root, included));
  return parseAsBody(html).toLowerCase() === html.toLowerCase();
}

function collectAll(node: TemplateNode, into: Set<TemplateNode>): Set<TemplateNode> {
  into.add(node);
  for (const child of node.children) {
    collectAll(child, into);
  }
  return into;
}

/**
 * Wraps the elements that make `root`'s template parse differently, and
 * returns the wrapped elements, each the root of a template of its own.
 */
function wrapInvalidElements(context: PassContext, root: TemplateNode): TemplateNode[] {
  if (isValidTemplate(root, collectAll(root, new Set()))) {
    return [];
  }
  // A template that is already wrong without its children is the source's own.
  const included = new Set([root]);
  if (!isValidTemplate(root, included)) {
    return [];
  }
  // Add the elements one at a time, in source order, and keep apart each one
  // that changes the parse. A kept-apart element takes what it holds along.
  const wrapped: TemplateNode[] = [];
  const pending: TemplateNode[] = [];
  pushChildren(pending, root);
  for (let node = pending.pop(); node; node = pending.pop()) {
    included.add(node);
    if (!isValidTemplate(root, included)) {
      included.delete(node);
      // Each brace sticks to its own element, so two wrapped neighbors read `}{`.
      context.s.prependRight(node.element.start, '{');
      context.s.appendLeft(node.element.end, '}');
      wrapped.push(node);
      continue;
    }
    pushChildren(pending, node);
  }
  return wrapped;
}

/** Pushes the children of `node` so that they pop in source order. */
function pushChildren(pending: TemplateNode[], node: TemplateNode): void {
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    pending.push(node.children[index]);
  }
}

export function repairNesting(context: PassContext): boolean {
  const roots: TemplateNode[] = [];
  const visit = (node: Node, inTemplate: boolean): void => {
    if (node.type === 'JSXElement') {
      const tag = readIntrinsicTag(node);
      if (tag !== undefined && !inTemplate) {
        roots.push(collectTemplate(node, tag));
      }
      // An intrinsic element's children join its template. A component's
      // children, an expression container, and an attribute value start over.
      for (const child of node.children) {
        visit(child, tag !== undefined);
      }
      for (const attribute of node.openingElement.attributes) {
        visit(attribute, false);
      }
      return;
    }
    if (node.type === 'JSXFragment') {
      for (const child of node.children) {
        visit(child, inTemplate);
      }
      return;
    }
    forEachChild(node, (child) => {
      visit(child, false);
    });
  };
  visit(context.program, false);

  let changed = false;
  for (let root = roots.pop(); root; root = roots.pop()) {
    const wrapped = wrapInvalidElements(context, root);
    if (wrapped.length > 0) {
      changed = true;
      roots.push(...wrapped);
    }
  }
  return changed;
}
