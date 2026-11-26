import { expect, test, type Page } from '@playwright/test';
import { OBSTACLE_PATH } from '../visualizers/gridGraph/cases';
import { counter, openApp, runCode, selectExample, waitDone, type Hook } from './helpers';

/** What each example must show without any override (primary view first, then the others). */
const CASES: { id: string; viz: string; mode: string; also?: string[] }[] = [
  { id: 'loop-sum', viz: 'scalars', mode: '' },
  { id: 'nested-pairs', viz: 'scalars', mode: 'iteration-space' },
  { id: 'longest-substring', viz: 'array', mode: 'window', also: ['hashMap'] },
  { id: 'two-sum-sorted', viz: 'array', mode: 'two-pointers' },
  { id: 'binary-search', viz: 'array', mode: 'binary-search' },
  { id: 'bubble-sort', viz: 'array', mode: 'sorting' },
  { id: 'quick-sort', viz: 'array', mode: 'sorting', also: ['recursionTree', 'callStack'] },
  { id: 'fibonacci', viz: 'recursionTree', mode: '', also: ['callStack'] },
  { id: 'factorial', viz: 'recursionTree', mode: '', also: ['callStack'] },
  { id: 'merge-sort', viz: 'recursionTree', mode: 'divide-and-conquer', also: ['callStack'] },
  { id: 'n-queens', viz: 'backtracking', mode: 'board' },
  { id: 'subsets', viz: 'backtracking', mode: 'path' },
  { id: 'permutations', viz: 'backtracking', mode: 'path' },
  { id: 'climbing-stairs', viz: 'dp1d', mode: '' },
  { id: 'lcs', viz: 'dp2d', mode: '' },
  { id: 'edit-distance', viz: 'dp2d', mode: '' },
  { id: 'knapsack', viz: 'dp2d', mode: '' },
  { id: 'fibonacci-memo', viz: 'memo', mode: '', also: ['callStack'] },
  { id: 'valid-parentheses', viz: 'stack', mode: '' },
  { id: 'next-greater', viz: 'stack', mode: 'monotonic' },
  { id: 'queue-simulation', viz: 'queue', mode: 'fifo' },
  { id: 'reverse-list', viz: 'linkedList', mode: '' },
  { id: 'bst-traversals', viz: 'tree', mode: '', also: ['queue'] },
  { id: 'max-depth', viz: 'tree', mode: '', also: ['callStack'] },
  { id: 'bfs', viz: 'graph', mode: '', also: ['queue', 'hashMap'] },
  { id: 'dfs', viz: 'graph', mode: '', also: ['callStack'] },
  { id: 'dijkstra', viz: 'graph', mode: 'distances', also: ['queue'] },
  { id: 'islands', viz: 'gridGraph', mode: '', also: ['callStack'] },
];

async function gotoStep(page: Page, i: number) {
  await page.evaluate((k) => (window as unknown as { __algoscope: Hook }).__algoscope.playback.getState().goto(k), i);
}

const primaryChip = (page: Page) => page.getByTestId('stage-viz').locator('[data-viz]').first();

interface Pose { p: number[]; q: number[] }
/** The 3D camera: moving the view shifts its position only, rotating also turns it. */
const cameraPose = (page: Page): Promise<Pose> => page.evaluate(() => {
  type Arr = { toArray(): number[] };
  const { camera } = (window as unknown as { __algoscopeThree: { camera: { position: Arr; quaternion: Arr } } }).__algoscopeThree;
  return { p: camera.position.toArray(), q: camera.quaternion.toArray() };
});
const gap = (a: number[], b: number[]) => Math.hypot(...a.map((v, k) => v - b[k]));

/** Waits until the opening camera move is over. */
async function settled(page: Page) {
  await expect.poll(async () => {
    const a = await cameraPose(page);
    await page.waitForTimeout(250);
    return gap(a.p, (await cameraPose(page)).p);
  }, { timeout: 10_000 }).toBeLessThan(1e-4);
}

async function canvasCenter(page: Page) {
  const box = (await page.getByTestId('stage-canvas').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Moving the view keeps the camera's orientation, rotating changes it — true while the camera still coasts
 * after a gesture (damping is per frame, so under software rendering it coasts for seconds).
 */
async function expectMoved(page: Page, before: Pose): Promise<Pose> {
  const after = await cameraPose(page);
  expect(gap(after.p, before.p)).toBeGreaterThan(0.05);
  expect(gap(after.q, before.q)).toBeLessThan(1e-3);
  return after;
}

async function expectRotated(page: Page, before: Pose) {
  expect(gap((await cameraPose(page)).q, before.q)).toBeGreaterThan(0.05);
}

test.describe('3D stage', () => {
  for (const c of CASES) {
    test(`${c.id} is shown as ${c.viz}${c.mode ? ` (${c.mode})` : ''} and animates both ways`, async ({ page }, info) => {
      const { errors, external } = await openApp(page);
      if (c.id !== 'loop-sum') await selectExample(page, c.id);
      await expect(primaryChip(page)).toHaveAttribute('data-viz', c.viz);
      await expect(primaryChip(page)).toHaveAttribute('data-mode', c.mode);
      for (const other of c.also ?? []) await expect(page.getByTestId('stage-viz').locator(`[data-viz="${other}"]`)).toHaveCount(1);
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

  test('a grid search backing out of its cells shows the grid, its recursion tree and the call stack', async ({ page }) => {
    const { errors } = await openApp(page);
    await runCode(page, OBSTACLE_PATH);
    await expect(primaryChip(page)).toHaveAttribute('data-viz', 'gridGraph');
    for (const other of ['recursionTree', 'callStack']) await expect(page.getByTestId('stage-viz').locator(`[data-viz="${other}"]`)).toHaveCount(1);
    // the first cell put back: grid[2][0] = 0 after its four calls returned
    const backOut = await page.evaluate(() => {
      type Diff = { heap: { op: string; old?: unknown; value?: unknown }[] };
      const run = (window as unknown as { __algoscope: { run: { getState(): { timeline: { diffs: Diff[] } } } } }).__algoscope.run.getState();
      return run.timeline.diffs.findIndex((d) => d.heap.some((h) => h.op === 'set' && h.old === 2 && h.value === 0));
    });
    await gotoStep(page, backOut);
    await expect(page.getByTestId('hud-viz')).toContainText('back out of (2,0)');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('hud-viz')).toContainText('back out of (2,0)');
    expect(errors).toEqual([]);
  });

  test('plugin notes describe how the window moves', async ({ page }) => {
    await openApp(page);
    await selectExample(page, 'longest-substring');
    // other views add notes too (hash-map lookups), so step until a window note shows up; the notes
    // element only exists while there are notes, so read the DOM without waiting for it
    const windowNote = /window (expanded|shrunk): (left|right) → \d+/;
    const notes = () => page.evaluate(() => document.querySelector('[data-testid="hud-viz"]')?.textContent ?? '');
    for (let k = 0; k < 60 && !windowNote.test(await notes()); k++) await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('hud-viz')).toContainText(windowNote);
  });

  test('the view menu picks the main view, binds a variable and returns to automatic', async ({ page }) => {
    const { errors } = await openApp(page);
    await selectExample(page, 'quick-sort');
    const trigger = page.getByTestId('view-trigger');
    await expect(trigger).toHaveText(/View: auto/);
    await trigger.click();
    await page.getByTestId('view-primary-recursionTree').click();
    await expect(primaryChip(page)).toHaveAttribute('data-viz', 'recursionTree');
    await expect(trigger).toHaveText(/View: custom/);
    await trigger.click();
    await page.getByTestId('view-bind').hover();
    await page.getByTestId('view-bind-arr').hover();
    await page.getByTestId('view-bind-arr-stack').click();
    await expect(primaryChip(page)).toHaveAttribute('data-viz', 'stack');
    // re-running the same code keeps the choice
    await page.getByTestId('visualize').click();
    await waitDone(page);
    await expect(primaryChip(page)).toHaveAttribute('data-viz', 'stack');
    await trigger.click();
    await page.getByTestId('view-auto').click();
    await expect(primaryChip(page)).toHaveAttribute('data-viz', 'array');
    await expect(trigger).toHaveText(/View: auto/);
    expect(errors).toEqual([]);
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

  test('a drag moves the view and a two-finger (right-button) drag rotates it', async ({ page }) => {
    const { errors } = await openApp(page);
    // camera follow off, so only the gestures move the camera
    await page.getByRole('button', { name: /Camera follows changes/ }).click();
    await settled(page);
    const drag = async (button: 'left' | 'right') => {
      const { x, y } = await canvasCenter(page);
      await page.mouse.move(x, y);
      await page.mouse.down({ button });
      for (let k = 1; k <= 10; k++) await page.mouse.move(x + k * 12, y + k * 4);
      await page.mouse.up({ button });
      await page.waitForTimeout(500);
    };
    const start = await cameraPose(page);
    await drag('left');
    const moved = await expectMoved(page, start);
    await drag('right');
    await expectRotated(page, moved);
    expect(errors).toEqual([]);
  });

  test.describe('on a touch screen', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'multi-touch is simulated through the Chrome DevTools Protocol');
    test.use({ hasTouch: true });

    test('one finger moves the view and two fingers rotate it', async ({ page }) => {
      const { errors } = await openApp(page);
      await page.getByRole('button', { name: /Camera follows changes/ }).click();
      await settled(page);
      const cdp = await page.context().newCDPSession(page);
      const swipe = async (fingers: number) => {
        const { x, y } = await canvasCenter(page);
        const at = (k: number) => Array.from({ length: fingers }, (_, f) => ({ x: x + f * 80 + k * 12, y: y + k * 4, id: f }));
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
        for (let k = 1; k <= 10; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(k) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(500);
      };
      const start = await cameraPose(page);
      await swipe(1);
      const moved = await expectMoved(page, start);
      await swipe(2);
      await expectRotated(page, moved);
      expect(errors).toEqual([]);
    });
  });

  test('full screen shows the 3D view with its own playback bar', async ({ page }, info) => {
    const { errors } = await openApp(page);
    await selectExample(page, 'bubble-sort');
    const stage = page.getByTestId('stage');
    await expect(stage).toHaveAttribute('data-fullscreen', 'off');
    await page.getByTestId('stage-fullscreen').click();
    await expect(stage).toHaveAttribute('data-fullscreen', /^(browser|window)$/);
    console.log(`[fullscreen] ${info.project.name}: ${await stage.getAttribute('data-fullscreen')}`);
    await expect(page.getByTestId('fs-playback')).toBeVisible();
    const view = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const box = (await stage.boundingBox())!;
    expect([box.x, box.y, Math.round(box.width), Math.round(box.height)]).toEqual([0, 0, view.w, view.h]);
    // its bar and the keyboard both step
    await page.getByTestId('fs-step-forward').click();
    await expect(page.getByTestId('fs-step-counter')).toHaveText(/^Step 1 \//);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('fs-step-counter')).toHaveText(/^Step 2 \//);
    // tooltips are drawn above the full-screen stage
    await page.mouse.move(5, 5);
    await page.getByTestId('fs-step-back').hover();
    const tip = page.locator('[data-radix-popper-content-wrapper]').last();
    await expect(tip).toContainText('Step back');
    expect(await tip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `tests/e2e/__screenshots__/${info.project.name}/fullscreen-bubble-sort.png` });
    await page.getByTestId('stage-exit-fullscreen').click();
    await expect(stage).toHaveAttribute('data-fullscreen', 'off');
    await expect(page.getByTestId('fs-playback')).toHaveCount(0);
    const inBrowserFullscreen = () => page.evaluate(() => {
      const d = document as Document & { webkitFullscreenElement?: Element | null };
      return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);
    });
    await expect.poll(inBrowserFullscreen).toBe(false);
    expect((await counter(page)).step).toBe(2);
    // F enters, Esc leaves
    await page.keyboard.press('f');
    await expect(stage).toHaveAttribute('data-fullscreen', /^(browser|window)$/);
    await page.keyboard.press('Escape');
    await expect(stage).toHaveAttribute('data-fullscreen', 'off');
    await expect.poll(inBrowserFullscreen).toBe(false);
    expect(errors).toEqual([]);
  });

  test('full screen on a phone keeps the playback bar on screen', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { errors } = await openApp(page);
    await selectExample(page, 'binary-search');
    await page.getByTestId('stage-fullscreen').click();
    await expect(page.getByTestId('fs-playback')).toBeVisible();
    const view = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const bar = (await page.getByTestId('fs-playback').boundingBox())!;
    expect(bar.x).toBeGreaterThanOrEqual(0);
    expect(bar.x + bar.width).toBeLessThanOrEqual(view.w);
    expect(bar.y + bar.height).toBeLessThanOrEqual(view.h);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(view.w);
    await page.getByTestId('fs-step-forward').click();
    await expect(page.getByTestId('fs-step-counter')).toHaveText(/^Step 1 \//);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `tests/e2e/__screenshots__/${info.project.name}/fullscreen-phone-binary-search.png` });
    await page.getByTestId('stage-exit-fullscreen').click();
    await expect(page.getByTestId('stage')).toHaveAttribute('data-fullscreen', 'off');
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
