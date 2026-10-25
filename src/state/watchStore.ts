import { create } from 'zustand';
import { loadJSON, saveJSON } from './storage';

export interface Watch {
  id: number;
  expr: string;
}

interface WatchState {
  watches: Watch[];
  add(expr: string): void;
  update(id: number, expr: string): void;
  remove(id: number): void;
}

const saved = loadJSON<Watch[]>('algoscope.watches', []);
let nextId = saved.reduce((m, w) => Math.max(m, w.id), 0) + 1;

export const useWatches = create<WatchState>((set, get) => ({
  watches: Array.isArray(saved) ? saved : [],
  add(expr) {
    const e = expr.trim();
    if (!e) return;
    set({ watches: [...get().watches, { id: nextId++, expr: e }] });
  },
  update(id, expr) {
    set({ watches: get().watches.map((w) => (w.id === id ? { ...w, expr: expr.trim() } : w)).filter((w) => w.expr) });
  },
  remove(id) {
    set({ watches: get().watches.filter((w) => w.id !== id) });
  },
}));

useWatches.subscribe((s) => saveJSON('algoscope.watches', s.watches));
