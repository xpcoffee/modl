import { useCallback } from 'react';
import {
  ViewportPortal,
  useReactFlow,
  useStore as useFlowStore,
  type Node,
} from '@xyflow/react';
import {
  isConnection,
  readableName,
  relationsOf,
  type AppState,
  type Id,
  type Relation,
} from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { setHighlight } from './highlight.js';
import { RollerMenu } from './RollerMenu.js';
import type { BoardNodeData } from './derive.js';

/** The board rectangle a pan should centre on. */
function rectOf(state: AppState, id: Id): { x: number; y: number; width: number; height: number } {
  const entry = state.document.layout[id];
  if (!entry || !('x' in entry)) return { x: 0, y: 0, width: 180, height: 72 };
  const container = state.expanded.includes(id) ? entry.expanded : undefined;
  return { x: entry.x, y: entry.y, width: container?.width ?? entry.width, height: container?.height ?? entry.height };
}

function labelFor(state: AppState, relation: Relation): string {
  const elements = state.document.model.elements;
  const peer = elements[relation.peerId];
  const connection = elements[relation.connectionId];
  const name = peer?.title || readableName(relation.peerId);
  return connection?.title ? `${name} · ${connection.title}` : name;
}

/**
 * Pan-to-relation: a roller menu beside the selected element listing
 * everything it connects to. Turning the roller emphasises each connection on
 * the board; choosing the middle option pans the camera to its peer.
 *
 * The pan is a set-view command rather than a direct camera call, so a trace
 * shows where the reader went and a replay can follow.
 */
export function PanRelations({ nodes }: { nodes: Node<BoardNodeData>[] }) {
  const state = useAppState();
  const { getViewport } = useReactFlow();
  const paneWidth = useFlowStore((flow) => flow.width);
  const paneHeight = useFlowStore((flow) => flow.height);

  const emphasise = useCallback(
    (relation: Relation | null) => setHighlight(relation?.connectionId ?? null),
    [],
  );

  const panTo = useCallback(
    (relation: Relation): void => {
      const target = rectOf(store.getState(), relation.peerId);
      const zoom = getViewport().zoom;
      store.dispatch({
        type: 'set-view',
        pan: {
          x: paneWidth / 2 - (target.x + target.width / 2) * zoom,
          y: paneHeight / 2 - (target.y + target.height / 2) * zoom,
        },
        zoom,
      });
      // The reader's focus moved with the camera, so selection follows: the
      // highlight lands on the destination, and its own roller takes over
      // (closed, since the options changed under the menu).
      store.dispatch({ type: 'set-selection', ids: [relation.peerId] });
    },
    [getViewport, paneWidth, paneHeight],
  );

  const selectedId = state.selection.length === 1 ? state.selection[0] : undefined;
  const element = selectedId ? state.document.model.elements[selectedId] : undefined;
  const relations = selectedId && element && !isConnection(element) ? relationsOf(state, selectedId) : [];
  if (!selectedId || relations.length === 0) return null;

  const node = nodes.find((candidate) => candidate.id === selectedId);
  if (!node) return null;
  const origin = node.data.parentOrigin ?? { x: 0, y: 0 };
  const corner = {
    x: node.position.x + origin.x + (node.measured?.width ?? 0) + 10,
    y: node.position.y + origin.y,
  };

  return (
    <ViewportPortal>
      <div
        className="pan-relations"
        style={{ transform: `translate(${corner.x}px, ${corner.y}px)` }}
      >
        <RollerMenu
          entranceLabel={`${relations.length} →`}
          entranceAriaLabel={`${relations.length} connected, open to pan to one`}
          options={relations.map((relation) => ({
            id: `${relation.connectionId}:${relation.peerId}`,
            label: labelFor(state, relation),
            value: relation,
            testId: `pan-to-${relation.peerId}`,
          }))}
          onSelect={panTo}
          onActiveChange={emphasise}
          testId="pan-relations"
        />
      </div>
    </ViewportPortal>
  );
}
