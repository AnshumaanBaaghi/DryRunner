import { create } from 'zustand';
import type { StaticAnalysis } from '../engine/types/meta';
import { loadJSON, saveJSON } from './storage';

export type MobileTab = 'code' | 'vars' | 'console';

interface UiState {
  tableOpen: boolean;
  /** mobile bottom sheet (separate from the desktop table so phones start uncluttered) */
  sheetOpen: boolean;
  settingsOpen: boolean;
  entryFunctions: StaticAnalysis['functions'] | null;
  conditionLine: number | null;
  mobileTab: MobileTab;
  hiddenColumns: string[];
  setTableOpen(open: boolean): void;
  setSheetOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  openEntryDialog(fns: StaticAnalysis['functions']): void;
  closeEntryDialog(): void;
  editCondition(line: number | null): void;
  setMobileTab(tab: MobileTab): void;
  toggleColumn(name: string): void;
}

const saved = loadJSON<{ tableOpen?: boolean; hiddenColumns?: string[] }>('algoscope.ui', {});

export const useUi = create<UiState>((set, get) => ({
  tableOpen: saved.tableOpen ?? true,
  sheetOpen: false,
  settingsOpen: false,
  entryFunctions: null,
  conditionLine: null,
  mobileTab: 'code',
  hiddenColumns: Array.isArray(saved.hiddenColumns) ? saved.hiddenColumns : [],
  setTableOpen: (open) => set({ tableOpen: open }),
  setSheetOpen: (open) => set({ sheetOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openEntryDialog: (fns) => set({ entryFunctions: fns }),
  closeEntryDialog: () => set({ entryFunctions: null }),
  editCondition: (line) => set({ conditionLine: line }),
  setMobileTab: (tab) => set({ mobileTab: tab }),
  toggleColumn(name) {
    const hidden = get().hiddenColumns;
    set({ hiddenColumns: hidden.includes(name) ? hidden.filter((h) => h !== name) : [...hidden, name] });
  },
}));

useUi.subscribe((s) => saveJSON('algoscope.ui', { tableOpen: s.tableOpen, hiddenColumns: s.hiddenColumns }));
