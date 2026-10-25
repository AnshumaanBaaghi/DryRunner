/**
 * Center stage. Phase 1 hosts the HUD over an empty stage; the 3D canvas mounts here from Phase 2.
 */
import { Boxes, MousePointerClick } from 'lucide-react';
import { useRun } from '../../state/runStore';
import { Hud } from '../hud/Hud';

export function StageArea() {
  const timeline = useRun((s) => s.timeline);
  const status = useRun((s) => s.status);
  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-bg" data-testid="stage">
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 35%, rgba(59,130,246,0.10), transparent 55%), linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 32px 32px, 32px 32px',
        }}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
        {!timeline && status !== 'compiling' ? (
          <div className="max-w-sm space-y-2 text-ink-faint">
            <MousePointerClick className="mx-auto" size={28} />
            <div className="text-sm">Pick an example or paste your JavaScript, then press <b className="text-ink-dim">Visualize</b> (⌘/Ctrl + Enter).</div>
          </div>
        ) : (
          <div className="max-w-xs space-y-2 text-ink-faint/70">
            <Boxes className="mx-auto" size={26} />
            <div className="text-xs">The 3D stage arrives in the next phase. The dry run — HUD, variables, trace table, breakpoints and watches — is live.</div>
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-3 top-3 flex">
        <Hud />
      </div>
    </div>
  );
}
