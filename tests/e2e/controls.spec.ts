import { expect, test } from '@playwright/test';
import { EXAMPLES } from '../../src/examples';
import { counter, openApp, runCode, selectExample } from './helpers';

test('step over / into / out on recursion', async ({ page }) => {
  await openApp(page);
  await selectExample(page, 'fibonacci');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('hud-title')).toHaveText('fib(4) called from fib(5) (line 3)');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByTestId('hud-title')).toHaveText('fib(3) called from fib(5) (line 3)');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('hud-title')).toHaveText('fib(5) returns 5');
  await expect(page.getByTestId('callstack')).toContainText('fib(5)');
});

test('breakpoints, conditional breakpoints and watches', async ({ page }) => {
  await openApp(page);
  await runCode(page, `function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
console.log(fib(4));`);
  // click the glyph margin of line 3
  const glyph = (await page.locator('.monaco-editor .glyph-margin').boundingBox())!;
  const line3 = (await page.locator('.monaco-editor .view-line').nth(2).boundingBox())!;
  await page.mouse.click(glyph.x + glyph.width / 2, line3.y + line3.height / 2);
  await expect(page.locator('.monaco-editor .as-bp')).toHaveCount(1);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play');
  await expect(page.getByTestId('hud-title')).toHaveText('fib(3) called from fib(4) (line 3)');

  // conditional: pause on line 2 only when n === 0 (evaluated before the line runs)
  await page.mouse.click(glyph.x + glyph.width / 2, line3.y + line3.height / 2); // remove line-3 breakpoint
  const line2 = (await page.locator('.monaco-editor .view-line').nth(1).boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.click(glyph.x + glyph.width / 2, line2.y + line2.height / 2);
  await page.keyboard.up('Shift');
  await page.getByPlaceholder('condition (empty = always pause)').fill('n === 0');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.monaco-editor .as-bp-cond')).toHaveCount(1);
  await page.getByRole('button', { name: 'Go to start' }).click();
  await page.getByTestId('play').click();
  await expect(page.getByTestId('play')).toHaveAttribute('aria-label', 'Play');
  await expect(page.getByTestId('hud-title')).toContainText('Condition is true');
  await expect(page.getByTestId('locals')).toContainText('fib(0)');

  await page.getByLabel('New watch expression').fill('n + 100');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('watch-value')).toHaveText('100');
});

test('entry dialog for code that only defines functions', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const h = (window as unknown as { __algoscope: { editor: { getState(): { setCode(c: string): void } } } }).__algoscope;
    h.editor.getState().setCode('function square(x) {\n  return x * x;\n}\n');
  });
  await page.getByTestId('visualize').click();
  await expect(page.getByTestId('entry-dialog')).toBeVisible();
  await page.getByPlaceholder("e.g. [1, 2, 3] or 'abc' or 5").fill('7');
  await page.getByTestId('entry-run').click();
  await expect(page.getByTestId('entry-dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Go to end' }).click();
  await expect(page.getByTestId('console')).toContainText('49');
});

test('trace table export copies a markdown table', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __copied: string }).__copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => { (window as unknown as { __copied: string }).__copied = t; } },
      configurable: true,
    });
  });
  await openApp(page);
  await runCode(page, 'let s = 0;\nfor (let i = 0; i < 3; i++) s += i;');
  await page.getByTestId('export').click();
  await page.getByRole('menuitem', { name: 'Copy as Markdown' }).click();
  const md = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
  expect(md.split('\n')[0]).toContain('| Step | Line | Frame | Loops | Event | s | i | Output |');
  expect(md).toContain('s += i → s = 1 + 2 = 3');
});

test('every example runs and scrubs forward and backward without errors', async ({ page }) => {
  test.setTimeout(240_000);
  const { errors } = await openApp(page);
  for (const ex of EXAMPLES) {
    await selectExample(page, ex.id);
    const { last } = await counter(page);
    expect(last, ex.id).toBeGreaterThan(5);
    for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowRight');
    for (let k = 0; k < 2; k++) await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('step-counter')).toHaveText(`Step 2 / ${last}`);
    await page.getByRole('button', { name: 'Go to end' }).click();
    await expect(page.getByTestId('hud-title')).toHaveText('Program finished.');
  }
  expect(errors).toEqual([]);
});

test('mobile layout stacks panels and shows the trace table as a bottom sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await expect(page.getByTestId('stage')).toBeVisible();
  await page.getByRole('tab', { name: 'Variables' }).click();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('locals')).toBeVisible();
  await page.getByTestId('toggle-table').click();
  await expect(page.getByTestId('trace-table')).toBeInViewport();
});
