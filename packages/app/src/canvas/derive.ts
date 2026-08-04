import {
  connectionAnchors,
  isConnection,
  isEntity,
  isConnectionNode,
  isGroup,
  isRendered,
  membersOf,
  selectIds,
  type AppState,
  type ConnectionType,
  type Connection,
  type Direction,
  type Element,
  type EntityType,
  type NodeShape,
  type Id,
  type Point,
  type Side,
} from '@modl/core';
import type { Edge, Node } from '@xyflow/react';

export interface EntityNodeData extends Record<string, unknown> {
  id: Id;
  title: string;
  description: string;
  elementType: EntityType;
  tags: Record<string, string[]>;
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

/** A node is a junction, so it carries no type and no members. */
export interface ConnectionNodeData extends Record<string, unknown> {
  id: Id;
  title: string;
  description: string;
  shape: NodeShape;
  tags: Record<string, string[]>;
  dimmed: boolean;
  editing: boolean;
  soleSelection: boolean;
  parentOrigin: Point;
  origin: Point;
}

export type BoardNodeData = EntityNodeData | ConnectionNodeData;

export interface ConnectionEdgeData extends Record<string, unknown> {
  connectionId: Id;
  title: string;
  description: string;
  elementType: ConnectionType;
  tags: Record<string, string[]>;
  dimmed: boolean;
  editing: boolean;
  soleSelection: boolean;
  waypoints: Point[];
  direction: Direction;
  /** Ids this edge stands in for, empty unless it is a roll-up. */
  rolledUp: Id[];
  /** True when an end anchors at a point, which reads better as a straight line. */
  straight: boolean;
  /** Offset from the direct route, so parallel connections stay apart. */
  spread?: number;
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
/** A connection point stays a point: small, and square so a diamond reads. */
export const MIN_NODE_SIZE = { width: 40, height: 40 } as const;
/** Small enough to be useful, large enough to still hold a title. */
export const MIN_ENTITY_SIZE = { width: 120, height: 60 } as const;
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

    // An expanded entity draws as a container with a size of its own, kept
    // apart from the size it collapses to. Membership is then simply what
    // sits inside the box, so dragging an element past the edge takes it out.
    const layout = state.document.layout[id];
    const container = layout && 'x' in layout ? layout.expanded : undefined;
    const box: Rect = {
      x: own.x,
      y: own.y,
      width: Math.max(container?.width ?? MIN_GROUP_SIZE.width, MIN_GROUP_SIZE.width),
      height: Math.max(container?.height ?? MIN_GROUP_SIZE.height, MIN_GROUP_SIZE.height),
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
export function deriveNodes(state: AppState, options: DeriveOptions): Node<BoardNodeData>[] {
  const elements = state.document.model.elements;
  const expanded = new Set(state.expanded);
  const visible = selectIds(elements, state.filter);
  const selected = new Set(state.selection);
  const soleSelection = onlySelected(state, options);
  const rects = measure(state, expanded);

  const connectionNodes: Node<BoardNodeData>[] = Object.values(elements)
    .filter(isConnectionNode)
    .filter((node) => isRendered(elements, node.id, expanded))
    .map((node) => {
      const rect = rectOf(state, node.id);
      const parentRect = node.groupId ? rects.get(node.groupId) : undefined;
      const parentOrigin = parentRect ? { x: parentRect.x, y: parentRect.y } : { x: 0, y: 0 };
      return {
        id: node.id,
        type: 'connection-node',
        position: { x: rect.x - parentOrigin.x, y: rect.y - parentOrigin.y },
        ...(node.groupId && parentRect ? { parentId: node.groupId } : {}),
        style: { width: rect.width, height: rect.height },
        selected: selected.has(node.id),
        ...(selected.has(node.id) ? { zIndex: 1000 } : {}),
        data: {
          id: node.id,
          title: node.title,
          description: node.description,
          shape: node.shape,
          tags: node.tags,
          dimmed: !visible.has(node.id),
          editing: options.editingId === node.id,
          soleSelection: soleSelection === node.id,
          parentOrigin,
          origin: { x: rect.x, y: rect.y },
        },
      };
    });

  const rendered = Object.values(elements)
    .filter(isEntity)
    .filter((entity) => isRendered(elements, entity.id, expanded))
    .sort((a, b) => depthOf(elements, a.id) - depthOf(elements, b.id));

  const entities: Node<BoardNodeData>[] = rendered.map((entity) => {
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
      style: { width: rect.width, height: rect.height },
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

  // Containers first, then connection nodes, so a parent precedes its child.
  return [...entities, ...connectionNodes];
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
  const rects = measure(state, expanded);
  const visible = selectIds(elements, state.filter);
  const selected = new Set(state.selection);
  const soleSelection = onlySelected(state, options);

  /**
   * Every drawn connection, grouped by the pair of anchors it runs between,
   * ignoring which way round. Two components talking in both directions are
   * still two lines between the same two boxes, and grouping by the ordered
   * pair let them land on top of each other.
   */
  const byPair = new Map<string, { from: Id; to: Id; connection: Connection }[]>();

  for (const element of Object.values(elements)) {
    if (!isConnection(element)) continue;

    const anchors = connectionAnchors(elements, element.id, expanded);
    if (!anchors) continue;

    for (const from of anchors.from) {
      for (const to of anchors.to) {
        if (from === to) continue;
        const key = [from, to].sort().join(' ');
        const entry = byPair.get(key) ?? [];
        entry.push({ from, to, connection: element });
        byPair.set(key, entry);
      }
    }
  }

  const edges: Edge<ConnectionEdgeData>[] = [];

  for (const drawn of byPair.values()) {
    const connections = drawn.map((entry) => entry.connection);

    // Several connections collapsing onto one pair of anchors draw as one
    // edge carrying a count. At a zoom-out this is the difference between a
    // readable line and a stack of overlapping labels.
    const rolledUp =
      drawn.length > 1 && connections.some((c) => isRolledUp(elements, c, expanded));

    if (rolledUp) {
      const ids = connections.map((c) => c.id).sort();
      const first = drawn[0]!;
      // Mixed orientations have no single direction to show, so say both.
      const oneWay = drawn.every((entry) => entry.from === first.from);
      const direction: Direction = oneWay
        ? connections.every((c) => c.direction === 'both')
          ? 'both'
          : connections.every((c) => c.direction === 'none')
            ? 'none'
            : 'forward'
        : 'both';

      edges.push({
        id: `rollup:${first.from}:${first.to}`,
        type: 'connection',
        source: first.from,
        target: first.to,
        ...sidesBetween(rects, first.from, first.to, {}, {
          from: isCentred(elements, first.from),
          to: isCentred(elements, first.to),
        }),
        data: {
          connectionId: ids[0] ?? first.from,
          title: `${connections.length} connections`,
          // What each bundled line joins, in the reader's words. The ids it
          // used to list said nothing to anyone.
          description: connections.map((c) => describeConnection(elements, c)).join('\n'),
          elementType: connections[0]!.type,
          tags: {},
          dimmed: !connections.some((c) => visible.has(c.id)),
          editing: false,
          soleSelection: false,
          waypoints: [],
          direction,
          rolledUp: ids,
          straight: isCentred(elements, first.from) || isCentred(elements, first.to),
        },
      });
      continue;
    }

    // Parallel connections between the same visible pair fan out, so several
    // between one pair of components no longer land on top of each other.
    //
    // They spread outwards from the first: 0, +1, -1, +2, -2. Centring the
    // set instead re-placed every line each time one was added, so drawing a
    // second connection made the first twitch.
    drawn.forEach(({ from, to, connection: element }, index) => {
      const step = Math.ceil(index / 2);
      const spread = index === 0 ? 0 : index % 2 === 1 ? step : -step;
      edges.push({
        id: `${element.id}:${from}:${to}`,
        type: 'connection',
        source: from,
        target: to,
        ...sidesBetween(rects, from, to, layoutOf(state, element.id), {
          from: isCentred(elements, from),
          to: isCentred(elements, to),
        }),
        selected: selected.has(element.id),
        ...(selected.has(element.id) ? { zIndex: 1001 } : {}),
        reconnectable: selected.has(element.id),
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
          direction: element.direction,
          spread: spread * PARALLEL_SPREAD,
          rolledUp: [],
          straight: isCentred(elements, from) || isCentred(elements, to),
        },
      });
    });
  }

  return edges;
}

/** Vertical gap between parallel connections joining the same pair. */
const PARALLEL_SPREAD = 26;

/** True when either end of this connection is hidden inside a collapsed group. */
function isRolledUp(
  elements: Record<Id, Element>,
  connection: Connection,
  expanded: ReadonlySet<Id>,
): boolean {
  return [...connection.from, ...connection.to].some(
    (id) => !isRendered(elements, id, expanded),
  );
}

/**
 * A bundled connection in a reader's terms: what it joins, and its own title
 * when it has one.
 */
function describeConnection(elements: Record<Id, Element>, connection: Connection): string {
  const name = (id: Id): string => {
    const element = elements[id];
    return element?.title || id;
  };
  const ends = `${connection.from.map(name).join(', ')} → ${connection.to.map(name).join(', ')}`;
  return connection.title ? `${connection.title}: ${ends}` : ends;
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
): { waypoints: Point[]; sourceSide?: Side; targetSide?: Side } {
  const entry = state.document.layout[id];
  return entry && 'waypoints' in entry ? entry : { waypoints: [] };
}

/** A connection node has one contact point, at its middle. */
function isCentred(elements: Record<Id, Element>, id: Id): boolean {
  const element = elements[id];
  return element !== undefined && isConnectionNode(element);
}

/**
 * The sides a line should leave and arrive on, chosen from where the two
 * boxes actually sit. Fixing the source to the right edge and the target to
 * the left forced every line to run left-to-right, so a connection back up
 * the board looped around its own endpoints.
 */
function sidesBetween(
  rects: Map<Id, Rect>,
  from: Id,
  to: Id,
  chosen: { sourceSide?: Side; targetSide?: Side } = {},
  round: { from: boolean; to: boolean } = { from: false, to: false },
): { sourceHandle: string; targetHandle: string } {
  const a = rects.get(from);
  const b = rects.get(to);
  const auto = (source: string, target: string) => ({
    // A point the reader dragged the line onto wins. Recomputing it moved the
    // line off the handle they picked the moment either box shifted.
    //
    // A connection node always anchors at its centre, and picks the centred
    // handle facing the way the line travels so the tangent turns with it.
    sourceHandle: round.from ? `centre-${source}` : (chosen.sourceSide ?? source),
    targetHandle: round.to ? `centre-${target}` : (chosen.targetSide ?? target),
  });

  if (!a || !b) return auto('right', 'left');

  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);

  // Whichever gap is wider decides the axis, so boxes stacked vertically join
  // top to bottom rather than curling around their sides.
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? auto('right', 'left') : auto('left', 'right');
  }
  return dy >= 0 ? auto('bottom', 'top') : auto('top', 'bottom');
}

/** Recovers the connection id from a derived edge id. */
export function connectionIdFromEdge(edgeId: string): Id {
  return edgeId.split(':')[0] ?? edgeId;
}
