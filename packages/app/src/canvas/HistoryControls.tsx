import { ControlButton } from '@xyflow/react';
import { canRedo, canUndo } from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';

/**
 * Undo and redo in the board's control cluster, under the zoom buttons.
 * Rendered as children of `<Controls>` so they pick up the same styling.
 */
export function HistoryControls() {
  const state = useAppState();

  return (
    <>
      <ControlButton
        data-testid="board-undo"
        onClick={() => store.dispatch({ type: 'undo' })}
        disabled={!canUndo(state)}
        title="Undo (Ctrl+Z)"
        aria-label="Undo (Ctrl+Z)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
        </svg>
      </ControlButton>
      <ControlButton
        data-testid="board-redo"
        onClick={() => store.dispatch({ type: 'redo' })}
        disabled={!canRedo(state)}
        title="Redo (Ctrl+Y)"
        aria-label="Redo (Ctrl+Y)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z" />
        </svg>
      </ControlButton>
    </>
  );
}
