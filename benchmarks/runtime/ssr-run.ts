/**
 * Times `renderToString` for one server build, in its own process so the
 * two builds do not share JIT state. Prints `us/op: <microseconds>`.
 *
 * Usage: node ssr-run.ts <server.mjs> <iterations>
 */
import { pathToFileURL } from 'node:url';

const [file = '', count = '2000'] = process.argv.slice(2);
const iterations = Number(count);
function hasRender(value: unknown): value is { render: () => string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'render' in value &&
    typeof value.render === 'function'
  );
}

const module: unknown = await import(pathToFileURL(file).href);
if (!hasRender(module)) {
  throw new Error(`${file} exports no render()`);
}
const { render } = module;

// Warm up, so the timed loop runs optimized code.
let length = 0;
for (let index = 0; index < iterations; index += 1) {
  length += render().length;
}
const start = process.hrtime.bigint();
for (let index = 0; index < iterations; index += 1) {
  length += render().length;
}
const elapsed = Number(process.hrtime.bigint() - start) / 1000;
// The length is printed so the loop's work cannot be dropped.
process.stdout.write(`us/op: ${String(elapsed / iterations)} (${String(length)})\n`);
