import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { visibleElementIds } from '@modl/core';
import { installAnimations } from './canvas/animations.js';
import { Canvas } from './canvas/Canvas.js';
import { Toolbar } from './panels/Toolbar.js';
import { markReady } from './runtime/api.js';
import { store } from './store/store.js';

/** Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes, anywhere on the board. */
function useUndoShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const undo = key === 'z' && !event.shiftKey;
      const redo = key === 'y' || (key === 'z' && event.shiftKey);
      if (!undo && !redo) return;

      // A focused field keeps its own text history.
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable]')) return;

      event.preventDefault();
      store.dispatch({ type: undo ? 'undo' : 'redo' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/**
 * Ctrl+A selects everything drawn on the board: elements outside collapsed
 * groups and not put away, plus the connections between them. See
 * docs/decisions/012-selection-gestures.md.
 */
function useSelectAllShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'a') return;

      // A focused field keeps the browser's select-all over its own text.
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable]')) return;

      event.preventDefault();
      store.dispatch({ type: 'set-selection', ids: visibleElementIds(store.getState()) });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

export function App() {
  useEffect(() => {
    installAnimations();
    markReady();
  }, []);
  useUndoShortcuts();
  useSelectAllShortcut();

  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar />
        <main className="app__body">
          <Canvas />
        </main>
      </div>
    </ReactFlowProvider>
  );
}
