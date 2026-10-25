/** Full-screen mode against a mocked document (London-school): entering, the browser's answer and leaving. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../../src/state/uiStore';
import { enterStageFullscreen, exitStageFullscreen, toggleStageFullscreen, watchFullscreen } from '../../src/ui/stage/fullscreen';

/** A document whose browser grants (or refuses) full screen; `change` plays the browser switching it. */
class MockDocument {
  fullscreenElement: object | null = null;
  webkitFullscreenElement: object | null = null;
  documentElement: { requestFullscreen?: () => Promise<void>; webkitRequestFullscreen?: () => void };
  exitFullscreen = vi.fn(() => Promise.resolve());
  private listeners = new Map<string, Set<() => void>>();
  constructor(answer: 'grant' | 'refuse' | 'webkit') {
    this.documentElement = answer === 'webkit'
      ? { webkitRequestFullscreen: vi.fn() }
      : { requestFullscreen: vi.fn(() => (answer === 'grant' ? Promise.resolve() : Promise.reject(new Error('NotAllowedError')))) };
  }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  change(on: boolean, prefix: '' | 'webkit' = '') {
    if (prefix) this.webkitFullscreenElement = on ? this.documentElement : null;
    else this.fullscreenElement = on ? this.documentElement : null;
    for (const fn of this.listeners.get(`${prefix}fullscreenchange`) ?? []) fn();
  }
  get listening() {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}

const mode = () => useUi.getState().stageFullscreen;
let doc: MockDocument;
let stop: () => void;

function setup(answer: 'grant' | 'refuse' | 'webkit') {
  doc = new MockDocument(answer);
  vi.stubGlobal('document', doc);
  stop = watchFullscreen();
}

describe('stage full screen', () => {
  beforeEach(() => useUi.setState({ stageFullscreen: 'off' }));
  afterEach(() => {
    stop();
    expect(doc.listening).toBe(0);
    vi.unstubAllGlobals();
  });

  it('fills the window at once, then follows the browser into and out of its full screen', () => {
    setup('grant');
    enterStageFullscreen();
    expect(mode()).toBe('window');
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    doc.change(true);
    expect(mode()).toBe('browser');
    // Esc or the browser's own controls
    doc.change(false);
    expect(mode()).toBe('off');
  });

  it('keeps filling the window when the browser refuses', async () => {
    setup('refuse');
    enterStageFullscreen();
    await Promise.resolve();
    expect(mode()).toBe('window');
    exitStageFullscreen();
    expect(mode()).toBe('off');
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });

  it('leaving the mode also leaves the browser full screen', () => {
    setup('grant');
    enterStageFullscreen();
    doc.change(true);
    exitStageFullscreen();
    expect(mode()).toBe('off');
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('undoes full screen granted after the user already left', () => {
    setup('grant');
    toggleStageFullscreen();
    toggleStageFullscreen();
    expect(mode()).toBe('off');
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    doc.change(true);
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(mode()).toBe('off');
  });

  it('uses the prefixed API of older Safari', () => {
    setup('webkit');
    enterStageFullscreen();
    expect(doc.documentElement.webkitRequestFullscreen).toHaveBeenCalledTimes(1);
    doc.change(true, 'webkit');
    expect(mode()).toBe('browser');
    doc.change(false, 'webkit');
    expect(mode()).toBe('off');
  });
});
