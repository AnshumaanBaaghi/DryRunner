/**
 * HUD lines for a graph traversal: the node expanded (or returned to), the edge being examined and what
 * the neighbor is (new / already visited / in the queue), distances relaxed, edges added to the adjacency.
 */
import type { Timeline } from '../../engine/timeline/types';
import type { Detection } from '../types';
import type { GraphBindings } from './detect';
import { buildGraphModel } from './model';
import { currentAt, expansions, frontierAt, visitedAt } from './state';
import { edgesAt, edgeKey, type NodeId } from './structure';

/** more edges than this added in one step (a literal) are summed up */
const MAX_ADDED = 3;

function addedEdges(tl: Timeline, b: GraphBindings, i: number): { from: NodeId; to: NodeId }[] {
  const at = (s: number) => edgesAt(tl, tl.snapshots[s], b.objId, b.kind) ?? [];
  const before = new Set(at(i - 1).map((e) => edgeKey(e.from, e.to)));
  return at(i).filter((e) => !before.has(edgeKey(e.from, e.to)));
}

/** What the neighbor is when the edge is looked at: the code's own visited check decides when it has one. */
function status(tl: Timeline, b: GraphBindings, i: number, to: NodeId): string {
  const visited = visitedAt(tl, b, i - 1).has(to);
  if (b.visited) return visited ? 'already visited' : 'new';
  if (frontierAt(tl, b, i - 1).has(to)) return b.frontierShape?.kind === 'stack' ? 'on the stack' : 'in the queue';
  return visited ? 'already visited' : 'new';
}

export function describeGraph(tl: Timeline, i: number, d: Detection<GraphBindings>): string[] {
  const b = d.bindings;
  const diff = tl.diffs[i];
  if (i === 0 || !diff) return [];
  const label = (id: NodeId) => b.nodes.find((n) => n.id === id)?.label ?? id;
  const out: string[] = [];
  const added = addedEdges(tl, b, i);
  if (added.length > MAX_ADDED) out.push(`graph: ${b.nodes.length} nodes · ${buildGraphModel(tl, i, b, null).edges.length} edges`);
  else for (const e of added) out.push(`add edge ${label(e.from)} → ${label(e.to)}`);
  const m = buildGraphModel(tl, i, b, { diff, reversed: false, key: `f${i}` });
  const assigned = (bids: number[] | undefined) => diff.vars.some((c) => bids?.includes(c.bid));
  // an edge list's loop takes one edge at a time: the edge says it all
  const byEdge = b.kind === 'edges';
  if (m.current !== null && !byEdge) {
    // a priority queue may hold a node twice (lazy deletion): the stale entry comes out again
    const again = (expansions(tl, b).get(m.current) ?? []).some((s) => s < i);
    if (assigned(b.current?.bids)) out.push(`expand ${label(m.current)}${again ? ' again' : ''}`);
    else if (m.current !== currentAt(tl, b, i - 1)) out.push(`back to ${label(m.current)}`);
  }
  if (m.examined && assigned(b.neighbor?.bids)) {
    const weight = m.edges.find((e) => e.state === 'examined')?.weight;
    const edge = `edge ${label(m.examined.from)} → ${label(m.examined.to)}${weight ? ` (w=${weight})` : ''}`;
    out.push(byEdge ? edge : `${edge}: ${status(tl, b, i, m.examined.to)}`);
  }
  if (m.relaxed) out.push(`relax ${label(m.relaxed.node)}: ${m.relaxed.was} → ${m.relaxed.now}`);
  return out;
}
