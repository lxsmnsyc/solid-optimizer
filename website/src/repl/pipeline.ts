/**
 * The REPL pipeline: bundle the files, optimize the chunk, then lower both
 * the plain and the optimized chunk with Solid's JSX transform. Both
 * compilers are WebAssembly builds of the native ones, loaded on first use.
 */
import type * as SolidCompilerModule from '@solidjs/compiler';
import type * as OptimizerModule from 'solid-optimizer';
import type { Lowered, PipelineRequest, PipelineResponse, SkipEntry } from './protocol';
import { BundleError, bundle } from './bundle';

type Optimizer = typeof OptimizerModule;
type SolidCompiler = typeof SolidCompilerModule;

interface Toolchain {
  optimizer: Optimizer;
  solid: SolidCompiler;
}

let toolchain: Promise<Toolchain> | undefined;

async function loadToolchain(): Promise<Toolchain> {
  // Both packages instantiate their WebAssembly module on import.
  const [optimizer, solid] = await Promise.all([
    import('solid-optimizer'),
    import('@solidjs/compiler-wasm32-wasi') as Promise<SolidCompiler>,
  ]);
  return { optimizer, solid };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TEMPLATE = /^var _tmpl\$\d* = /gm;
const COMPONENT = /_\$createComponent\(/g;

/** Drops the blank lines and empty file sections that removed code leaves. */
function tidy(code: string): string {
  return code
    .replace(/[ \t]+$/gm, '')
    .replace(/^\/\/ \S+\.(?:tsx|ts|jsx|js)\n\n*(?=\/\/ \S+\.(?:tsx|ts|jsx|js)$)/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

async function gzipSize(text: string): Promise<number> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return buffer.byteLength;
}

async function lower(
  solid: SolidCompiler,
  code: string,
  filename: string,
  generate: 'dom' | 'ssr',
): Promise<Lowered> {
  const result = solid.transform(code, {
    filename,
    moduleName: '@solidjs/web',
    generate,
    hydratable: false,
  });
  return {
    code: result.code,
    templates: result.code.match(TEMPLATE)?.length ?? 0,
    components: result.code.match(COMPONENT)?.length ?? 0,
    bytes: new TextEncoder().encode(result.code).byteLength,
    gzip: await gzipSize(result.code),
  };
}

export async function runPipeline(request: PipelineRequest): Promise<PipelineResponse> {
  const { id, files, options } = request;

  let tools: Toolchain;
  try {
    toolchain ??= loadToolchain();
    tools = await toolchain;
  } catch (error) {
    toolchain = undefined;
    return { id, ok: false, stage: 'load', message: formatError(error) };
  }

  const started = performance.now();

  // 1. Join the files into one chunk.
  let chunk;
  try {
    chunk = bundle(files);
  } catch (error) {
    const message = error instanceof BundleError ? error.message : formatError(error);
    return { id, ok: false, stage: 'bundle', message };
  }

  // 2. Optimize the chunk. Its output is still JSX.
  let optimized: string;
  const skipped: SkipEntry[] = [];
  try {
    const result = tools.optimizer.compile(chunk.code, {
      filename: chunk.filename,
      fold: options.fold,
      inline: options.inline,
      contexts: options.contexts,
      memos: options.memos,
      sourceMap: false,
      report: true,
    });
    optimized = tidy(result.code);
    for (const skip of result.skipped ?? []) {
      skipped.push({ pass: skip.pass, reason: skip.reason, name: skip.name });
    }
  } catch (error) {
    return { id, ok: false, stage: 'optimize', message: formatError(error) };
  }

  // 3. Lower both versions, so the output can be compared with the baseline.
  try {
    const [baseline, output] = await Promise.all([
      lower(tools.solid, chunk.code, chunk.filename, options.generate),
      lower(tools.solid, optimized, chunk.filename, options.generate),
    ]);
    return {
      id,
      ok: true,
      bundle: chunk.code,
      optimized,
      baseline,
      output,
      skipped,
      ms: performance.now() - started,
    };
  } catch (error) {
    return { id, ok: false, stage: 'lower', message: formatError(error) };
  }
}
