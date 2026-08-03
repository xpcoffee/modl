import { ViewportPortal } from '@xyflow/react';
import { isConnection, isEntity, type Id } from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { containerRects } from './derive.js';

/**
 * Actions for whatever is selected, placed under the selection on the board.
 *
 * A global Delete button sits far from the thing it deletes and gives no clue
 * which elements it would take. Here it follows the selection, and covers one
 * element or many the same way.
 */
export function SelectionActions() {
  const state = useAppState();
  if (state.selection.length === 0) return null;

  const bounds = selectionBounds(state.selection);
  if (!bounds) return null;

  return (
    <ViewportPortal>
      <div
        className="selection-actions nodrag nopan"
        data-testid="selection-actions"
        style={{
          transform: `translate(${bounds.x + bounds.width / 2}px, ${bounds.y + bounds.height}px)`,
        }}
      >
        <button
          type="button"
          data-testid="delete-selected"
          aria-label={
            state.selection.length === 1
              ? 'Delete element'
              : `Delete ${state.selection.length} elements`
          }
          title="Delete"
          onClick={() => {
            for (const id of store.getState().selection) {
              store.dispatch({ type: 'delete-element', id });
            }
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M4 6.5h16M9.5 6.5V4.8h5v1.7M6.5 6.5 7.4 20h9.2l.9-13.5" strokeLinecap="round" />
            <path d="M10.3 10v6.4M13.7 10v6.4" strokeLinecap="round" />
          </svg>
          {state.selection.length > 1 && <span>{state.selection.length}</span>}
        </button>
      </div>
    </ViewportPortal>
  );

  /** Bounding box of the selection in board coordinates. */
  function selectionBounds(ids: Id[]) {
    const elements = state.document.model.elements;
    const containers = new Map(containerRects(state).map((entry) => [entry.id, entry.rect]));
    const boxes: { x: number; y: number; width: number; height: number }[] = [];

    for (const id of ids) {
      const element = elements[id];
      if (!element) continue;

      if (isEntity(element)) {
        const container = containers.get(id);
        if (container) {
          boxes.push(container);
          continue;
        }
        const layout = state.document.layout[id];
        if (layout && 'x' in layout) boxes.push(layout);
        continue;
      }

      // A connection has no box of its own, so use what it joins.
      if (isConnection(element)) {
        for (const endpoint of [...element.from, ...element.to]) {
          const layout = state.document.layout[endpoint];
          if (layout && 'x' in layout) boxes.push(layout);
        }
      }
    }

    if (boxes.length === 0) return null;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return {
      x,
      y,
      width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
    };
  }
}
