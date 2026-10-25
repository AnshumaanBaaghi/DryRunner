export type VizId =
  | 'scalars' | 'array' | 'recursionTree' | 'callStack' | 'backtracking' | 'memo' | 'dp1d' | 'dp2d'
  | 'stack' | 'queue' | 'linkedList' | 'hashMap' | 'tree' | 'graph' | 'gridGraph';

export interface Example {
  id: string;
  title: string;
  category: string;
  code: string;
  /** Expected detection (verified from Phase 7 on): primary visualizer and others that must also appear. */
  expect: { primary: VizId; also?: VizId[]; mode?: string };
}
