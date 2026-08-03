import {
  connectionAnchors,
  isConnection,
  isEntity,
  isGroup,
  isRendered,
  membersOf,
  selectIds,
  type AppState,
  type ConnectionType,
  type Element,
  type EntityType,
  type Id,
  type Point,
} from '@domain-mapper/core';
import type { Edge, Node } from '@xyflow/react';

export interface EntityNodeData extends Record<string, unknown> {
  id: Id;
  title: string;
  description: string;
  elementType: EntityType;
  tags: Record<string, string>;
  dimmed: boolean;
  editing: boolean;
  /** Members this collapses, 0 when it is an ordinary entity. */
  memberCount: number;
  expanded: boolean;
  /** Absolute origin of the containing group, for converting drag positions. */
  parentOrigin: Point;
}

export interface ConnectionEdgeData extends Record<string, unknown> {
  connectionId: Id;
  title: string;
  description: string;
  elementType: ConnectionType;
  tags: Record<string, string>;
  dimmed: boolean;
  editing: boolean;
}

export interface DeriveOptions {
  /** Element currently being renamed in place. */
  editingId: Id | null;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Room for the group header and a margin around its members. */
const GROUP_PADDING = { top: 34, side: 20, bottom: 20 } as const;
const FALLBACK_RECT: Rect = { x: 0, y: 0, width: 180, height: 72 };

function rectOf(state: AppState, id: Id): Rect {
  const layout = state.document.layout[id];
  return layout && 'x' in layout
    ? { x: layout.x, y: layout.y, width: layout.width, height: layout.height }
    : FALLBACK_RECT;
}

/**
 * Absolute rectangle for every rendered entity. An expanded group takes the
 * bounding box of its members plus padding, computed innermost first so a
 * nested group sizes itself before its container measures it.
 */
function measure(state: AppState, expanded: ReadonlySet<Id>): Map<Id, Rect> {
  const elements = state.document.model.elements;
  const rects = new Map<Id, Rect>();

  const sizeOf = (id: Id): Rect => {
    const cached = rects.get(id);
    if (cached) return cached;

    const own = rectOf(state, id);
    const showsMembers = expanded.has(id) && isGroup(elements, id);
    if (!showsMembers) {
      rects.set(id, own);
      return own;
    }

    const members = membersOf(elements, id).filter(isEntity);
    if (members.length === 0) {
      rects.set(id, own);
      return own;
    }

    const memberRects = members.map((member) => sizeOf(member.id));
    const minX = Math.min(...memberRects.map((r) => r.x));
    const minY = Math.min(...memberRects.map((r) => r.y));
    const maxX = Math.max(...memberRects.map((r) => r.x + r.width));
    const maxY = Math.max(...memberRects.map((r) => r.y + r.height));

    const rect: Rect = {
      x: minX - GROUP_PADDING.side,
      y: minY - GROUP_PADDING.top,
      width: maxX - minX + GROUP_PADDING.side * 2,
      height: maxY - minY + GROUP_PADDING.top + GROUP_PADDING.bottom,
    };
    rects.set(id, rect);
    return rect;
  };

  for (const element of Object.values(elements)) {
    if (isEntity(element) && isRendered(elements, element.id, expanded)) sizeOf(element.id);
  }
  return rects;
}

/** Depth from the root, so React Flow receives parents before children. */
function depthOf(elements: Record<Id, Element>, id: Id): number {
  let depth = 0;
  let current = elements[id]?.groupId ?? null;
  const seen = new Set<Id>([id]);
  while (current !== null && !seen.has(current)) {
    depth += 1;
    seen.add(current);
    current = elements[current]?.groupId ?? null;
  }
  return depth;
}

/**
 * Projects session state into React Flow's shape. The model stays the only
 * writable copy, and this runs on every render.
 */
export function deriveNodes(state: AppState, options: DeriveOptions): Node<EntityNodeData>[] {
  const elements = state.document.model.elements;
  const expanded = new Set(state.expanded);
  const visible = selectIds(elements, state.filter);
  const selected = new Set(state.selection);
  const rects = measure(state, expanded);

  const rendered = Object.values(elements)
    .filter(isEntity)
    .filter((entity) => isRendered(elements, entity.id, expanded))
    .sort((a, b) => depthOf(elements, a.id) - depthOf(elements, b.id));

  return rendered.map((entity) => {
    const rect = rects.get(entity.id) ?? FALLBACK_RECT;
    const groupId = entity.groupId;
    // A member sits inside its container, so React Flow wants a relative position.
    const parentRect = groupId ? rects.get(groupId) : undefined;
    const parentOrigin = parentRect ? { x: parentRect.x, y: parentRect.y } : { x: 0, y: 0 };
    const isExpandedGroup = expanded.has(entity.id) && isGroup(elements, entity.id);

    return {
      id: entity.id,
      type: isExpandedGroup ? 'group' : 'entity',
      position: { x: rect.x - parentOrigin.x, y: rect.y - parentOrigin.y },
      ...(groupId && parentRect ? { parentId: groupId, extent: 'parent' as const } : {}),
      ...(isExpandedGroup ? { style: { width: rect.width, height: rect.height } } : {}),
      selected: selected.has(entity.id),
      data: {
        id: entity.id,
        title: entity.title,
        description: entity.description,
        elementType: entity.type,
        tags: entity.tags,
        dimmed: !visible.has(entity.id),
        editing: options.editingId === entity.id,
        memberCount: membersOf(elements, entity.id).length,
        expanded: expanded.has(entity.id),
        parentOrigin,
      },
    };
  });
}

/**
 * One React Flow edge per source-target pair. Endpoints inside a collapsed
 * group re-point at the group, and a connection with both ends inside the
 * same collapsed group is dropped: it says nothing at that zoom level.
 */
export function deriveEdges(state: AppState, options: DeriveOptions): Edge<ConnectionEdgeData>[] {
  const elements = state.document.model.elements;
  const expanded = new Set(state.expanded);
  const visible = selectIds(elements, state.filter);
  const selected = new Set(state.selection);
  const edges: Edge<ConnectionEdgeData>[] = [];

  for (const element of Object.values(elements)) {
    if (!isConnection(element)) continue;

    const anchors = connectionAnchors(elements, element.id, expanded);
    if (!anchors) continue;

    for (const from of anchors.from) {
      for (const to of anchors.to) {
        if (from === to) continue;
        edges.push({
          id: `${element.id}:${from}:${to}`,
          type: 'connection',
          source: from,
          target: to,
          selected: selected.has(element.id),
          data: {
            connectionId: element.id,
            title: element.title,
            description: element.description,
            elementType: element.type,
            tags: element.tags,
            dimmed: !visible.has(element.id),
            editing: options.editingId === element.id,
          },
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
