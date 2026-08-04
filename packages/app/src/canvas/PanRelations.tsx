import { useEffect, useRef, useState } from 'react';
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
 * Pan-to-relation: a compact count beside the selected element that opens
 * into a list of everything it connects to. Hovering an entry emphasises its
 * line on the board, choosing one pans the camera to the peer.
 *
 * The pan is a set-view command rather than a direct camera call, so a trace
 * shows where the reader went and a replay can follow.
 */
export function PanRelations({ nodes }: { nodes: Node<BoardNodeData>[] }) {
  const state = useAppState();
  const { getViewport } = useReactFlow();
  const paneWidth = useFlowStore((flow) => flow.width);
  const paneHeight = useFlowStore((flow) => flow.height);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedId = state.selection.length === 1 ? state.selection[0] : undefined;
  const element = selectedId ? state.document.model.elements[selectedId] : undefined;
  const relations = selectedId && element && !isConnection(element) ? relationsOf(state, selectedId) : [];

  // A fresh selection starts the control over.
  useEffect(() => {
    setOpen(false);
    setActive(0);
  }, [selectedId]);

  const pointedAt = open ? (relations[active]?.connectionId ?? null) : null;
  useEffect(() => {
    setHighlight(pointedAt);
    return () => setHighlight(null);
  }, [pointedAt]);

  useEffect(() => {
    listRef.current
      ?.querySelector('.is-active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!selectedId || relations.length === 0) return null;

  const node = nodes.find((candidate) => candidate.id === selectedId);
  if (!node) return null;
  const origin = node.data.parentOrigin ?? { x: 0, y: 0 };
  const corner = {
    x: node.position.x + origin.x + (node.measured?.width ?? 0) + 10,
    y: node.position.y + origin.y,
  };

  const panTo = (relation: Relation): void => {
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
  };

  const step = (by: number): void => {
    if (!open) {
      setOpen(true);
      return;
    }
    setActive((current) => (current + by + relations.length) % relations.length);
  };

  return (
    <ViewportPortal>
      <div
        className="pan-relations nodrag nopan nowheel"
        data-testid="pan-relations"
        style={{ transform: `translate(${corner.x}px, ${corner.y}px)` }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') step(1);
          else if (event.key === 'ArrowUp') step(-1);
          else if (event.key === 'Enter' && open && relations[active]) panTo(relations[active]);
          else if (event.key === 'Escape') setOpen(false);
          else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <button
          type="button"
          className="pan-relations__toggle"
          data-testid="pan-relations-toggle"
          aria-label={`${relations.length} connected, open to pan to one`}
          aria-expanded={open}
          // Hover already opened the list, so a click closing it again would
          // undo the hover. Leaving closes it; Escape does too.
          onClick={() => setOpen(true)}
        >
          ⇢ {relations.length}
        </button>

        {open && (
          <ul className="pan-relations__list" ref={listRef} data-testid="pan-relations-list">
            {relations.map((relation, index) => (
              <li key={`${relation.connectionId}:${relation.peerId}`}>
                <button
                  type="button"
                  className={`pan-relations__pill${index === active ? ' is-active' : ''}`}
                  data-testid={`pan-to-${relation.peerId}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => panTo(relation)}
                >
                  {labelFor(state, relation)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ViewportPortal>
  );
}
