// Monaco 0.57 internals are imported for their side effects only (contributions, languages, features).
// Kept narrow so `monaco-editor/editor/editor.worker?worker` still resolves to Vite's typed `*?worker`.
declare module 'monaco-editor/editor/browser/*';
declare module 'monaco-editor/editor/common/*';
declare module 'monaco-editor/editor/contrib/*';
declare module 'monaco-editor/editor/standalone/*';
declare module 'monaco-editor/features/*';
declare module 'monaco-editor/languages/definitions/*';
