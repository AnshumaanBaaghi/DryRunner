/** Helpers for showing a chosen variable with a chosen view ("role mapping" from the view menu). */
import type { ObjInfo } from '../engine/detect/analysis';
import { varKey, type VarRef } from '../engine/detect/track';
import type { HeapKind } from '../engine/types/values';
import type { DetectContext } from './types';

/** The heap objects of the given kinds the variable holds at some step, in allocation order. */
export function heldObjects(ctx: DetectContext, ref: VarRef, kinds: readonly HeapKind[]): ObjInfo[] {
  const info = ctx.analysis.vars.get(varKey(ref));
  return [...(info?.heapIds ?? [])]
    .map((id) => ctx.analysis.objects.get(id))
    .filter((o): o is ObjInfo => o !== undefined && kinds.includes(o.kind))
    .sort((a, b) => a.allocStep - b.allocStep);
}

/** Key of a view the user bound (stable across re-runs of the same code). */
export const boundKey = (vizId: string, ref: VarRef) => `bound:${vizId}:${varKey(ref)}`;

/** Claims of a bound view: its variable and every object it shows. */
export const boundClaims = (ref: VarRef, objs: ObjInfo[]) => [varKey(ref), ...objs.map((o) => `obj:${o.id}`)];
