/** Compile → run → incremental timeline. The timeline object grows in place; `version` signals growth. */
import { create } from 'zustand';
import { sandbox } from '../engine/sandbox/instance';
import { TimelineBuilder } from '../engine/timeline/builder';
import type { Timeline } from '../engine/timeline/types';
import type { CompileError, StaticAnalysis } from '../engine/types/meta';
import { DEFAULT_LIMITS, type RunLimits } from '../engine/types/trace';
import { useEditor } from './editorStore';
import { usePlayback } from './playbackStore';
import { loadJSON, saveJSON } from './storage';
import { useUi } from './uiStore';

export type RunStatus = 'idle' | 'compiling' | 'running' | 'done';

interface RunState {
  status: RunStatus;
  timeline: Timeline | null;
  version: number;
  compileError: CompileError | null;
  ranSource: string | null;
  limits: RunLimits;
  visualize(options?: { skipEntryCheck?: boolean; auto?: boolean }): Promise<void>;
  cancel(): void;
  setLimits(patch: Partial<RunLimits>): void;
}

let cancelCurrent: (() => void) | null = null;
let runToken = 0;

export function needsEntryCall(a: StaticAnalysis): boolean {
  return !a.hasTopLevelCall && a.functions.length > 0;
}

export const useRun = create<RunState>((set, get) => ({
  status: 'idle',
  timeline: null,
  version: 0,
  compileError: null,
  ranSource: null,
  limits: { ...DEFAULT_LIMITS, ...loadJSON<Partial<RunLimits>>('algoscope.limits', {}) },

  async visualize(options = {}) {
    const source = useEditor.getState().code;
    const token = ++runToken;
    cancelCurrent?.();
    cancelCurrent = null;
    usePlayback.getState().pause();
    set({ status: 'compiling', compileError: null });
    const compiled = await sandbox().compile(source);
    if (token !== runToken) return;
    if (!compiled.ok) {
      set({ status: 'idle', compileError: compiled.error, timeline: null, ranSource: null });
      useEditor.getState().setSyntaxError(compiled.error);
      return;
    }
    useEditor.getState().setSyntaxError(null);
    if (!options.skipEntryCheck && needsEntryCall(compiled.meta.analysis)) {
      set({ status: 'idle' });
      // an automatic run (page load) never pops a dialog
      if (!options.auto) useUi.getState().openEntryDialog(compiled.meta.analysis.functions);
      return;
    }
    const builder = new TimelineBuilder(compiled.meta);
    set({ status: 'running', timeline: builder.tl, version: 0, ranSource: source });
    usePlayback.getState().reset();
    let frame = 0;
    const bump = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (token === runToken) set({ version: get().version + 1 });
      });
    };
    const handle = sandbox().run(compiled.code, get().limits, (events) => {
      if (token !== runToken) return;
      builder.append(events);
      bump();
    });
    cancelCurrent = handle.cancel;
    await handle.done;
    if (token !== runToken) return;
    cancelCurrent = null;
    if (frame) cancelAnimationFrame(frame);
    set({ status: 'done', version: get().version + 1 });
  },

  cancel() {
    cancelCurrent?.();
    cancelCurrent = null;
  },

  setLimits(patch) {
    const limits = { ...get().limits, ...patch };
    saveJSON('algoscope.limits', limits);
    set({ limits });
  },
}));
