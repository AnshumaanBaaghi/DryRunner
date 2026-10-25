import { expect, test } from '@playwright/test';
import { counter, expectLine, hudChain, openApp, runCode } from './helpers';

const LOOP = `let sum = 0;
for (let i = 0; i < 5; i++) {
  sum += i;
}`;

// line highlighted after each step 1..19 (19 = end: no highlight)
const LINES = [1, 2, 2, 3, 2, 2, 3, 2, 2, 3, 2, 2, 3, 2, 2, 3, 2, 2, null];

test('acceptance: the simple loop dry run shows every iteration, check and change', async ({ page }) => {
  const { errors, external } = await openApp(page);
  await runCode(page, LOOP);
  expect(await counter(page)).toEqual({ step: 0, last: 19 });
  for (let k = 1; k <= 19; k++) {
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('step-counter')).toHaveText(`Step ${k} / 19`);
    await expectLine(page, LINES[k - 1], `editor line at step ${k}`);
    if (k === 3) expect(await hudChain(page)).toBe('i < 5 → 0 < 5 → true');
    if (k === 16) {
      expect(await hudChain(page)).toBe('sum += i → sum = 6 + 4 = 10');
      await expect(page.getByTestId('var-sum')).toHaveAttribute('data-changed', 'true');
      await expect(page.getByTestId('var-sum-delta')).toHaveText('6→10');
    }
    if (k === 18) {
      expect(await hudChain(page)).toBe('i < 5 → 5 < 5 → false');
      await expect(page.getByTestId('hud-title')).toContainText('exits after 5 iterations');
    }
  }
  // trace table: one row per step; sum cells change 0 → 0 → 1 → 3 → 6 → 10
  const sumCells: string[] = [];
  for (const row of [4, 7, 10, 13, 16]) {
    const r = page.getByTestId(`trace-row-${row}`);
    await r.scrollIntoViewIfNeeded();
    const cell = r.locator('[data-state="changed"], [data-state="same"]').first();
    sumCells.push(`${await cell.getAttribute('data-state')}:${await cell.textContent()}`);
  }
  expect(sumCells).toEqual(['same:0', 'changed:1', 'changed:3', 'changed:6', 'changed:10']);
  // clicking a row jumps everywhere at once
  await page.getByTestId('trace-row-7').click();
  await expect(page.getByTestId('step-counter')).toHaveText('Step 7 / 19');
  await expectLine(page, 3);
  // stepping back restores state
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('step-counter')).toHaveText('Step 6 / 19');
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('nested loops: both counters, next iteration escalates to the outer loop', async ({ page }) => {
  await openApp(page);
  await runCode(page, `for (let i = 0; i < 2; i++) {
  for (let j = 0; j < 3; j++) {
    console.log(i, j);
  }
}`);
  for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('hud-loops')).toContainText('i = 0');
  await expect(page.getByTestId('hud-loops')).toContainText('j = 0');
  for (let k = 0; k < 3; k++) await page.keyboard.press('n');
  await expect(page.getByTestId('hud-title')).toContainText('exits after 3 iterations');
  await page.keyboard.press('n');
  await expect(page.getByTestId('hud-title')).toContainText('iteration 2');
  await expect(page.getByTestId('hud-loops')).toContainText('i = 1');
});

test('runaway code never freezes the tab and stays playable', async ({ page }) => {
  await openApp(page);
  await runCode(page, 'let i = 0;\nwhile (true) {\n  i++;\n}');
  const { last } = await counter(page);
  expect(last).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'Go to end' }).click();
  await expect(page.getByTestId('hud-title')).toContainText('step limit');
  await runCode(page, 'function down(n) {\n  return down(n + 1);\n}\ndown(0);');
  await page.getByRole('button', { name: 'Go to end' }).click();
  await expect(page.getByTestId('hud-title')).toContainText('recursion depth');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('hud-title')).toContainText('called from');
});

test('runtime errors point at the failing line; compile errors are friendly', async ({ page }) => {
  await openApp(page);
  await runCode(page, 'const node = null;\nconsole.log(node.val);');
  await page.getByRole('button', { name: 'Go to end' }).click();
  await page.keyboard.press('ArrowLeft');
  // the message is the engine's own (V8: "Cannot read properties of null", JSC: "null is not an object")
  await expect(page.getByTestId('hud-title')).toHaveText(/^TypeError: .*(null).*\(line 2\)$/);
  await expectLine(page, 2);
  await runCode(page, 'let x = ;');
  await expect(page.getByTestId('hud')).toContainText("Can't run this code");
});
