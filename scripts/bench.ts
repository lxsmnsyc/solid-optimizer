/**
 * Benchmarks the bundle size and build time of every example app, with and
 * without the optimizer, in each chunking mode.
 *
 * An example takes part when its `vite.config.ts` reads `OPTIMIZER` (`off`
 * builds without the optimizer) and `CHUNKS` (`default`, `vendor`, or
 * `single`), and builds into `dist/<chunks>/<optimized|plain>`.
 *
 * Sizes are the app's JavaScript, minified and gzipped, summed over every
 * chunk. Build times are the median wall time of `vite build`, Vite's startup
 * included, so they compare the two builds on one machine, not across machines.
 *
 * Usage:
 *
 * - `node scripts/bench.ts` writes the report to `benchmarks.md`.
 * - `--runs <n>` builds each configuration n times. Defaults to 3.
 * - `--root <dir>` benchmarks another checkout, such as a pull request's base.
 * - `--json <file>` also writes the raw results.
 * - `--from <file>` renders results written before instead of building.
 * - `--compare <file>` adds the change from earlier results, such as the base branch's.
 * - `--markdown <file>` picks the report's path. `-` prints it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

const MODES = ['default', 'vendor', 'single'] as const;
const VARIANTS = ['plain', 'optimized'] as const;

interface Measure {
  /** Bytes of JavaScript once minified, summed over every chunk. */
  readonly minified: number;
  /** The same, gzipped chunk by chunk. */
  readonly gzipped: number;
  /** How many JavaScript chunks the build wrote. */
  readonly chunks: number;
  /** The median build time, in milliseconds. */
  readonly ms: number;
}

type ModeResult = Record<(typeof VARIANTS)[number], Measure>;

interface Results {
  readonly commit: string;
  readonly date: string;
  readonly node: string;
  readonly cpu: string;
  readonly runs: number;
  /** By example, then by chunking mode. Results read back from a file may lack either. */
  readonly examples: Partial<Record<string, Partial<Record<string, ModeResult>>>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

function isResults(value: unknown): value is Results {
  return (
    isRecord(value) &&
    typeof value.commit === 'string' &&
    typeof value.runs === 'number' &&
    isRecord(value.examples)
  );
}

function readResults(file: string): Results {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isResults(parsed)) {
    throw new TypeError(`${file} does not hold benchmark results`);
  }
  return parsed;
}

function git(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

/** The examples that build with and without the optimizer, in each chunking mode. */
function findExamples(root: string): string[] {
  const dir = path.join(root, 'examples');
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      const config = path.join(dir, name, 'vite.config.ts');
      if (!existsSync(config)) {
        return false;
      }
      const code = readFileSync(config, 'utf8');
      return code.includes('process.env.OPTIMIZER') && code.includes('process.env.CHUNKS');
    })
    .sort();
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted.at(middle) ?? 0)
    : ((sorted.at(middle - 1) ?? 0) + (sorted.at(middle) ?? 0)) / 2;
}

/** Runs `vite build` for one configuration and returns how long it took. */
function build(dir: string, mode: string, variant: string): number {
  const start = performance.now();
  const result = spawnSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'error'], {
    cwd: dir,
    env: { ...process.env, CHUNKS: mode, OPTIMIZER: variant === 'plain' ? 'off' : 'on' },
    encoding: 'utf8',
  });
  const elapsed = performance.now() - start;
  if (result.status !== 0) {
    throw new Error(`vite build failed in ${dir} (${mode}, ${variant}):\n${result.stderr}`);
  }
  return elapsed;
}

type Minify = (filename: string, code: string, options: { module: boolean }) => { code: string };

/** Vite's minifier, as the example itself resolves it. */
async function loadMinifier(dir: string): Promise<Minify> {
  const require = createRequire(path.join(dir, 'package.json'));
  const vite: unknown = await import(pathToFileURL(require.resolve('vite')).href);
  const minifySync = isRecord(vite) ? vite.minifySync : undefined;
  if (!isFunction(minifySync)) {
    throw new TypeError(`vite in ${dir} has no minifySync`);
  }
  return (filename, code, options) => {
    const result: unknown = minifySync(filename, code, options);
    if (!isRecord(result) || typeof result.code !== 'string') {
      throw new TypeError(`minifySync returned no code for ${filename}`);
    }
    return { code: result.code };
  };
}

function scripts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function measure(outDir: string, minify: Minify, ms: number): Measure {
  let minified = 0;
  let gzipped = 0;
  const files = scripts(outDir);
  for (const file of files) {
    const code = minify(file, readFileSync(file, 'utf8'), { module: true }).code;
    minified += Buffer.byteLength(code);
    gzipped += gzipSync(code).byteLength;
  }
  return { minified, gzipped, chunks: files.length, ms };
}

async function benchmark(root: string, runs: number): Promise<Results> {
  const examples: Results['examples'] = {};
  for (const name of findExamples(root)) {
    const dir = path.join(root, 'examples', name);
    // oxlint-disable-next-line no-await-in-loop
    const minify = await loadMinifier(dir);
    const modes: Record<string, ModeResult> = {};
    for (const mode of MODES) {
      const result: Partial<ModeResult> = {};
      for (const variant of VARIANTS) {
        const times: number[] = [];
        for (let run = 0; run < runs; run += 1) {
          times.push(build(dir, mode, variant));
        }
        process.stderr.write(
          `${name} ${mode} ${variant}: ${String(Math.round(median(times)))} ms\n`,
        );
        result[variant] = measure(path.join(dir, 'dist', mode, variant), minify, median(times));
      }
      if (result.plain && result.optimized) {
        modes[mode] = { plain: result.plain, optimized: result.optimized };
      }
    }
    examples[name] = modes;
  }
  return {
    commit: git(root, ['rev-parse', '--short', 'HEAD']),
    date: new Date().toISOString().slice(0, 10),
    node: process.version,
    cpu: cpus().at(0)?.model.trim() ?? 'unknown',
    runs,
    examples,
  };
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

function change(before: number, after: number, format: (value: number) => string): string {
  const delta = after - before;
  const percent = before === 0 ? 0 : (delta / before) * 100;
  let sign = '±';
  if (delta > 0) {
    sign = '+';
  } else if (delta < 0) {
    sign = '−';
  }
  return `${sign}${format(Math.abs(delta))} (${sign}${Math.abs(percent).toFixed(1)}%)`;
}

function byteCount(value: number): string {
  return `${String(value)} B`;
}

/** The report: per example and chunking mode, plain against optimized. */
function render(results: Results, base?: Results): string {
  const lines: string[] = [];
  const header = base
    ? `Commit \`${results.commit}\` against base \`${base.commit}\`.`
    : `Commit \`${results.commit}\`, ${results.date}.`;
  lines.push(
    `${header} Node ${results.node}, ${results.cpu}, median of ${String(results.runs)} builds.`,
    '',
    "Sizes are each app's JavaScript, minified and gzipped chunk by chunk, summed over every chunk. Build times are the wall time of `vite build`, Vite's startup included; compare them within a run, since machines differ.",
  );
  for (const [name, modes] of Object.entries(results.examples)) {
    if (!modes) {
      continue;
    }
    lines.push('', `### ${name}`, '');
    if (base) {
      lines.push(
        '| Chunking | Optimized (gzip) | vs base | Saved vs plain | Optimized build | vs base |',
        '| --- | --- | --- | --- | --- | --- |',
      );
    } else {
      lines.push(
        '| Chunking | Plain (gzip) | Optimized (gzip) | Change | Plain (min) | Optimized (min) | Plain build | Optimized build |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
      );
    }
    for (const [mode, result] of Object.entries(modes)) {
      if (!result) {
        continue;
      }
      const { plain, optimized } = result;
      if (base) {
        const before = base.examples[name]?.[mode]?.optimized;
        lines.push(
          `| ${mode} | ${kb(optimized.gzipped)} | ${before ? change(before.gzipped, optimized.gzipped, byteCount) : 'new'} | ${change(plain.gzipped, optimized.gzipped, byteCount)} | ${seconds(optimized.ms)} | ${before ? change(before.ms, optimized.ms, seconds) : 'new'} |`,
        );
      } else {
        lines.push(
          `| ${mode} | ${kb(plain.gzipped)} | ${kb(optimized.gzipped)} | ${change(plain.gzipped, optimized.gzipped, byteCount)} | ${kb(plain.minified)} | ${kb(optimized.minified)} | ${seconds(plain.ms)} | ${seconds(optimized.ms)} |`,
        );
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    runs: { type: 'string', default: '3' },
    json: { type: 'string' },
    from: { type: 'string' },
    compare: { type: 'string' },
    markdown: { type: 'string' },
  },
});

const repo = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(values.root ?? repo);
const results = values.from
  ? readResults(values.from)
  : await benchmark(root, Math.max(1, Number(values.runs)));
if (values.json) {
  writeFileSync(values.json, `${JSON.stringify(results, null, 2)}\n`);
}
const base = values.compare ? readResults(values.compare) : undefined;
const body = render(results, base);
const report = base
  ? `## Bundle size\n\n${body}`
  : `# Benchmarks\n\nGenerated by \`pnpm bench\`.\n\n${body}`;
const target = values.markdown ?? (base ? '-' : path.join(repo, 'benchmarks.md'));
if (target === '-') {
  process.stdout.write(report);
} else {
  writeFileSync(target, report);
}
