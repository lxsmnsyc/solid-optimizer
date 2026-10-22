/**
 * Estimates how many bytes code takes once Solid's JSX transform has
 * lowered it and a minifier has compacted it.
 *
 * The inline pass compares the call sites of a component with the copies
 * that would replace them. A copy merges its elements into the template
 * around it and drops the component call, but repeats the component's own
 * code at every call. The estimate only has to rank the two, so it counts
 * what lowering adds to the JSX as written:
 *
 * - each template: its declaration and the clone that renders it;
 * - each dynamic attribute, child, spread, or event handler of an element:
 *   the effect or `insert` that sets it, and the walk to its element;
 * - each component element: the `createComponent` call, and a getter for
 *   each prop that is not a literal.
 *
 * Other code counts as its text without the whitespace a minifier removes.
 */
import type {
  Expression,
  JSXAttribute,
  JSXAttributeItem,
  JSXChild,
  JSXElement,
  JSXElementName,
  JSXEmptyExpression,
  JSXFragment,
  Node,
} from 'oxc-parser';
import { forEachChild, isInsignificant, isIntrinsicTag, unwrap } from './ast';

/** A template's declaration, and the function that clones and returns it. */
const TEMPLATE = 40;
/** A walk to an element, like `e.firstChild.nextSibling`. */
const WALK = 12;
/** An `insert()` of a dynamic child. */
const INSERT = 12;
/** A render effect that sets an attribute, like `createRenderEffect(() => setAttribute(...))`. */
const EFFECT = 24;
/** An event handler assignment, like `e.$$click = ...`. */
const HANDLER = 10;
/** A `spread()` of props onto an element. */
const SPREAD = 16;
/** A `createComponent(Name, {})` call. */
const COMPONENT = 8;
/** A getter, `get name() { return ... }`. */
const GETTER = 16;
/** A `mergeProps()` around the props of a component with a spread. */
const MERGE = 6;

/**
 * The length of `text` once a minifier removes the whitespace it does not need.
 */
export function compactLength(text: string): number {
  return text.replaceAll(/\s*([{}()[\];,:=<>+\-*/?&|!.])\s*/g, '$1').replaceAll(/\s+/g, ' ').length;
}

function nameLength(name: JSXElementName): number {
  switch (name.type) {
    case 'JSXIdentifier':
      return name.name.length;
    case 'JSXNamespacedName':
      return name.namespace.name.length + name.name.name.length + 1;
    case 'JSXMemberExpression':
      return nameLength(name.object) + name.property.name.length + 1;
    default:
      return 4;
  }
}

/** Whether an expression lowers to text in the template, like a literal. */
function isStaticText(node: Expression | JSXEmptyExpression): boolean {
  if (node.type === 'JSXEmptyExpression') {
    return false;
  }
  const inner = unwrap(node);
  if (inner.type === 'Literal') {
    return typeof inner.value === 'string' || typeof inner.value === 'number';
  }
  if (inner.type === 'TemplateLiteral') {
    return inner.expressions.length === 0;
  }
  return (
    inner.type === 'UnaryExpression' &&
    inner.operator === '-' &&
    inner.argument.type === 'Literal' &&
    typeof inner.argument.value === 'number'
  );
}

function isIntrinsic(element: JSXElement): boolean {
  const { name } = element.openingElement;
  return name.type === 'JSXIdentifier' && isIntrinsicTag(name.name);
}

function attributeName(attribute: JSXAttribute): string {
  const { name } = attribute;
  return name.type === 'JSXIdentifier' ? name.name : `${name.namespace.name}:${name.name.name}`;
}

/**
 * Estimates lowered sizes in one piece of code.
 */
export class SizeEstimator {
  constructor(private readonly code: string) {}

  private text(node: Node): number {
    return compactLength(this.code.slice(node.start, node.end));
  }

  /**
   * The size of any node: JSX as lowered, other code as its compact text
   * with the JSX in it as lowered.
   */
  node(node: Node): number {
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
      return this.jsx(node, false);
    }
    let size = this.text(node);
    const visit = (child: Node): void => {
      if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
        size += this.jsx(child, false) - this.text(child);
        return;
      }
      forEachChild(child, visit);
    };
    forEachChild(node, visit);
    return size;
  }

  /**
   * The size of a JSX element or fragment. `inTemplate` is whether it sits
   * directly in an element, whose template it joins.
   */
  jsx(node: JSXElement | JSXFragment, inTemplate: boolean): number {
    if (node.type === 'JSXFragment') {
      return this.children(node.children) + 2;
    }
    if (!isIntrinsic(node)) {
      return (inTemplate ? INSERT + WALK : 0) + this.component(node);
    }
    const tag = nameLength(node.openingElement.name);
    let size = (inTemplate ? 0 : TEMPLATE) + tag * 2 + 5;
    let dynamic = false;
    for (const attribute of node.openingElement.attributes) {
      const cost = this.elementAttribute(attribute);
      size += cost.size;
      dynamic ||= cost.dynamic;
    }
    for (const child of node.children) {
      if (isInsignificant(child)) {
        continue;
      }
      if (child.type === 'JSXText') {
        size += compactLength(child.value);
      } else if (child.type === 'JSXExpressionContainer' && isStaticText(child.expression)) {
        // A literal child is written into the template as text.
        size += this.text(child.expression);
      } else if (child.type === 'JSXElement') {
        size += this.jsx(child, true);
      } else {
        size += INSERT + this.child(child);
        dynamic = true;
      }
    }
    return size + (dynamic ? WALK : 0);
  }

  private elementAttribute(attribute: JSXAttributeItem): { size: number; dynamic: boolean } {
    if (attribute.type === 'JSXSpreadAttribute') {
      return { size: SPREAD + this.node(attribute.argument), dynamic: true };
    }
    const name = attributeName(attribute);
    const { value } = attribute;
    if (!value || value.type === 'Literal') {
      return { size: name.length + (value ? this.text(value) : 0) + 1, dynamic: false };
    }
    if (value.type !== 'JSXExpressionContainer') {
      return { size: name.length + 1 + this.jsx(value, false), dynamic: true };
    }
    const { expression } = value;
    if (expression.type === 'JSXEmptyExpression') {
      return { size: 0, dynamic: false };
    }
    const inner = unwrap(expression);
    // A literal in braces lowers like a quoted value.
    if (
      inner.type === 'Literal' ||
      (inner.type === 'TemplateLiteral' && inner.expressions.length === 0)
    ) {
      return { size: name.length + this.text(inner) + 1, dynamic: false };
    }
    const extra = /^on[A-Z:]/.test(name) || name === 'ref' ? HANDLER : EFFECT;
    return { size: extra + name.length + this.node(inner), dynamic: true };
  }

  private child(child: JSXChild): number {
    if (child.type === 'JSXExpressionContainer') {
      return child.expression.type === 'JSXEmptyExpression' ? 0 : this.node(child.expression);
    }
    if (child.type === 'JSXSpreadChild') {
      return this.node(child.expression);
    }
    if (child.type === 'JSXText') {
      return compactLength(child.value) + 2;
    }
    return this.jsx(child, false);
  }

  /**
   * Children outside a template, which lower to an array of values.
   */
  private children(children: readonly JSXChild[]): number {
    let size = 0;
    for (const child of children) {
      if (!isInsignificant(child)) {
        size += this.child(child) + 1;
      }
    }
    return size;
  }

  private component(element: JSXElement): number {
    let size = COMPONENT + nameLength(element.openingElement.name);
    let spread = false;
    for (const attribute of element.openingElement.attributes) {
      if (attribute.type === 'JSXSpreadAttribute') {
        spread = true;
        size += this.node(attribute.argument) + 1;
        continue;
      }
      const name = attributeName(attribute);
      const { value } = attribute;
      if (!value || value.type === 'Literal') {
        size += name.length + 1 + (value ? this.text(value) : 4);
      } else if (value.type === 'JSXExpressionContainer') {
        const { expression } = value;
        if (expression.type !== 'JSXEmptyExpression') {
          const inner = unwrap(expression);
          const literal =
            inner.type === 'Literal' ||
            inner.type === 'Identifier' ||
            inner.type === 'ArrowFunctionExpression' ||
            inner.type === 'FunctionExpression';
          size += name.length + 1 + (literal ? 0 : GETTER) + this.node(inner);
        }
      } else {
        size += name.length + GETTER + this.jsx(value, false);
      }
    }
    const significant = element.children.filter((child) => !isInsignificant(child));
    if (significant.length > 0) {
      size += GETTER + 'children'.length + this.children(significant);
    }
    return size + (spread ? MERGE : 0);
  }

  /**
   * The size of what a component returns. JSX lowers as JSX, and anything
   * else is inserted when it sits in an element.
   */
  root(node: Expression, inTemplate: boolean): number {
    const inner = unwrap(node);
    if (inner.type === 'JSXElement' || inner.type === 'JSXFragment') {
      return this.jsx(inner, inTemplate);
    }
    return (inTemplate ? INSERT + WALK : 0) + this.node(inner);
  }
}
