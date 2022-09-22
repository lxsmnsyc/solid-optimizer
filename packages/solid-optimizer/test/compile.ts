import * as babel from '@babel/core';
import plugin from '../src';

export default async function compile(code: string) {
  const result = await babel.transformAsync(code, {
    plugins: [
      [plugin],
    ],
  });

  return result?.code;
}
