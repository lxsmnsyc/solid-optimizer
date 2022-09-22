import * as babel from '@babel/core';
import plugin from 'solid-optimizer';

async function compile(code) {
  const result = await babel.transformAsync(code, {
    plugins: [
      [plugin],
    ],
  });

  return result.code;
}

compile(`
import { batch as x } from 'solid-js';

x(() => update());
`).then(console.log);