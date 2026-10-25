/** The code editor, loaded on demand (Monaco is most of the app's weight); the code shows as plain text meanwhile. */
import { lazy, Suspense } from 'react';
import { useEditor } from '../../state/editorStore';

const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })));

function CodePreview() {
  const code = useEditor((s) => s.code);
  return (
    <div className="as-scroll h-full overflow-auto py-1.5 font-mono text-[13px] leading-[19px]" data-testid="code-preview" aria-busy="true">
      {code.split('\n').map((line, k) => (
        <div key={k} className="flex">
          <span className="w-10 shrink-0 select-none pr-3 text-right text-ink-faint">{k + 1}</span>
          <span className="whitespace-pre text-ink-dim">{line}</span>
        </div>
      ))}
    </div>
  );
}

export function LazyCodeEditor() {
  return (
    <Suspense fallback={<CodePreview />}>
      <CodeEditor />
    </Suspense>
  );
}
