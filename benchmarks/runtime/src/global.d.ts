export {};

declare global {
  interface Window {
    /** What the client entries expose for the benchmark to call. */
    bench: {
      mount?: (element: HTMLElement) => () => void;
      hydrate?: (element: HTMLElement) => () => void;
      /** What to click after hydration, and what has to change when it does. */
      probe?: { click: string; watch: string };
    };
    /** Set by `instrument` in `page.ts`. */
    counts: { templatesCreated: number; nodesCloned: number };
    countDom: (root: Node) => { elements: number; texts: number; comments: number };
    markup: (root: Element) => string;
    /** Kept between calls while the heap is measured. */
    heap: { roots: HTMLElement[]; stops: (() => void)[] };
  }
}
