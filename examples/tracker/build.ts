/**
 * Builds the app with and without the optimizer, in every chunking mode.
 * The output goes to `dist/<chunks>/<optimized|plain>`.
 */
import { build } from 'vite';

const MODES = ['default', 'vendor', 'single'];

for (const chunks of MODES) {
  for (const optimizer of ['on', 'off']) {
    process.env.CHUNKS = chunks;
    process.env.OPTIMIZER = optimizer;
    // oxlint-disable-next-line no-await-in-loop
    await build({ logLevel: 'warn' });
  }
}
