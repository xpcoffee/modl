import { useEffect, useState } from 'react';
import { ViewportPortal, type Node } from '@xyflow/react';
import { isConnection, isConnectionNode, isEntity } from '@modl/core';
import { useAppState } from '../store/useStore.js';
import { ElementEditor } from './ElementEditor.js';
import { useDock, useDockedTransform } from './docking.js';
import type { BoardNodeData } from './derive.js';

/**
 * The single-selection editor while the selection menus are docked.
 *
 * Attached, the editor renders inside its node (EntityNode, GroupNode,
 * ConnectionNodeView) so it travels with the element for free. That home is
 * unreachable when the element is offscreen, so while docked the node's copy
 * stands down (derive's `dockedEditor`) and this one renders the same
 * `ElementEditor` at the dock's panel slot. A selected connection keeps its
 * editor on the line: it has no box to judge against the viewport, so it
 * never docks.
 */
export function DockedEditor({
  nodes,
  boxSelecting,
}: {
  nodes: Node<BoardNodeData>[];
  /** A selection box in flight keeps this editor shut, like the in-node one. */
  boxSelecting: boolean;
}) {
  const state = useAppState();
  const { docked, travelling } = useDock();
  const selectedId = state.selection.length === 1 ? state.selection[0] : undefined;
  const active = (docked || travelling) && selectedId !== undefined && !boxSelecting;
  const dockedTransform = useDockedTransform('panel', active);

  /**
   * False on the frame this editor mounts, so it appears on the element's own
   * anchor and the transition carries it to the dock, matching how the
   * rollers travel. The rollers stay mounted across the flip and transition
   * for free; this editor changes homes, so its travel-in needs the extra
   * frame.
   */
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!active) {
      setSettled(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setSettled(true));
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  if (!active) return null;
  const element = state.document.model.elements[selectedId];
  if (!element || isConnection(element)) return null;

  const node = nodes.find((candidate) => candidate.id === selectedId);
  const origin = node?.data.parentOrigin ?? { x: 0, y: 0 };
  // Where the in-node editor sits: under the element, at its left edge.
  const anchorTransform = node
    ? `translate(${node.position.x + origin.x}px, ${node.position.y + origin.y + (node.measured?.height ?? Number(node.style?.height ?? 0)) + 8}px)`
    : dockedTransform;
  const atDock = docked && (settled || !travelling);

  return (
    <ViewportPortal>
      <div
        className={`selection-dock-panel nodrag nopan nowheel${travelling ? ' is-travelling' : ''}`}
        data-testid="docked-editor"
        style={{ transform: atDock ? dockedTransform : anchorTransform }}
      >
        {isConnectionNode(element) ? (
          <ElementEditor
            id={element.id}
            kind="node"
            hidden={state.hidden.includes(element.id)}
            elementType={element.shape === 'diamond' ? 'decision' : 'connection node'}
            description={element.description}
            tags={element.tags}
          />
        ) : isEntity(element) ? (
          <ElementEditor
            id={element.id}
            kind="entity"
            hidden={state.hidden.includes(element.id)}
            elementType={element.type}
            description={element.description}
            tags={element.tags}
          />
        ) : null}
      </div>
    </ViewportPortal>
  );
}
