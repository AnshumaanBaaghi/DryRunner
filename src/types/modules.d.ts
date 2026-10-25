// Monaco 0.57 internals are imported for their side effects only (contributions, languages, features).
// Kept narrow so `monaco-editor/editor/editor.worker?worker` still resolves to Vite's typed `*?worker`.
declare module 'monaco-editor/editor/browser/*';
declare module 'monaco-editor/editor/common/*';
declare module 'monaco-editor/editor/contrib/*';
declare module 'monaco-editor/editor/standalone/*';
declare module 'monaco-editor/features/*';
declare module 'monaco-editor/languages/definitions/*';

// troika-three-text ships no typings; only the global configuration entry point is used directly.
declare module 'troika-three-text' {
  export function configureTextBuilder(config: {
    defaultFontURL?: string | null;
    unicodeFontsURL?: string | null;
    sdfGlyphSize?: number;
    useWorker?: boolean;
  }): void;
  export function preloadFont(options: { font?: string; characters?: string | string[]; sdfGlyphSize?: number }, callback: () => void): void;
}

// opentype.js 2 ships no typings; the font coverage test only parses a font and asks for glyphs.
declare module 'opentype.js' {
  export interface Font {
    hasChar(char: string): boolean;
  }
  export function parse(buffer: ArrayBuffer): Font;
}
