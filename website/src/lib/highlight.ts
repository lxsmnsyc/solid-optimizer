import { language as bash } from '@twinkleplop/bash';
import { language as html } from '@twinkleplop/html';
import { language as tsx } from '@twinkleplop/tsx';

const LANGUAGES = {
  tsx: tsx(),
  bash: bash(),
  html: html(),
};

export type Language = keyof typeof LANGUAGES;

/** Highlights code with twinkleplop, as `<pre class="twinkleplop">` HTML. */
export function highlight(code: string, lang: Language = 'tsx'): string {
  return LANGUAGES[lang](code);
}
