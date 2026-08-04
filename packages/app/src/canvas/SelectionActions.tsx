import { ViewportPortal, type Node } from '@xyflow/react';
import { useAppState } from '../store/useStore.js';
import { DeleteButton } from './DeleteButton.js';
import { StyleEditor } from './StyleEditor.js';
import type { BoardNodeData } from './derive.js';

/**
 * Style and delete for a multi-selection, under the box that holds it.
 *
 * A single selection carries its own editor, which travels with the element
 * for free. This reads the live React Flow nodes rather than the document, so
 * it keeps up while a drag is in flight.
 */
export function SelectionActions({ nodes }: { nodes: Node<BoardNodeData>[] }) {
  const { selection } = useAppState();
  if (selection.length < 2) return null;

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
        {/* One panel for the whole selection: each row edits the elements it
            can mean something to, so a mixed selection still edits its
            components' fill. */}
        <div className="selection-actions__panel">
          <StyleEditor ids={selection} />
          <footer className="element-editor__footer">
            <DeleteButton count={selection.length} />
          </footer>
        </div>
      </div>
    </ViewportPortal>
  );
}
