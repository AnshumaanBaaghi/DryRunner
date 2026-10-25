/**
 * Monaco with: current-step line + exact sub-range highlight, caller call-site highlight, glyph-margin
 * breakpoints (click toggles, shift/right-click edits the condition), syntax-error markers, Run to Line,
 * and ⌘/Ctrl+Enter to visualize.
 */
import Editor, { type OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import { monaco } from './monacoSetup';
import type { Loc } from '../../engine/types/meta';
import { sandbox } from '../../engine/sandbox/instance';
import { useEditor } from '../../state/editorStore';
import { usePlayback } from '../../state/playbackStore';
import { useRun } from '../../state/runStore';
import { useStepView } from '../../state/selectors';
import { useUi } from '../../state/uiStore';

type IEditor = Parameters<OnMount>[0];
type IDecorations = ReturnType<IEditor['createDecorationsCollection']>;
type DeltaDecoration = Parameters<IDecorations['set']>[0][number];

let themeDefined = false;
function defineTheme() {
  if (themeDefined) return;
  themeDefined = true;
  monaco.editor.defineTheme('algoscope', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c792ea' },
      { token: 'number', foreground: 'f5a524' },
      { token: 'string', foreground: '7dd3a0' },
    ],
    colors: {
      'editor.background': '#0f1520',
      'editorGutter.background': '#0f1520',
      'editor.lineHighlightBackground': '#00000000',
      'editorLineNumber.foreground': '#3b4a63',
      'editorLineNumber.activeForeground': '#94a3b8',
      'editorCursor.foreground': '#f5a524',
      'editor.selectionBackground': '#2a3850',
      'editorIndentGuide.background1': '#1e293b',
    },
  });
}

function rangeOf(loc: Loc) {
  return new monaco.Range(loc.line, loc.col + 1, loc.endLine, loc.endCol + 1);
}

export function CodeEditor() {
  const code = useEditor((s) => s.code);
  const setCode = useEditor((s) => s.setCode);
  const breakpoints = useEditor((s) => s.breakpoints);
  const syntaxError = useEditor((s) => s.syntaxError);
  const view = useStepView();
  const editorRef = useRef<IEditor | null>(null);
  const bpRef = useRef<IDecorations | null>(null);
  const stepRef = useRef<IDecorations | null>(null);
  const hoverRef = useRef<IDecorations | null>(null);

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    bpRef.current = editor.createDecorationsCollection();
    stepRef.current = editor.createDecorationsCollection();
    hoverRef.current = editor.createDecorationsCollection();

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void useRun.getState().visualize());
    editor.addAction({
      id: 'algoscope.toggleBreakpoint',
      label: 'Toggle Breakpoint',
      keybindings: [monaco.KeyCode.F9],
      contextMenuGroupId: 'algoscope',
      contextMenuOrder: 1,
      run: (ed) => {
        const line = ed.getPosition()?.lineNumber;
        if (line) useEditor.getState().toggleBreakpoint(line);
      },
    });
    editor.addAction({
      id: 'algoscope.conditionalBreakpoint',
      label: 'Edit Breakpoint Condition…',
      contextMenuGroupId: 'algoscope',
      contextMenuOrder: 2,
      run: (ed) => {
        const line = ed.getPosition()?.lineNumber;
        if (line) useUi.getState().editCondition(line);
      },
    });
    editor.addAction({
      id: 'algoscope.runToLine',
      label: 'Run to Line',
      contextMenuGroupId: 'algoscope',
      contextMenuOrder: 3,
      run: (ed) => {
        const line = ed.getPosition()?.lineNumber;
        if (line) usePlayback.getState().runToLine(line);
      },
    });

    editor.onMouseDown((e) => {
      const t = e.target;
      if (t.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !t.position) return;
      const line = t.position.lineNumber;
      if (e.event.shiftKey || e.event.rightButton) useUi.getState().editCondition(line);
      else useEditor.getState().toggleBreakpoint(line);
    });
    editor.onMouseMove((e) => {
      const t = e.target;
      const line = t.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ? t.position?.lineNumber : undefined;
      hoverRef.current?.set(line && !useEditor.getState().breakpoints.some((b) => b.line === line)
        ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'as-bp-hover' } }]
        : []);
    });
    editor.onMouseLeave(() => hoverRef.current?.set([]));
    // breakpoints follow their lines while editing
    editor.onDidChangeModelContent(() => {
      const ranges = bpRef.current?.getRanges() ?? [];
      const lines = ranges.map((r) => r.startLineNumber);
      const current = useEditor.getState().breakpoints.map((b) => b.line);
      if (lines.length === current.length && lines.some((l, k) => l !== current[k])) useEditor.getState().moveBreakpoints(lines);
    });
  };

  // breakpoint glyphs
  useEffect(() => {
    bpRef.current?.set(breakpoints.map((b) => ({
      range: new monaco.Range(b.line, 1, b.line, 1),
      options: {
        glyphMarginClassName: b.condition ? 'as-bp-cond' : 'as-bp',
        glyphMarginHoverMessage: { value: b.condition ? `Breakpoint when \`${b.condition}\`` : 'Breakpoint — shift-click to add a condition' },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    })));
  }, [breakpoints]);

  // current step highlight
  useEffect(() => {
    const editor = editorRef.current;
    const decorations = stepRef.current;
    if (!editor || !decorations) return;
    const step = view?.step;
    if (!step || !step.loc || step.line <= 0) {
      decorations.set([]);
      return;
    }
    const isError = step.kind === 'error';
    const list: DeltaDecoration[] = [
      { range: new monaco.Range(step.line, 1, step.line, 1), options: { isWholeLine: true, className: isError ? 'as-line-error' : 'as-line-current' } },
    ];
    if (step.kind !== 'call' && step.loc.endLine >= step.loc.line) {
      list.push({ range: rangeOf(step.loc), options: { inlineClassName: 'as-range-current' } });
    }
    if (step.siteLoc && step.siteLoc.line !== step.line) {
      list.push({ range: new monaco.Range(step.siteLoc.line, 1, step.siteLoc.line, 1), options: { isWholeLine: true, className: 'as-line-site' } });
    }
    decorations.set(list);
    editor.revealLineInCenterIfOutsideViewport(step.line, monaco.editor.ScrollType.Smooth);
  }, [view]);

  // syntax / compile errors as markers
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(model, 'algoscope', syntaxError ? [{
      severity: monaco.MarkerSeverity.Error,
      message: syntaxError.message,
      startLineNumber: syntaxError.line,
      startColumn: syntaxError.col + 1,
      endLineNumber: syntaxError.line,
      endColumn: syntaxError.col + 2,
    }] : []);
  }, [syntaxError]);

  // live syntax check (compiler worker; never runs code)
  useEffect(() => {
    const handle = setTimeout(() => {
      void sandbox().analyze(code).then((r) => useEditor.getState().setSyntaxError(r.ok ? null : r.error));
    }, 450);
    return () => clearTimeout(handle);
  }, [code]);

  return (
    <div className="h-full min-h-0" data-testid="code-editor">
      <Editor
        defaultLanguage="javascript"
        theme="algoscope"
        value={code}
        beforeMount={defineTheme}
        onMount={onMount}
        onChange={(v) => setCode(v ?? '')}
        loading={<div className="p-4 text-sm text-ink-faint">Loading editor…</div>}
        options={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 13,
          lineHeight: 20,
          glyphMargin: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          lineNumbersMinChars: 3,
          renderLineHighlight: 'none',
          automaticLayout: true,
          tabSize: 2,
          fixedOverflowWidgets: true,
          padding: { top: 10, bottom: 10 },
          smoothScrolling: true,
          contextmenu: true,
          wordBasedSuggestions: 'currentDocument',
        }}
      />
    </div>
  );
}
