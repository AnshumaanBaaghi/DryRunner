/**
 * Global playback shortcuts. Listens in the capture phase so focused widgets (e.g. a tab you just clicked)
 * don't swallow the arrows; widgets that genuinely need keys (editor, inputs, dialogs, menus, sliders) keep them.
 */
import { useEffect } from 'react';
import { usePlayback } from '../state/playbackStore';
import { useUi } from '../state/uiStore';
import { exitStageFullscreen, toggleStageFullscreen } from './stage/fullscreen';

const OWN_KEYS = '.monaco-editor, [role="dialog"], [role="menu"], [role="listbox"], [role="slider"], [role="combobox"]';

function ownsKey(target: EventTarget | null, key: string): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  // a focused button activates natively on Space/Enter; don't toggle playback twice
  if (el.tagName === 'BUTTON' && (key === ' ' || key === 'Enter')) return true;
  if (el.closest(OWN_KEYS)) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || ownsKey(e.target, e.key)) return;
      const pb = usePlayback.getState();
      let handled = true;
      switch (e.key) {
        case ' ':
          pb.toggle();
          break;
        case 'ArrowRight':
          if (e.shiftKey) pb.over();
          else pb.forward();
          break;
        case 'ArrowLeft':
          pb.back();
          break;
        case 'ArrowDown':
          pb.into();
          break;
        case 'ArrowUp':
          pb.out();
          break;
        case 'n':
        case 'N':
          pb.nextIter();
          break;
        case 'f':
        case 'F':
          toggleStageFullscreen();
          break;
        case 'Escape':
          // the browser leaves its own full screen on Esc; the fill-the-window mode needs this
          if (useUi.getState().stageFullscreen === 'off') handled = false;
          else exitStageFullscreen();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);
}
