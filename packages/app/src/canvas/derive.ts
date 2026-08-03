import { isConnection, isEntity, selectIds, type AppState, type Id } from '@domain-mapper/core';
import type { Edge, Node } from '@xyflow/react';

export interface EntityNodeData extends Record<string, unknown> {
  title: string;
  id: Id;
  tags: Record<string, string>;
  description: string;
  dimmed: boolean;
  [key: string]: unknown;
}

/**
 * Projects session state into React Flow's shape. The model stays the only
 * writable copy, and this runs on every render.
 */
export function deriveNodes(state: AppState): Node<EntityNodeData>[] {
  const visible = selectIds(state.document.model.elements, state.filter);
  const selected = new Set(state.selection);

  return Object.values(state.document.model.elements)
    .filter(isEntity)
    .map((entity) => {
      const layout = state.document.layout[entity.id];
      const position =
        layout && 'x' in layout ? { x: layout.x, y: layout.y } : { x: 0, y: 0 };
      return {
        id: entity.id,
        type: 'entity',
        position,
        selected: selected.has(entity.id),
        data: {
          id: entity.id,
          title: entity.title,
          description: entity.description,
          tags: entity.tags,
          dimmed: !visible.has(entity.id),
        },
      };
    });
}

/**
 * One React Flow edge per source-target pair, since a connection can hold
 * many of each. The connection id travels in `data` so a click maps back.
 */
export function deriveEdges(state: AppState): Edge[] {
  const visible = selectIds(state.document.model.elements, state.filter);
  const selected = new Set(state.selection);
  const edges: Edge[] = [];

  for (const element of Object.values(state.document.model.elements)) {
    if (!isConnection(element)) continue;
    const dimmed = !visible.has(element.id);

    for (const from of element.from) {
      for (const to of element.to) {
        edges.push({
          id: `${element.id}:${from}:${to}`,
          source: from,
          target: to,
          label: element.title,
          selected: selected.has(element.id),
          data: { connectionId: element.id },
          ...(dimmed ? { style: { opacity: 0.25 }, labelStyle: { opacity: 0.25 } } : {}),
        });
      }
    }
  }
  return edges;
}

/** Recovers the connection id from a derived edge id. */
export function connectionIdFromEdge(edgeId: string): Id {
  return edgeId.split(':')[0] ?? edgeId;
}
