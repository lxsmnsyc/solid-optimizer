/**
 * Functions that run inside the benchmark pages. Playwright sends each one's
 * source to the page, so none of them can use anything from this module's
 * scope. They share helpers through `window`, which `instrument` sets up.
 */

/** Exact counts of one client render. */
export interface DomCounts {
  elements: number;
  texts: number;
  comments: number;
  templatesCreated: number;
  nodesCloned: number;
  markup: string;
}

/** The live reactive graph that one client render adds. */
export interface GraphCounts {
  owners: number;
  computations: number;
  signals: number;
  edges: number;
  markup: string;
}

/** Exact counts of one hydration. */
export interface HydrationCounts extends DomCounts {
  /** Nodes in the hydrated app that the server did not write. */
  nodesCreated: number;
  /** Nodes the server wrote that hydration removed. */
  nodesRemoved: number;
  /** Whether a click on the app's probe updates it after hydration. */
  interactive: boolean;
  serverMarkup: string;
}

/**
 * Runs before the app's script. Counts template creation and cloning:
 * `template()` in `@solidjs/web` makes a `<template>` once per template and
 * clones its content with `cloneNode(true)` or `importNode`.
 */
export function instrument(): void {
  window.counts = { templatesCreated: 0, nodesCloned: 0 };

  // Each template sets its HTML once, on a new `<template>`.
  const innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(HTMLTemplateElement.prototype, 'innerHTML', {
    configurable: true,
    get(this: HTMLTemplateElement): string {
      const html: unknown = innerHTML?.get?.call(this);
      return typeof html === 'string' ? html : '';
    },
    set(this: HTMLTemplateElement, html: string) {
      window.counts.templatesCreated += 1;
      innerHTML?.set?.call(this, html);
    },
  });

  // Each element a template makes is a deep clone of its content.
  // oxlint-disable-next-line typescript/unbound-method -- called below with `this` bound
  const { cloneNode } = Node.prototype;
  function countClone(this: Node, subtree?: boolean): Node {
    if (subtree === true) {
      window.counts.nodesCloned += 1;
    }
    return cloneNode.call(this, subtree);
  }
  Object.defineProperty(Node.prototype, 'cloneNode', {
    configurable: true,
    writable: true,
    value: countClone,
  });
  // oxlint-disable-next-line typescript/unbound-method -- called below with `this` bound
  const { importNode } = Document.prototype;
  function countImport(this: Document, node: Node, subtree?: boolean): Node {
    if (subtree === true) {
      window.counts.nodesCloned += 1;
    }
    return importNode.call(this, node, subtree);
  }
  Object.defineProperty(Document.prototype, 'importNode', {
    configurable: true,
    writable: true,
    value: countImport,
  });

  window.countDom = (root) => {
    const result = { elements: 0, texts: 0, comments: 0 };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        result.elements += 1;
      } else if (node.nodeType === Node.TEXT_NODE) {
        result.texts += 1;
      } else if (node.nodeType === Node.COMMENT_NODE) {
        result.comments += 1;
      }
    }
    return result;
  };

  // The markup with comments and hydration keys left out and attributes
  // sorted. The optimized build can move an attribute into a template, which
  // changes the order attributes are set in but not what the element has.
  // A class is compared as its list of names: the server writes a class
  // object with spaces where a name is off, and hydration keeps them.
  function write(node: Node): string {
    if (node instanceof Text) {
      return node.data;
    }
    if (!(node instanceof Element)) {
      return '';
    }
    const attributes: string[] = [];
    for (const attribute of node.attributes) {
      if (attribute.name === 'class') {
        attributes.push(` class="${[...node.classList].join(' ')}"`);
      } else if (attribute.name !== '_hk') {
        attributes.push(` ${attribute.name}="${attribute.value}"`);
      }
    }
    attributes.sort();
    let children = '';
    for (const child of node.childNodes) {
      children += write(child);
    }
    return `<${node.localName}${attributes.join('')}>${children}</${node.localName}>`;
  }
  window.markup = (root) => {
    let result = '';
    for (const child of root.childNodes) {
      result += write(child);
    }
    return result;
  };
}

/** Renders the app once into `#app` and counts what that created. */
export function countClient(): DomCounts {
  const root = document.getElementById('app');
  if (!root || !window.bench.mount) {
    throw new Error('no client build');
  }
  const before = { ...window.counts };
  window.bench.mount(root);
  return {
    ...window.countDom(root),
    templatesCreated: window.counts.templatesCreated - before.templatesCreated,
    nodesCloned: window.counts.nodesCloned - before.nodesCloned,
    markup: window.markup(root),
  };
}

/**
 * Renders the app once into `#app` with the `observe` runtime, and counts the
 * owners, computations, signals, and dependency edges the render added.
 */
export function countGraph(): GraphCounts {
  const root = document.getElementById('app');
  const { mount, graph } = window.bench;
  if (!root || !mount || !graph) {
    throw new Error('no graph build');
  }
  const before = graph();
  mount(root);
  const after = graph();
  return {
    owners: after.owners - before.owners,
    computations: after.computations - before.computations,
    signals: after.signals - before.signals,
    edges: after.edges - before.edges,
    markup: window.markup(root),
  };
}

/** Hydrates the server's markup in `#app` and counts what that changed. */
export async function countHydration(): Promise<HydrationCounts> {
  const root = document.getElementById('app');
  if (!root || !window.bench.hydrate) {
    throw new Error('no hydrating build');
  }
  const serverMarkup = window.markup(root);
  const serverNodes = new Set<Node>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    serverNodes.add(node);
  }
  const before = { ...window.counts };
  window.bench.hydrate(root);

  // Compare the nodes after hydration with the server's.
  let nodesCreated = 0;
  const after = new Set<Node>();
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    after.add(node);
    if (!serverNodes.has(node)) {
      nodesCreated += 1;
    }
  }
  let nodesRemoved = 0;
  for (const node of serverNodes) {
    if (!after.has(node)) {
      nodesRemoved += 1;
    }
  }
  const markup = window.markup(root);

  // Click the app's probe, and wait for Solid to flush the update.
  const probe = window.bench.probe;
  const watched = (): string | null | undefined =>
    probe ? root.querySelector(probe.watch)?.textContent : undefined;
  const text = watched();
  if (probe) {
    root.querySelector<HTMLElement>(probe.click)?.click();
  }
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  return {
    ...window.countDom(root),
    templatesCreated: window.counts.templatesCreated - before.templatesCreated,
    nodesCloned: window.counts.nodesCloned - before.nodesCloned,
    nodesCreated,
    nodesRemoved,
    interactive: text !== undefined && watched() !== text,
    markup,
    serverMarkup,
  };
}

/** Microseconds to mount the app once and to dispose it, averaged over a batch. */
export function timeMount(count: number): { mount: number; dispose: number } {
  const root = document.getElementById('app');
  const mount = window.bench.mount;
  if (!root || !mount) {
    throw new Error('no client build');
  }
  let mounting = 0;
  let disposing = 0;
  for (let index = 0; index < count; index += 1) {
    const start = performance.now();
    const stop = mount(root);
    const mid = performance.now();
    stop();
    disposing += performance.now() - mid;
    mounting += mid - start;
  }
  return { mount: (mounting * 1000) / count, dispose: (disposing * 1000) / count };
}

/** Makes the detached roots that `mountHeap` renders into. */
export function prepareHeap(count: number): void {
  window.heap = { roots: [], stops: [] };
  for (let index = 0; index < count; index += 1) {
    window.heap.roots.push(document.createElement('div'));
  }
}

export function mountHeap(): void {
  const mount = window.bench.mount;
  if (!mount) {
    throw new Error('no client build');
  }
  for (const root of window.heap.roots) {
    window.heap.stops.push(mount(root));
  }
}

export function disposeHeap(): void {
  for (const stop of window.heap.stops) {
    stop();
  }
  window.heap = { roots: [], stops: [] };
}

/** Microseconds of one mount or hydration of `#app`. */
export function timeOnce(kind: 'mount' | 'hydrate'): number {
  const run = window.bench[kind];
  if (!run) {
    throw new Error(`no ${kind} build`);
  }
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('no #app');
  }
  const start = performance.now();
  run(root);
  return (performance.now() - start) * 1000;
}
