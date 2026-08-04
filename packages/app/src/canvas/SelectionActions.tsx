import { ViewportPortal, type Node } from '@xyflow/react';
import { isConnection } from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { DeleteButton } from './DeleteButton.js';
import type { BoardNodeData } from './derive.js';

/**
 * Hide, show, and delete for a multi-selection, under the box that holds it.
 *
 * A single selection carries these inside the editor, which travels with the
 * element for free. This reads the live React Flow nodes rather than the
 * document, so it keeps up while a drag is in flight.
 */
export function SelectionActions({ nodes }: { nodes: Node<BoardNodeData>[] }) {
  const state = useAppState();
  const { selection } = state;
  if (selection.length < 2) return null;

  // Connections cannot be hidden directly, so only the rest count. A mixed
  // selection offers both actions, each naming how many it touches.
  const hiddenSet = new Set(state.hidden);
  const elements = state.document.model.elements;
  const hideable = selection.filter((id) => {
    const element = elements[id];
    return element && !isConnection(element) && !hiddenSet.has(id);
  });
  const showable = selection.filter((id) => hiddenSet.has(id));

  const chosen = new Set(selection);
  const boxes = nodes
    .filter((node) => chosen.has(node.id))
    .map((node) => {
      const origin = (node.data.parentOrigin as { x: number; y: number }) ?? { x: 0, y: 0 };
      return {
        x: node.position.x + origin.x,
        y: node.position.y + origin.y,
        width: node.measured?.width ?? 0,
        height: node.measured?.height ?? 0,
      };
    });

  if (boxes.length === 0) return null;

  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));

  return (
    <ViewportPortal>
      <div
        className="selection-actions nodrag nopan"
        data-testid="selection-actions"
        style={{ transform: `translate(${(left + right) / 2}px, ${bottom}px)` }}
      >
        <div className="selection-actions__row">
          {hideable.length > 0 && (
            <button
              type="button"
              data-testid="hide-selected"
              onClick={() => {
                for (const id of hideable) {
                  store.dispatch({ type: 'set-hidden', id, hidden: true });
                }
              }}
            >
              Hide {hideable.length}
            </button>
          )}
          {showable.length > 0 && (
            <button
              type="button"
              data-testid="show-selected"
              onClick={() => {
                for (const id of showable) {
                  store.dispatch({ type: 'set-hidden', id, hidden: false });
                }
              }}
            >
              Show {showable.length}
            </button>
          )}
          <DeleteButton count={selection.length} />
        </div>
      </div>
    </ViewportPortal>
  );
}
