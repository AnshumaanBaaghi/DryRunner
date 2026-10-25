import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { useEditor } from './state/editorStore';
import { usePlayback } from './state/playbackStore';
import { useRun } from './state/runStore';

// dev-only hook for end-to-end tests (setting editor code reliably); absent from production builds
if (import.meta.env.DEV) {
  (window as unknown as { __algoscope?: unknown }).__algoscope = { editor: useEditor, run: useRun, playback: usePlayback };
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
