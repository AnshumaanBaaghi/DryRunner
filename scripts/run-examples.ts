/**
 * Runs every bundled example through the engine and prints the detected visualizations next to what the
 * example expects. Examples whose expected visualizer isn't registered yet are listed as pending.
 * Usage: npm run examples [-- <example-id> …]   (exit code 1 on a mismatch)
 */
import { compileAndRun } from '../src/engine/compileAndRun';
import { buildTimeline } from '../src/engine/timeline/builder';
import { EXAMPLES } from '../src/examples';
import { visualizers } from '../src/visualizers/registry';
import { detectAll, selectDetections } from '../src/visualizers/select';

const only = new Set(process.argv.slice(2));
const registered = new Set(visualizers().map((v) => v.id));
const label = (id: string, mode?: string) => (mode ? `${id}(${mode})` : id);
let failures = 0;

for (const ex of EXAMPLES) {
  if (only.size && !only.has(ex.id)) continue;
  const r = await compileAndRun(ex.code);
  if (!r.ok) {
    failures += 1;
    console.log(`✗ ${ex.id.padEnd(18)} compile error: ${r.error.message}`);
    continue;
  }
  const tl = buildTimeline(r.meta, r.events);
  const { all, errors } = detectAll(tl);
  const active = selectDetections(all);
  const primary = active.find((d) => d.role === 'primary');
  const shown = active.map((d) => `${label(d.vizId, d.mode)}:${d.title}`).join(', ') || '—';
  const want = label(ex.expect.primary, ex.expect.mode) + (ex.expect.also?.length ? ` + ${ex.expect.also.join(', ')}` : '');
  const pending = [ex.expect.primary, ...(ex.expect.also ?? [])].some((id) => !registered.has(id));
  const ok = primary?.vizId === ex.expect.primary && (!ex.expect.mode || primary.mode === ex.expect.mode)
    && (ex.expect.also ?? []).every((id) => active.some((d) => d.vizId === id));
  const mark = ok ? '✓' : pending ? '·' : '✗';
  if (!ok && !pending) failures += 1;
  console.log(`${mark} ${ex.id.padEnd(18)} ${String(tl.steps.length - 1).padStart(5)} steps  shows ${shown}   expects ${want}${!ok && pending ? '  (pending: visualizer not built yet)' : ''}`);
  for (const e of errors) console.log(`    detector ${e.vizId} failed: ${e.message}`);
}
console.log(failures ? `\n${failures} example(s) detected differently than expected` : '\nall checkable examples match');
process.exit(failures ? 1 : 0);
