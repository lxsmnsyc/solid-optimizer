import fc from 'fast-check';

// The default 100 runs keep the suite fast. `FC_RUNS=10000 pnpm test` searches longer.
const runs = process.env.FC_RUNS;
if (runs !== undefined) {
  fc.configureGlobal({ numRuns: Number(runs) });
}
