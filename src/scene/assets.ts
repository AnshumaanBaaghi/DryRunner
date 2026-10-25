/**
 * Local 3D assets only (no runtime CDN): the label font (JetBrains Mono, OFL — see public/fonts).
 * troika must be configured before its first text request.
 */
import { configureTextBuilder, preloadFont } from 'troika-three-text';
import { LABEL_GLYPHS } from './glyphs';

export const FONT_URL = `${import.meta.env.BASE_URL}fonts/JetBrainsMono-Regular.ttf`;

let configured = false;
export function configureText(): void {
  if (configured) return;
  configured = true;
  configureTextBuilder({
    defaultFontURL: FONT_URL,
    // glyphs missing from the font would otherwise be fetched from a CDN; point at a local path instead
    unicodeFontsURL: `${import.meta.env.BASE_URL}fonts/unicode`,
  });
  // build the glyph atlas up front so the first labels appear without a hitch
  preloadFont({ font: FONT_URL, characters: LABEL_GLYPHS }, () => {});
}
