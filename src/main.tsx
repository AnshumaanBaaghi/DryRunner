import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { useEditor } from './state/editorStore';
import { usePlayback } from './state/playbackStore';
import { useRun } from './state/runStore';
import { useViz } from './state/vizStore';

// dev-only hook for end-to-end tests (setting editor code reliably, measuring); absent from production builds
if (import.meta.env.DEV) {
  (window as unknown as { __algoscope?: unknown }).__algoscope = {
    editor: useEditor, run: useRun, playback: usePlayback, viz: useViz,
    bench: (source: string) => import('./devtools').then((m) => m.bench(source)),
  };
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
