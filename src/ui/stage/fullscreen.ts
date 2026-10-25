/**
 * Full-screen mode for the 3D stage: the stage covers the window and the page asks for the browser's full
 * screen, so its bars go away too. Where that isn't allowed (iPhone Safari only lets videos go full
 * screen) the stage still fills the window. The whole page goes full screen rather than the stage alone,
 * so menus, tooltips and dialogs keep showing. Browsers grant full screen only inside a click or key
 * handler, which is where these are called from.
 */
import { useUi } from '../../state/uiStore';

type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'];

function fullscreenElement(): Element | null {
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

function leaveBrowserFullscreen(): void {
  const d = document as FsDocument;
  const exit = d.exitFullscreen?.bind(d) ?? d.webkitExitFullscreen?.bind(d);
  try {
    void Promise.resolve(exit?.()).catch(() => undefined);
  } catch {
    // already leaving
  }
}

export function enterStageFullscreen(): void {
  const ui = useUi.getState();
  if (ui.stageFullscreen !== 'off') return;
  // fill the window right away; the browser's full screen follows if it is granted
  ui.setStageFullscreen('window');
  const root = document.documentElement as FsElement;
  const request = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root);
  try {
    void Promise.resolve(request?.()).catch(() => undefined);
  } catch {
    // not allowed here: the stage still fills the window
  }
}

export function exitStageFullscreen(): void {
  useUi.getState().setStageFullscreen('off');
  if (fullscreenElement()) leaveBrowserFullscreen();
}

export function toggleStageFullscreen(): void {
  if (useUi.getState().stageFullscreen === 'off') enterStageFullscreen();
  else exitStageFullscreen();
}

/** Keeps the mode in step with the browser: leaving its full screen (Esc, the browser's own UI) ends the mode. */
export function watchFullscreen(): () => void {
  const onChange = () => {
    const ui = useUi.getState();
    if (!fullscreenElement()) {
      if (ui.stageFullscreen === 'browser') ui.setStageFullscreen('off');
    } else if (ui.stageFullscreen === 'window') {
      ui.setStageFullscreen('browser');
    } else if (ui.stageFullscreen === 'off') {
      // granted only after the user had already left the mode
      leaveBrowserFullscreen();
    }
  };
  for (const e of CHANGE_EVENTS) document.addEventListener(e, onChange);
  return () => {
    for (const e of CHANGE_EVENTS) document.removeEventListener(e, onChange);
  };
}
