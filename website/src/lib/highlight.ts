import { language as bash } from '@twinkleplop/bash';
import { language as tsx } from '@twinkleplop/tsx';

const LANGUAGES = {
  tsx: tsx(),
  bash: bash(),
};

export type Language = keyof typeof LANGUAGES;

/** Highlights code with twinkleplop, as `<pre class="twinkleplop">` HTML. */
export function highlight(code: string, lang: Language = 'tsx'): string {
  return LANGUAGES[lang](code);
}
