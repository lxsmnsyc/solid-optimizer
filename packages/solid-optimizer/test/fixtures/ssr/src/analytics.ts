// Only used by an effect, so the server bundle should not contain it.
export function trackClicks(count: number): void {
  globalThis.dispatchEvent(new CustomEvent('client-only-analytics', { detail: count }));
}
