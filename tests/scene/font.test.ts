/** The bundled label font covers every character 3D labels use (no runtime fallback-font fetches). */
import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { LABEL_GLYPHS } from '../../src/scene/glyphs';

describe('label font', () => {
  it('has a glyph for every label character', () => {
    const file = readFileSync(new URL('../../public/fonts/JetBrainsMono-Regular.ttf', import.meta.url));
    const font = parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    expect([...LABEL_GLYPHS].filter((ch) => !font.hasChar(ch))).toEqual([]);
  });
});
