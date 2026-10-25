/** Camera and render-quality controls over the canvas, plus chips naming the detected visualizations. */
import { Crosshair, Scan, Sparkles } from 'lucide-react';
import { useViz } from '../../state/vizStore';
import { visualizerById } from '../../visualizers/registry';
import { IconButton } from '../primitives';

const MODE_TEXT: Record<string, string> = {
  'iteration-space': 'nested loops', window: 'sliding window', 'two-pointers': 'two pointers', 'binary-search': 'binary search',
  sorting: 'sorting', pointers: 'indexed',
};

export function StageToolbar() {
  const follow = useViz((s) => s.follow);
  const quality = useViz((s) => s.quality);
  const active = useViz((s) => s.active);
  return (
    <>
      {active.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[60%] flex-wrap gap-1.5" data-testid="stage-viz">
          {active.map((d) => {
            const mode = d.mode ? MODE_TEXT[d.mode] : undefined;
            return (
              <span key={d.key} data-viz={d.vizId} data-mode={d.mode ?? ''}
                className="rounded-full border border-line-strong bg-panel/85 px-2 py-0.5 text-[11px] text-ink-dim backdrop-blur">
                <span className="text-ink">{visualizerById(d.vizId)?.label ?? d.vizId}</span>
                {d.vizId !== 'scalars' && <span className="font-mono"> · {d.title}</span>}
                {mode && <span className="text-hl-window"> · {mode}</span>}
              </span>
            );
          })}
        </div>
      )}
      <div className="absolute bottom-3 right-3 flex gap-0.5 rounded-lg border border-line bg-panel/85 p-0.5 backdrop-blur" data-testid="stage-toolbar">
        <IconButton label="Reset view" onClick={() => useViz.getState().resetView()}>
          <Scan size={15} />
        </IconButton>
        <IconButton label={follow ? 'Camera follows changes (on)' : 'Camera follows changes (off)'} active={follow}
          aria-pressed={follow} onClick={() => useViz.getState().setFollow(!follow)}>
          <Crosshair size={15} />
        </IconButton>
        <IconButton label={quality === 'high' ? 'Quality: high (bloom, soft shadows)' : 'Quality: low (faster)'} active={quality === 'high'}
          aria-pressed={quality === 'high'} onClick={() => useViz.getState().setQuality(quality === 'high' ? 'low' : 'high')}>
          <Sparkles size={15} />
        </IconButton>
      </div>
    </>
  );
}
