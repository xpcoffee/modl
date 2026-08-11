import {
  isConnection,
  isEntityLayout,
  isConnectionNode,
  type Id,
  type Point,
} from '../model/types.js';
import { GROUP_PADDING, MIN_GROUP_SIZE } from '../commands/apply.js';
import type { AppState } from '../commands/types.js';
import { ancestorsOf, connectionAnchors, descendantsOf, isRendered, membersOf } from './groups.js';

/**
 * Re-spacing for legibility (issue #43). A producer or a hurried reader can
 * leave elements sitting on top of each other; this computes where everything
 * should move so that neighbours clear each other and line labels have room,
 * while every element keeps its place in the reading order. The plan is pure
 * geometry with no random source, so the same board always reflows the same
 * way, and it is applied by one `reflow-layout` command so the whole tidy-up
 * is a single undo step.
 *
 * The command carries the computed positions rather than re-running this
 * function on replay. Undo refolds the command log, and a payload of explicit
 * geometry keeps a saved trace replaying identically after this algorithm
 * changes.
 */

export interface ReflowPlan {
  /** New origins for entities, connection nodes, and pinned comment cards. */
  positions: Record<Id, Point>;
  /** Hand-placed bends, carried along with the elements their line joins. */
  waypoints: Record<Id, Point[]>;
  /** New container sizes for expanded groups whose members needed room. */
  expanded: Record<Id, { width: number; height: number }>;
}

/** Clearance two neighbouring boxes must keep, in flow pixels. */
const GAP = { x: 64, y: 48 } as const;

/**
 * Estimated width of one label character at the board's font size. The core
 * has no canvas to measure text on, and an estimate keeps the plan pure and
 * testable without a browser; LABEL_CLEARANCE absorbs the error for a label
 * a few pixels wider than its estimate.
 */
const LABEL_CHAR_WIDTH = 7.2;
/** The label pill's own padding and border. */
const LABEL_PADDING = 28;
/** Air either side of a label, so it clears the boxes it sits between. */
const LABEL_CLEARANCE = 24;

interface Box {
  id: Id;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

function pairKey(a: Id, b: Id): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/**
 * Moves boxes apart until every pair has clearance on at least one axis.
 * Each pair separates along the axis of its starting offset (two elements
 * side by side spread sideways, two stacked spread vertically) and keeps the
 * order it started with. Both are measured once, before anything moves, so a
 * push from a third element can never flip two others past each other: the
 * arrangement the reader knows survives the re-spacing.
 */
function separate(input: Box[], gapOf: (a: Id, b: Id) => Point): Map<Id, Point> {
  // Reading order, so a pair starting in exactly the same place spreads with
  // the earlier element up-and-left of the later.
  const boxes = input
    .map((box) => ({ ...box }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const origin = new Map(
    boxes.map((box) => [box.id, { x: box.x + box.width / 2, y: box.y + box.height / 2 }]),
  );

  // Separating one pair can crowd another, so the passes repeat until one
  // moves nothing. A pile of n boxes on one spot untangles in about n²
  // passes, so the ceiling scales with that; it exists so a pathological
  // board stops rather than spins, at the cost of settling on a later press.
  const rounds = Math.min(Math.max(40, boxes.length * boxes.length), 5000);
  for (let round = 0; round < rounds; round += 1) {
    let moved = false;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const gap = gapOf(a.id, b.id);
        const clearX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
        const clearY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
        if (clearX >= gap.x || clearY >= gap.y) continue;

        const offset = {
          x: origin.get(b.id)!.x - origin.get(a.id)!.x,
          y: origin.get(b.id)!.y - origin.get(a.id)!.y,
        };
        // One pixel over what the gap asks, so the per-element rounding
        // applied when the plan lands cannot leave a pair a fraction short
        // and give a second press work to find.
        if (Math.abs(offset.x) >= Math.abs(offset.y)) {
          const sign = offset.x === 0 ? 1 : Math.sign(offset.x);
          const need = gap.x - clearX + 1;
          a.x -= (sign * need) / 2;
          b.x += (sign * need) / 2;
        } else {
          const sign = Math.sign(offset.y);
          const need = gap.y - clearY + 1;
          a.y -= (sign * need) / 2;
          b.y += (sign * need) / 2;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return new Map(boxes.map((box) => [box.id, { x: box.x, y: box.y }]));
}

/**
 * Computes the reflow for a board, or null when everything already reads.
 *
 * The board is spaced scope by scope: the members of each expanded group
 * first, deepest group first, then everything at the root, with each expanded
 * group taking part as one box of its container size. Members of a collapsed
 * group, and everything else an element carries, travel with it unchanged.
 * Hidden elements are drawn muted, so they keep their room like anything
 * else on the board.
 */
export function planReflow(state: Pick<AppState, 'document' | 'expanded'>): ReflowPlan | null {
  const document = state.document;
  const elements = document.model.elements;
  const expandedGroups = new Set(state.expanded);

  // Where everything sits now, updated as each scope settles.
  const original = new Map<Id, Point>();
  const next = new Map<Id, Point>();
  for (const [id, entry] of Object.entries(document.layout)) {
    if (!isEntityLayout(entry)) continue;
    original.set(id, { x: entry.x, y: entry.y });
    next.set(id, { x: entry.x, y: entry.y });
  }

  const grownContainers = new Map<Id, Size>();

  /** The box an element occupies: its container box while it draws expanded. */
  const sizeOf = (id: Id): Size => {
    const entry = document.layout[id];
    if (!entry || !isEntityLayout(entry)) return { width: 0, height: 0 };
    if (expandedGroups.has(id)) {
      const container = grownContainers.get(id) ?? entry.expanded ?? MIN_GROUP_SIZE;
      return {
        width: Math.max(container.width, MIN_GROUP_SIZE.width),
        height: Math.max(container.height, MIN_GROUP_SIZE.height),
      };
    }
    return { width: entry.width, height: entry.height };
  };

  // Deepest groups first, so a container has its final size before the scope
  // holding it is spaced.
  const scopes = [...expandedGroups]
    .filter((id) => elements[id] !== undefined && isRendered(elements, id, expandedGroups))
    .sort(
      (a, b) =>
        ancestorsOf(elements, b).length - ancestorsOf(elements, a).length || a.localeCompare(b),
    );

  /**
   * The boxes that stand for two anchors in the scope where they separate:
   * each anchor climbs to its ancestor directly inside the deepest scope the
   * two share. A label on a line crossing a container boundary then widens
   * the gap between the boxes the solver actually moves.
   */
  const separatedPair = (a: Id, b: Id): [Id, Id] | null => {
    const chainA = [a, ...ancestorsOf(elements, a)];
    const chainB = [b, ...ancestorsOf(elements, b)];
    for (const x of chainA) {
      for (const y of chainB) {
        if (x === y) continue;
        if ((elements[x]?.groupId ?? null) === (elements[y]?.groupId ?? null)) return [x, y];
      }
    }
    return null;
  };

  // The widest label drawn between each pair of separated boxes: the
  // connection's own title at the line's midpoint, and a junction's answer
  // near its end. The gap between the pair has to hold the widest of them.
  const labelWidths = new Map<string, number>();
  const noteLabel = (pair: [Id, Id], text: string | undefined): void => {
    if (text === undefined || text === '') return;
    const width = Math.ceil(text.length * LABEL_CHAR_WIDTH) + LABEL_PADDING;
    const key = pairKey(pair[0], pair[1]);
    labelWidths.set(key, Math.max(labelWidths.get(key) ?? 0, width));
  };
  for (const element of Object.values(elements)) {
    if (!isConnection(element)) continue;
    const anchors = connectionAnchors(elements, element.id, expandedGroups);
    if (!anchors) continue;
    for (const from of anchors.from) {
      for (const to of anchors.to) {
        if (from === to) continue;
        const pair = separatedPair(from, to);
        if (!pair) continue;
        noteLabel(pair, element.title);
        for (const end of [from, to]) {
          const junction = elements[end];
          if (junction && isConnectionNode(junction)) {
            noteLabel(pair, junction.labels[element.id]);
          }
        }
      }
    }
  }

  // A label sits on one line, which the base vertical gap already clears, so
  // labels only ever widen the horizontal requirement.
  const gapOf = (a: Id, b: Id): Point => ({
    x: Math.max(GAP.x, (labelWidths.get(pairKey(a, b)) ?? 0) + LABEL_CLEARANCE),
    y: GAP.y,
  });

  // A pinned card joins the scope of the innermost expanded container drawn
  // around it, so a remark pinned beside a member re-spaces with the members
  // rather than being pushed out of the container it sits in. Cards have no
  // groupId, so containment is geometric, read before anything moves.
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
   * Spaces one scope's boxes, then puts the set's top-left corner back where
   * it was: the scope spreads in place rather than drifting down the board.
   */
  const reflowScope = (ids: Id[]): void => {
    const boxes: Box[] = ids
      .filter((id) => next.has(id))
      .sort()
      .map((id) => ({ id, ...next.get(id)!, ...sizeOf(id) }));
    if (boxes.length < 2) return;

    const placed = separate(boxes, gapOf);
    const anchor = {
      x: Math.min(...boxes.map((box) => box.x)) - Math.min(...[...placed.values()].map((p) => p.x)),
      y: Math.min(...boxes.map((box) => box.y)) - Math.min(...[...placed.values()].map((p) => p.y)),
    };
    for (const box of boxes) {
      const to = placed.get(box.id)!;
      moveWithDescendants(box.id, {
        x: Math.round(to.x + anchor.x) - box.x,
        y: Math.round(to.y + anchor.y) - box.y,
      });
    }
  };

  for (const groupId of scopes) {
    const memberIds = [
      ...membersOf(elements, groupId)
        .filter((member) => !isConnection(member))
        .map((member) => member.id),
      ...(cardScopes.get(groupId) ?? []),
    ].filter((id) => next.has(id));
    if (memberIds.length === 0) continue;
    reflowScope(memberIds);

    const entry = document.layout[groupId];
    const at = next.get(groupId);
    if (!entry || !isEntityLayout(entry) || !at) continue;

    // The container grows only when a member would poke out of it. Refitting
    // every time would shrink a box the reader sized on purpose.
    const bounds = {
      minX: Math.min(...memberIds.map((id) => next.get(id)!.x)),
      minY: Math.min(...memberIds.map((id) => next.get(id)!.y)),
      maxX: Math.max(...memberIds.map((id) => next.get(id)!.x + sizeOf(id).width)),
      maxY: Math.max(...memberIds.map((id) => next.get(id)!.y + sizeOf(id).height)),
    };
    const current = { ...at, ...sizeOf(groupId) };
    const fits =
      bounds.minX >= current.x &&
      bounds.minY >= current.y &&
      bounds.maxX <= current.x + current.width &&
      bounds.maxY <= current.y + current.height;
    if (fits) continue;

    const x = Math.round(bounds.minX - GROUP_PADDING.side);
    const y = Math.round(bounds.minY - GROUP_PADDING.top);
    // The container's own move carries nothing: its members are already placed.
    next.set(groupId, { x, y });
    grownContainers.set(groupId, {
      width: Math.max(Math.round(bounds.maxX + GROUP_PADDING.side) - x, MIN_GROUP_SIZE.width),
      height: Math.max(Math.round(bounds.maxY + GROUP_PADDING.bottom) - y, MIN_GROUP_SIZE.height),
    });
  }

  // The root scope: everything at the top level, and every card not pinned
  // inside a container. A card discusses the board from beside it, so it
  // needs room the same way a box does.
  const rootIds = Object.values(elements)
    .filter((element) => !isConnection(element) && element.groupId === null)
    .map((element) => element.id);
  reflowScope([...rootIds, ...(cardScopes.get(null) ?? [])]);

  // Bends travel with the line's endpoints: each connection's waypoints shift
  // by the average of how far its ends moved, so a hand-drawn route keeps its
  // shape between the boxes it was drawn between.
  const waypoints: Record<Id, Point[]> = {};
  for (const id of Object.keys(elements).sort()) {
    const element = elements[id]!;
    if (!isConnection(element)) continue;
    const entry = document.layout[id];
    if (!entry || isEntityLayout(entry) || entry.waypoints.length === 0) continue;

    const ends = [...element.from, ...element.to].filter((end) => original.has(end));
    if (ends.length === 0) continue;
    const delta = {
      x: Math.round(
        ends.reduce((sum, end) => sum + next.get(end)!.x - original.get(end)!.x, 0) / ends.length,
      ),
      y: Math.round(
        ends.reduce((sum, end) => sum + next.get(end)!.y - original.get(end)!.y, 0) / ends.length,
      ),
    };
    if (delta.x === 0 && delta.y === 0) continue;
    waypoints[id] = entry.waypoints.map((point) => ({
      x: point.x + delta.x,
      y: point.y + delta.y,
    }));
  }

  const positions: Record<Id, Point> = {};
  for (const id of [...next.keys()].sort()) {
    const was = original.get(id)!;
    const now = next.get(id)!;
    if (was.x !== now.x || was.y !== now.y) positions[id] = { x: now.x, y: now.y };
  }

  const expanded: Record<Id, Size> = {};
  for (const id of [...grownContainers.keys()].sort()) {
    const size = grownContainers.get(id)!;
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
