/** A file in the REPL. */
export interface VirtualFile {
  name: string;
  code: string;
}

export interface PipelineOptions {
  fold: boolean;
  inline: boolean;
  contexts: boolean;
  memos: boolean;
  generate: 'dom' | 'ssr';
}

export interface PipelineRequest {
  id: number;
  files: VirtualFile[];
  options: PipelineOptions;
}

/** What Solid's JSX transform made of one version of the chunk. */
export interface Lowered {
  code: string;
  templates: number;
  components: number;
  bytes: number;
  gzip: number;
}

export interface SkipEntry {
  pass: string;
  reason: string;
  name: string;
}

export interface PipelineSuccess {
  id: number;
  ok: true;
  /** The files joined into one JSX chunk. */
  bundle: string;
  /** The chunk after solid-optimizer, still JSX. */
  optimized: string;
  /** The chunk lowered without the optimizer. */
  baseline: Lowered;
  /** The optimized chunk lowered. */
  output: Lowered;
  skipped: SkipEntry[];
  ms: number;
}

export interface PipelineFailure {
  id: number;
  ok: false;
  stage: 'bundle' | 'optimize' | 'lower' | 'load';
  message: string;
}

export type PipelineResponse = PipelineSuccess | PipelineFailure;
