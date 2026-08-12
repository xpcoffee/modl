import { isConnection, isEntityLayout, type Id, type Point } from '../model/types.js';
import { GROUP_PADDING, MIN_GROUP_SIZE } from '../commands/apply.js';
import type { AppState } from '../commands/types.js';
import { ancestorsOf, descendantsOf, isRendered, membersOf } from './groups.js';
import { carriedWaypoints, type ReflowPlan } from './reflow.js';

/**
 * Macro layout by packing (issue #58). Reflow keeps the arrangement and gives
 * every pair the gap its widest connection label needs, which is right inside
 * a scope and wrong at board scale: a few long titles between big expanded
 * groups stretch the root into one row tens of thousands of pixels wide. A
 * compact plan gives up per-pair label gaps and instead packs each scope into
 * rows of bounded width, bottom-up: members pack inside their container, the
 * container shrinks or grows to fit exactly, and the packed containers pack
 * again in the scope above. Lines and labels then route through a block the
 * reader can actually frame.
 *
 * The result travels in the same `reflow-layout` command as a reflow plan:
 * explicit geometry, one history entry, replays identically forever.
 */

/** Clearance between packed neighbours, matching what reflow keeps. */
const GAP = { x: 64, y: 48 } as const;

/**
 * Width-to-height the packed block aims for. Rows wrap once they pass
 * sqrt(total area x aspect), which lands a block of uniform boxes near a
 * screen's shape rather than one long strip.
 */
const ASPECT = 1.6;

interface Size {
  width: number;
  height: number;
}

/**
 * Computes the compact pack for a board, or null when nothing would move.
 *
 * Scopes pack deepest group first, so a container has its exact packed size
 * before it packs as one box in the scope above. Members of a collapsed
 * group, and everything else an element carries, travel with it unchanged.
 * Elements with no position at all are left for `autoLayout`; only what is
 * already placed packs.
 */
export function planCompact(state: Pick<AppState, 'document' | 'expanded'>): ReflowPlan | null {
  const document = state.document;
  const elements = document.model.elements;
  const expandedGroups = new Set(state.expanded);

  const original = new Map<Id, Point>();
  const next = new Map<Id, Point>();
  for (const [id, entry] of Object.entries(document.layout)) {
    if (!isEntityLayout(entry)) continue;
    original.set(id, { x: entry.x, y: entry.y });
    next.set(id, { x: entry.x, y: entry.y });
  }

  const packedContainers = new Map<Id, Size>();

  /** The box an element occupies: its container box while it draws expanded. */
  const sizeOf = (id: Id): Size => {
    const entry = document.layout[id];
    if (!entry || !isEntityLayout(entry)) return { width: 0, height: 0 };
    if (expandedGroups.has(id)) {
      const container = packedContainers.get(id) ?? entry.expanded ?? MIN_GROUP_SIZE;
      return {
        width: Math.max(container.width, MIN_GROUP_SIZE.width),
        height: Math.max(container.height, MIN_GROUP_SIZE.height),
      };
    }
    return { width: entry.width, height: entry.height };
  };

  // Deepest groups first, so a container is packed to its final size before
  // the scope holding it packs.
  const scopes = [...expandedGroups]
    .filter((id) => elements[id] !== undefined && isRendered(elements, id, expandedGroups))
    .sort(
      (a, b) =>
        ancestorsOf(elements, b).length - ancestorsOf(elements, a).length || a.localeCompare(b),
    );

  // A pinned card packs with the scope of the innermost expanded container
  // drawn around it, the same reading reflow uses. Cards have no groupId, so
  // containment is geometric, read before anything moves.
  const cardScopes = new Map<Id | null, Id[]>();
  for (const cardId of Object.keys(document.comments).sort()) {
    const at = next.get(cardId);
    const entry = document.layout[cardId];
    if (!at || !entry || !isEntityLayout(entry)) continue;
    const centre = { x: at.x + entry.width / 2, y: at.y + entry.height / 2 };

    let holder: Id | null = null;
    let holderDepth = -1;
    for (const groupId of scopes) {
      const box = { ...next.get(groupId)!, ...sizeOf(groupId) };
      const inside =
        centre.x >= box.x &&
        centre.x <= box.x + box.width &&
        centre.y >= box.y &&
        centre.y <= box.y + box.height;
      const depth = ancestorsOf(elements, groupId).length;
      if (inside && depth > holderDepth) {
        holder = groupId;
        holderDepth = depth;
      }
    }
    cardScopes.set(holder, [...(cardScopes.get(holder) ?? []), cardId]);
  }

  /**
   * Shifts an element, everything drawn inside it, and every card pinned
   * inside it or inside anything it holds, by the same amount.
   */
  const moveWithDescendants = (id: Id, delta: Point): void => {
    if (delta.x === 0 && delta.y === 0) return;
    const carried = [id, ...descendantsOf(elements, id)];
    for (const target of [...carried, ...carried.flatMap((t) => cardScopes.get(t) ?? [])]) {
      const at = next.get(target);
      if (at) next.set(target, { x: at.x + delta.x, y: at.y + delta.y });
    }
  };

  /**
   * Packs one scope's boxes into left-aligned rows, wrapping at the width
   * bound, and anchors the block's top-left where the scope's content sat:
   * the scope compacts in place rather than drifting.
   *
   * Boxes pack in the reading order of their current positions, which is
   * also the order the pack itself produces, so packing a packed scope
   * computes the same positions: the plan is a fixed point.
   */
  const packScope = (ids: Id[]): void => {
    const boxes = ids
      .filter((id) => next.has(id))
      .map((id) => ({ id, ...next.get(id)!, ...sizeOf(id) }))
      .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
    if (boxes.length < 2) return;

    const area = boxes.reduce((sum, box) => sum + (box.width + GAP.x) * (box.height + GAP.y), 0);
    const bound = Math.max(Math.ceil(Math.sqrt(area * ASPECT)), ...boxes.map((box) => box.width));
    const anchor = {
      x: Math.min(...boxes.map((box) => box.x)),
      y: Math.min(...boxes.map((box) => box.y)),
    };

    let x = 0;
    let y = 0;
    let rowHeight = 0;
    for (const box of boxes) {
      if (x > 0 && x + box.width > bound) {
        x = 0;
        y += rowHeight + GAP.y;
        rowHeight = 0;
      }
      moveWithDescendants(box.id, {
        x: Math.round(anchor.x + x) - box.x,
        y: Math.round(anchor.y + y) - box.y,
      });
      x += box.width + GAP.x;
      rowHeight = Math.max(rowHeight, box.height);
    }
  };

  /** A group's movable content: its direct members and the cards pinned in it. */
  const membersInScope = (groupId: Id): Id[] =>
    [
      ...membersOf(elements, groupId)
        .filter((member) => !isConnection(member))
        .map((member) => member.id),
      ...(cardScopes.get(groupId) ?? []),
    ].filter((id) => next.has(id));

  /**
   * Fits the container exactly around its packed members, shrinking as well
   * as growing: reclaiming the room a spread-out board claimed is the point
   * of compacting, where reflow only ever grows a box the reader sized.
   */
  const refitContainer = (groupId: Id, memberIds: Id[]): void => {
    const entry = document.layout[groupId];
    const at = next.get(groupId);
    if (!entry || !isEntityLayout(entry) || !at || memberIds.length === 0) return;

    const bounds = {
      minX: Math.min(...memberIds.map((id) => next.get(id)!.x)),
      minY: Math.min(...memberIds.map((id) => next.get(id)!.y)),
      maxX: Math.max(...memberIds.map((id) => next.get(id)!.x + sizeOf(id).width)),
      maxY: Math.max(...memberIds.map((id) => next.get(id)!.y + sizeOf(id).height)),
    };
    const x = Math.round(bounds.minX - GROUP_PADDING.side);
    const y = Math.round(bounds.minY - GROUP_PADDING.top);
    // The container's own move carries nothing: its members are already placed.
    next.set(groupId, { x, y });
    packedContainers.set(groupId, {
      width: Math.max(Math.round(bounds.maxX + GROUP_PADDING.side) - x, MIN_GROUP_SIZE.width),
      height: Math.max(Math.round(bounds.maxY + GROUP_PADDING.bottom) - y, MIN_GROUP_SIZE.height),
    });
  };

  for (const groupId of scopes) {
    const memberIds = membersInScope(groupId);
    if (memberIds.length === 0) continue;
    packScope(memberIds);
    refitContainer(groupId, memberIds);
  }

  const rootIds = Object.values(elements)
    .filter((element) => !isConnection(element) && element.groupId === null)
    .map((element) => element.id);
  packScope([...rootIds, ...(cardScopes.get(null) ?? [])]);

  const waypoints = carriedWaypoints(document, original, next);

  const positions: Record<Id, Point> = {};
  for (const id of [...next.keys()].sort()) {
    const was = original.get(id)!;
    const now = next.get(id)!;
    if (was.x !== now.x || was.y !== now.y) positions[id] = { x: now.x, y: now.y };
  }

  const expanded: Record<Id, Size> = {};
  for (const id of [...packedContainers.keys()].sort()) {
    const size = packedContainers.get(id)!;
    const entry = document.layout[id];
    const current = entry && isEntityLayout(entry) ? entry.expanded : undefined;
    if (current?.width !== size.width || current?.height !== size.height) {
      expanded[id] = { ...size };
    }
  }

  if (
    Object.keys(positions).length === 0 &&
    Object.keys(waypoints).length === 0 &&
    Object.keys(expanded).length === 0
  ) {
    return null;
  }
  return { positions, waypoints, expanded };
}
