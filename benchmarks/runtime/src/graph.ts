/**
 * The client entry of the app picked by `--app`, built with Solid's `observe`
 * runtime, which can count the live reactive graph. `bench-client` is an
 * alias for `src/<app>/client.tsx`.
 */
import 'bench-client';
import { graphSize } from 'solid-js/attribution';

window.bench.graph = graphSize;
