/**
 * The report of what the optimizer leaves alone in a build, and why.
 *
 * Each pass records a short reason code for every component call, provider,
 * and memo it does not optimize. The plugin collects them from the final
 * compile of each chunk or module, and prints them grouped by reason.
 */
import type { Skip, SkipPass } from '../context';

/** What the optimizer left alone in one build environment. */
export interface OptimizerReport {
  /** The Vite environment, like `client` or `ssr`. */
  readonly environment: string;
  readonly skips: readonly Skip[];
}

export interface ReasonSummary {
  readonly pass: SkipPass;
  readonly reason: string;
  readonly count: number;
  /** How many times each name was skipped for this reason, most first. */
  readonly names: readonly (readonly [string, number])[];
}

/**
 * Groups skips by pass and reason, most frequent first.
 */
export function summarizeSkips(skips: readonly Skip[]): ReasonSummary[] {
  const groups = new Map<string, { pass: SkipPass; reason: string; names: Map<string, number> }>();
  for (const skip of skips) {
    const key = `${skip.pass}\0${skip.reason}`;
    const group = groups.get(key) ?? { pass: skip.pass, reason: skip.reason, names: new Map() };
    group.names.set(skip.name, (group.names.get(skip.name) ?? 0) + 1);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ pass, reason, names }) => ({
      pass,
      reason,
      count: [...names.values()].reduce((sum, count) => sum + count, 0),
      names: [...names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    }))
    .sort(
      (a, b) =>
        b.count - a.count || a.pass.localeCompare(b.pass) || a.reason.localeCompare(b.reason),
    );
}

/** The most names listed for a reason. */
const NAMES_SHOWN = 6;

/**
 * The report as text, one line per reason.
 */
export function formatReport(report: OptimizerReport): string {
  const lines = [`solid-optimizer: what stays as written in ${report.environment}`];
  const summaries = summarizeSkips(report.skips);
  if (summaries.length === 0) {
    lines.push('  nothing');
  }
  const reasonWidth = Math.max(0, ...summaries.map((summary) => summary.reason.length));
  for (const summary of summaries) {
    const shown = summary.names
      .slice(0, NAMES_SHOWN)
      .map(([name, count]) => (count > 1 ? `${name}×${String(count)}` : name));
    if (summary.names.length > NAMES_SHOWN) {
      shown.push(`${String(summary.names.length - NAMES_SHOWN)} more`);
    }
    lines.push(
      `  ${summary.pass.padEnd(8)} ${summary.reason.padEnd(reasonWidth)} ${String(summary.count).padStart(4)}  ${shown.join(', ')}`,
    );
  }
  return lines.join('\n');
}
