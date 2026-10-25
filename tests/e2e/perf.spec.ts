import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/** About 20 000 steps: the default step limit cuts the run there. */
const PROGRAM = `const cells = new Array(64).fill(0);
let total = 0;
for (let i = 0; i < 100000; i++) {
  cells[i % 64] += i;
  total += cells[i % 64] % 7;
}
console.log(total);`;

test('a 20k-step trace builds in under 300 ms and any step is ready in under 5 ms', async ({ page }, info) => {
  await openApp(page);
  const r = await page.evaluate(
    (src) => (window as unknown as { __algoscope: { bench(s: string): Promise<{ steps: number; build: number; access: number }> } }).__algoscope.bench(src),
    PROGRAM,
  );
  info.annotations.push({ type: 'perf', description: `${info.project.name}: ${r.steps} steps, build ${r.build.toFixed(1)} ms, worst step ${r.access.toFixed(2)} ms` });
  console.log(`[perf] ${info.project.name}: ${r.steps} steps, build ${r.build.toFixed(1)} ms, worst step ${r.access.toFixed(2)} ms`);
  expect(r.steps).toBeGreaterThanOrEqual(19_000);
  expect(r.build).toBeLessThan(300);
  expect(r.access).toBeLessThan(5);
});
