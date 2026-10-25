import { expect, test, type Page } from '@playwright/test';
import { counter, openApp, runCode, selectExample, type Hook } from './helpers';

/** Phase 2 visualizers: what each example must show without any override. */
const CASES = [
  { id: 'loop-sum', viz: 'scalars', mode: '' },
  { id: 'nested-pairs', viz: 'scalars', mode: 'iteration-space' },
  { id: 'longest-substring', viz: 'array', mode: 'window' },
  { id: 'two-sum-sorted', viz: 'array', mode: 'two-pointers' },
  { id: 'binary-search', viz: 'array', mode: 'binary-search' },
  { id: 'bubble-sort', viz: 'array', mode: 'sorting' },
  { id: 'quick-sort', viz: 'array', mode: 'sorting' },
];

async function gotoStep(page: Page, i: number) {
  await page.evaluate((k) => (window as unknown as { __algoscope: Hook }).__algoscope.playback.getState().goto(k), i);
}

const primaryChip = (page: Page) => page.getByTestId('stage-viz').locator('[data-viz]').first();

test.describe('3D stage', () => {
  for (const c of CASES) {
    test(`${c.id} is shown as ${c.viz}${c.mode ? ` (${c.mode})` : ''} and animates both ways`, async ({ page }, info) => {
      const { errors, external } = await openApp(page);
      if (c.id !== 'loop-sum') await selectExample(page, c.id);
      await expect(primaryChip(page)).toHaveAttribute('data-viz', c.viz);
      await expect(primaryChip(page)).toHaveAttribute('data-mode', c.mode);
      await expect(page.getByTestId('stage-canvas').locator('canvas')).toBeVisible();

      for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowRight');
      for (let k = 0; k < 2; k++) await page.keyboard.press('ArrowLeft');
      expect((await counter(page)).step).toBe(2);
      const { last } = await counter(page);
      await gotoStep(page, last);
      await gotoStep(page, Math.round(last * 0.45));
      await page.waitForTimeout(1500);
      await page.getByTestId('stage').screenshot({ path: `tests/e2e/__screenshots__/${info.project.name}/${c.id}.png` });

      expect(errors).toEqual([]);
      expect(external).toEqual([]);
    });
  }

  test('plugin notes describe how the window moves', async ({ page }) => {
    await openApp(page);
    await selectExample(page, 'longest-substring');
    const note = page.getByTestId('hud-viz');
    for (let k = 0; k < 40 && !(await note.isVisible()); k++) await page.keyboard.press('ArrowRight');
    await expect(note).toContainText(/window (expanded|shrunk): (left|right) → \d+/);
  });

  test('camera and quality controls', async ({ page }) => {
    const { errors } = await openApp(page);
    const follow = page.getByRole('button', { name: /Camera follows changes/ });
    await expect(follow).toHaveAttribute('aria-pressed', 'true');
    await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed', 'false');
    const quality = page.getByRole('button', { name: /Quality:/ });
    await expect(quality).toHaveAttribute('aria-pressed', 'true');
    await quality.click();
    await expect(quality).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('stage-canvas').locator('canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Reset view' }).click();
    await page.keyboard.press('ArrowRight');
    expect((await counter(page)).step).toBe(1);
    // preferences survive a reload
    await page.reload();
    await expect(page.getByRole('button', { name: /Camera follows changes/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: /Quality:/ })).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
  });

  test('a runaway loop still gets a stage for its partial trace', async ({ page }) => {
    const { errors } = await openApp(page);
    await runCode(page, 'let n = 0;\nwhile (true) {\n  n++;\n}');
    await expect(primaryChip(page)).toHaveAttribute('data-viz', 'scalars');
    await expect(page.getByTestId('stage-canvas').locator('canvas')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    expect(errors).toEqual([]);
  });

  test('phone layout keeps the stage on screen', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { errors } = await openApp(page);
    await selectExample(page, 'binary-search');
    await expect(page.getByTestId('stage-canvas').locator('canvas')).toBeVisible();
    const box = (await page.getByTestId('stage').boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThan(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1200);
    await page.getByTestId('stage').screenshot({ path: `tests/e2e/__screenshots__/${info.project.name}/phone-binary-search.png` });
    expect(errors).toEqual([]);
  });
});
