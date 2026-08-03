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
} from '@modl/core';
import type { Edge, Node } from '@xyflow/react';

export interface EntityNodeData extends Record<string, unknown> {
  id: Id;
  title: string;
  description: string;
  elementType: EntityType;
  tags: Record<string, string>;
  dimmed: boolean;
  editing: boolean;
  /** True only when this is the single selected element, which opens the editor. */
  soleSelection: boolean;
  /** Members this collapses, 0 when it is an ordinary entity. */
  memberCount: number;
  expanded: boolean;
  /** Absolute origin of the containing group, for converting drag positions. */
  parentOrigin: Point;
  /** Where this element was drawn, so a drag can work out how far it moved. */
  origin: Point;
  isContainer: boolean;
}

export interface ConnectionEdgeData extends Record<string, unknown> {
  connectionId: Id;
  title: string;
  description: string;
  elementType: ConnectionType;
  tags: Record<string, string>;
  dimmed: boolean;
  editing: boolean;
  soleSelection: boolean;
  waypoints: Point[];
  arrowStart: boolean;
  arrowEnd: boolean;
}

export interface DeriveOptions {
  /** Element currently being renamed in place. */
  editingId: Id | null;
  /** A selection box is being dragged, so element editors stay shut. */
  boxSelecting: boolean;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Room for the group header and a margin around its members. */
const GROUP_PADDING = { top: 34, side: 20, bottom: 20 } as const;
/** An empty container still needs somewhere to drop things. */
export const MIN_GROUP_SIZE = { width: 260, height: 180 } as const;
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
    if (!expanded.has(id)) {
      rects.set(id, own);
      return own;
    }

    // An expanded entity draws as a container sized by its own rectangle,
    // which the user resizes. Membership is then simply what sits inside the
    // box, so dragging an element past the edge takes it out of the group.
    const box: Rect = {
      x: own.x,
      y: own.y,
      width: Math.max(own.width, MIN_GROUP_SIZE.width),
      height: Math.max(own.height, MIN_GROUP_SIZE.height),
    };
    rects.set(id, box);
    return box;
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
  const soleSelection = onlySelected(state, options);
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
    const isContainer = expanded.has(entity.id);

    return {
      id: entity.id,
      type: isContainer ? 'group' : 'entity',
      position: { x: rect.x - parentOrigin.x, y: rect.y - parentOrigin.y },
      // No `extent: parent`, so a member can be dragged out of its container.
      ...(groupId && parentRect ? { parentId: groupId } : {}),
      ...(isContainer ? { style: { width: rect.width, height: rect.height } } : {}),
      selected: selected.has(entity.id),
      // A selected element lifts above the rest so its editor is not covered.
      ...(selected.has(entity.id) ? { zIndex: 1000 } : {}),
      data: {
        id: entity.id,
        title: entity.title,
        description: entity.description,
        elementType: entity.type,
        tags: entity.tags,
        dimmed: !visible.has(entity.id),
        editing: options.editingId === entity.id,
        soleSelection: soleSelection === entity.id,
        memberCount: membersOf(elements, entity.id).length,
        expanded: expanded.has(entity.id),
        parentOrigin,
        origin: { x: rect.x, y: rect.y },
        isContainer,
      },
    };
  });
}

/**
 * Absolute rectangles of every container on the board, outermost last, so a
 * drop can find the innermost container it landed in.
 */
export function containerRects(state: AppState): { id: Id; rect: Rect }[] {
  const elements = state.document.model.elements;
  const expanded = new Set(state.expanded);
  const rects = measure(state, expanded);

  return Object.values(elements)
    .filter(isEntity)
    .filter((entity) => expanded.has(entity.id) && isRendered(elements, entity.id, expanded))
    .map((entity) => ({ id: entity.id, rect: rects.get(entity.id) ?? FALLBACK_RECT }))
    // Deepest first, so a nested container wins over the one holding it.
    .sort((a, b) => depthOf(elements, b.id) - depthOf(elements, a.id));
}

/** The innermost container holding this point, if any. */
export function containerAt(
  state: AppState,
  point: Point,
  ignore: ReadonlySet<Id>,
): Id | null {
  for (const { id, rect } of containerRects(state)) {
    if (ignore.has(id)) continue;
    if (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    ) {
      return id;
    }
  }
  return null;
}

export type { Rect };

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
  const soleSelection = onlySelected(state, options);
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
          ...(selected.has(element.id) ? { zIndex: 1001 } : {}),
          data: {
            connectionId: element.id,
            title: element.title,
            description: element.description,
            elementType: element.type,
            tags: element.tags,
            dimmed: !visible.has(element.id),
            editing: options.editingId === element.id,
            soleSelection: soleSelection === element.id,
            waypoints: layoutOf(state, element.id).waypoints,
            arrowStart: layoutOf(state, element.id).arrowStart ?? false,
            arrowEnd: layoutOf(state, element.id).arrowEnd ?? false,
          },
        });
      }
    }
  }
  return edges;
}

/**
 * The element whose editor should open: exactly one selected, and no
 * selection box in flight. Dragging a box across the board would otherwise
 * pop an editor open under the pointer.
 */
function onlySelected(state: AppState, options: DeriveOptions): Id | null {
  if (options.boxSelecting) return null;
  return state.selection.length === 1 ? (state.selection[0] ?? null) : null;
}

/** Connection layout, defaulted so callers need no checks. */
function layoutOf(
  state: AppState,
  id: Id,
): { waypoints: Point[]; arrowStart?: boolean; arrowEnd?: boolean } {
  const entry = state.document.layout[id];
  return entry && 'waypoints' in entry ? entry : { waypoints: [] };
}

/** Recovers the connection id from a derived edge id. */
export function connectionIdFromEdge(edgeId: string): Id {
  return edgeId.split(':')[0] ?? edgeId;
}
