import { create } from 'zustand';
import { DEFAULT_EXAMPLE_ID, exampleById } from '../examples';
import type { CompileError } from '../engine/types/meta';
import { loadJSON, saveJSON } from './storage';

export interface Breakpoint {
  line: number;
  condition?: string;
}

interface EditorState {
  code: string;
  exampleId: string | null;
  breakpoints: Breakpoint[];
  syntaxError: CompileError | null;
  setCode(code: string): void;
  loadExample(id: string): void;
  toggleBreakpoint(line: number): void;
  setBreakpointCondition(line: number, condition: string | undefined): void;
  moveBreakpoints(lines: number[]): void;
  clearBreakpoints(): void;
  setSyntaxError(err: CompileError | null): void;
}

const saved = loadJSON<{ code?: string; exampleId?: string | null; breakpoints?: Breakpoint[] }>('algoscope.editor', {});
const initialExample = saved.exampleId === undefined ? DEFAULT_EXAMPLE_ID : saved.exampleId;
const initialCode = saved.code ?? exampleById(DEFAULT_EXAMPLE_ID)?.code ?? '';

export const useEditor = create<EditorState>((set, get) => ({
  code: initialCode,
  exampleId: initialExample,
  breakpoints: Array.isArray(saved.breakpoints) ? saved.breakpoints : [],
  syntaxError: null,
  setCode(code) {
    const ex = get().exampleId ? exampleById(get().exampleId as string) : undefined;
    set({ code, exampleId: ex && ex.code === code ? ex.id : null });
  },
  loadExample(id) {
    const ex = exampleById(id);
    if (ex) set({ code: ex.code, exampleId: ex.id, breakpoints: [], syntaxError: null });
  },
  toggleBreakpoint(line) {
    const bps = get().breakpoints;
    set({ breakpoints: bps.some((b) => b.line === line) ? bps.filter((b) => b.line !== line) : [...bps, { line }].sort((a, b) => a.line - b.line) });
  },
  setBreakpointCondition(line, condition) {
    const bps = get().breakpoints.filter((b) => b.line !== line);
    set({ breakpoints: [...bps, { line, condition: condition?.trim() || undefined }].sort((a, b) => a.line - b.line) });
  },
  moveBreakpoints(lines) {
    const bps = get().breakpoints;
    if (lines.length !== bps.length) return;
    set({ breakpoints: bps.map((b, i) => ({ ...b, line: lines[i] })) });
  },
  clearBreakpoints() {
    set({ breakpoints: [] });
  },
  setSyntaxError(err) {
    set({ syntaxError: err });
  },
}));

useEditor.subscribe((s) => saveJSON('algoscope.editor', { code: s.code, exampleId: s.exampleId, breakpoints: s.breakpoints }));
