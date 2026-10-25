import { expect, type Page } from '@playwright/test';

export interface Hook {
  editor: { getState(): { setCode(code: string): void; toggleBreakpoint(line: number): void } };
  run: { getState(): { status: string; visualize(o?: { skipEntryCheck?: boolean }): Promise<void>; timeline: { steps: unknown[] } | null } };
  playback: { getState(): { step: number; goto(i: number): void } };
}

/** Fresh app (cleared local storage), external requests and console errors recorded. */
export async function openApp(page: Page) {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== 'localhost' && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('as-cleared')) {
      localStorage.clear();
      sessionStorage.setItem('as-cleared', '1');
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('hud')).toBeVisible();
  await waitDone(page);
  return { errors, external };
}

export async function waitDone(page: Page) {
  await page.waitForFunction(() => {
    const h = (window as unknown as { __algoscope?: Hook }).__algoscope;
    return h && h.run.getState().status !== 'compiling' && h.run.getState().status !== 'running';
  });
}

export async function runCode(page: Page, code: string) {
  await page.evaluate((src) => {
    const h = (window as unknown as { __algoscope: Hook }).__algoscope;
    h.editor.getState().setCode(src);
    void h.run.getState().visualize({ skipEntryCheck: true });
  }, code);
  await page.waitForTimeout(50);
  await waitDone(page);
}

export async function selectExample(page: Page, id: string) {
  await page.getByTestId('examples-trigger').click();
  await page.getByTestId(`example-${id}`).click();
  await page.waitForTimeout(50);
  await waitDone(page);
}

export async function counter(page: Page): Promise<{ step: number; last: number }> {
  const text = (await page.getByTestId('step-counter').textContent()) ?? '';
  const m = text.match(/Step (\d+) \/ (\d+)/);
  return { step: Number(m?.[1] ?? -1), last: Number(m?.[2] ?? -1) };
}

/** Line of the current-step whole-line decoration in Monaco (null when none), matched via the gutter. */
export async function highlightedLine(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const el = document.querySelector('.monaco-editor .view-overlays .as-line-current, .monaco-editor .view-overlays .as-line-error') as HTMLElement | null;
    if (!el) return null;
    const top = (el.parentElement as HTMLElement).style.top;
    for (const n of document.querySelectorAll('.monaco-editor .margin-view-overlays .line-numbers')) {
      if ((n.parentElement as HTMLElement).style.top === top) return Number(n.textContent);
    }
    return -1;
  });
}

/** Polls until the editor highlight settles on `expected` (Monaco paints decorations on the next frame). */
export async function expectLine(page: Page, expected: number | null, message?: string) {
  await expect.poll(() => highlightedLine(page), { message, timeout: 3000 }).toBe(expected);
}

export async function hudChain(page: Page): Promise<string> {
  const parts = await page.getByTestId('hud-chain').locator(':scope > span').allTextContents().catch(() => []);
  return parts.map((p) => p.trim()).join(' → ');
}
