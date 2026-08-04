import { ViewportPortal, type Node } from '@xyflow/react';
import { useAppState } from '../store/useStore.js';
import { DeleteButton } from './DeleteButton.js';
import type { EntityNodeData } from './derive.js';

/**
 * Delete for a multi-selection, under the box that holds it.
 *
 * A single selection carries its own delete inside the editor, which travels
 * with the element for free. This reads the live React Flow nodes rather than
 * the document, so it keeps up while a drag is in flight.
 */
export function SelectionActions({ nodes }: { nodes: Node<EntityNodeData>[] }) {
  const { selection } = useAppState();
  if (selection.length < 2) return null;

  const chosen = new Set(selection);
  const boxes = nodes
    .filter((node) => chosen.has(node.id))
    .map((node) => {
      const origin = node.data.parentOrigin ?? { x: 0, y: 0 };
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
        <DeleteButton count={selection.length} />
      </div>
    </ViewportPortal>
  );
}
