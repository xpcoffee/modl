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
/** Estimated height of a one-line label pill. */
const LABEL_HEIGHT = 24;
/** Clearance a label keeps from a box it is not attached to. */
const LABEL_BOX_CLEARANCE = 12;
/** Clearance two labels keep from each other. */
const LABEL_LABEL_CLEARANCE = 8;

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

/**
 * A label drawn at the midpoint of the line between two anchors. It has no
 * position of its own: it rides wherever its endpoints put it, so the solver
 * clears space for it by moving boxes, never the label itself.
 *
 * `a` and `b` are the boxes the solver moves. When the line crosses a
 * container boundary those are the containers, while the label itself draws
 * between two members inside them; each offset points from its box's centre
 * to the anchor the line actually meets. Members ride rigidly with their
 * container while a scope solves, so the offsets hold still and the label
 * rect the solver clears is the one the reader sees.
 */
interface LabelObstacle {
  a: Id;
  b: Id;
  offsetA: Point;
  offsetB: Point;
  /** The elements the line actually meets, so their own boxes never repel it. */
  anchorA: Id;
  anchorB: Id;
  width: number;
}

/**
 * A solid box drawn inside one of the scope's boxes: a member of an expanded
 * group, riding its container rigidly while the scope solves. The solver
 * cannot move it on its own, but a label crossing the container has to clear
 * it, and the container eases aside to make that true.
 */
interface Satellite {
  /** The scope box that moves when this satellite has to give way. */
  rep: Id;
  /** The satellite's origin relative to the rep's origin. */
  offset: Point;
  width: number;
  height: number;
  /** The element drawn here, so a label's own anchor never repels it. */
  element: Id;
}

function pairKey(a: Id, b: Id): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/** Clearance between two rectangles per axis: negative while they overlap. */
function clearance(a: Box, b: Box): Point {
  return {
    x: Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width)),
    y: Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height)),
  };
}

/**
 * Moves boxes apart until every pair has clearance on at least one axis, and
 * every line label has room where it is drawn. Each pair separates along the
 * axis of its starting offset (two elements side by side spread sideways,
 * two stacked spread vertically) and keeps the order it started with. Both
 * are measured once, before anything moves, so a push from a third element
 * can never flip two others past each other: the arrangement the reader
 * knows survives the re-spacing.
 *
 * A label rides the midpoint of its two endpoints, so the solver clears it
 * by moving boxes: the covered box eases away and the label's endpoints ease
 * the other way, which carries the label with them.
 */
function separate(
  input: Box[],
  gapOf: (a: Id, b: Id) => Point,
  labels: LabelObstacle[],
  satellites: Satellite[],
  pinned: Box[],
  outlines: ReadonlySet<Id>,
): Map<Id, Point> {
  // Reading order, so a pair starting in exactly the same place spreads with
  // the earlier element up-and-left of the later.
  const boxes = input
    .map((box) => ({ ...box }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  // Pinned boxes are the frozen world around the scope: labels clear them
  // and lines may end on them, and no push ever moves them.
  const still = new Set(pinned.map((box) => box.id));
  const byId = new Map([...pinned, ...boxes].map((box) => [box.id, box]));
  const origin = new Map(
    [...pinned, ...boxes].map((box) => [
      box.id,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    ]),
  );

  const drawn = labels.filter(
    (label) => byId.has(label.a) && byId.has(label.b) && label.a !== label.b,
  );
  const centreOf = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const rectOf = (label: LabelObstacle): Box => {
    const a = centreOf(byId.get(label.a)!);
    const b = centreOf(byId.get(label.b)!);
    return {
      id: '',
      x: (a.x + label.offsetA.x + b.x + label.offsetB.x) / 2 - label.width / 2,
      y: (a.y + label.offsetA.y + b.y + label.offsetB.y) / 2 - LABEL_HEIGHT / 2,
      width: label.width,
      height: LABEL_HEIGHT,
    };
  };
  // Where each label started, so its pushes keep one direction across rounds
  // the same way box pushes do.
  const labelOrigin = drawn.map((label) => centreOf(rectOf(label)));

  // Everything a label has to clear: the scope's solid boxes, the frozen
  // world around them, and the solid members drawn inside them. An expanded
  // container stays out: it is an outline, its lines run through its empty
  // interior, and a label between two containers' members has to be allowed
  // to cross it.
  const coverables = [
    ...[...boxes, ...pinned]
      .filter((box) => !outlines.has(box.id))
      .map((box) => ({
        push: box.id,
        offset: { x: 0, y: 0 },
        width: box.width,
        height: box.height,
        element: box.id,
      })),
    ...satellites
      .filter((satellite) => byId.has(satellite.rep))
      .map((satellite) => ({
        push: satellite.rep,
        offset: satellite.offset,
        width: satellite.width,
        height: satellite.height,
        element: satellite.element,
      })),
  ];
  const coverableRect = (cover: (typeof coverables)[number]): Box => {
    const rep = byId.get(cover.push)!;
    return {
      id: '',
      x: rep.x + cover.offset.x,
      y: rep.y + cover.offset.y,
      width: cover.width,
      height: cover.height,
    };
  };
  const coverableOrigin = coverables.map((cover) => centreOf(coverableRect(cover)));

  /** Moves a box unless it is pinned. True when something actually moved:
   * a push swallowed whole by the frozen world must not count as progress,
   * or an unsatisfiable constraint would spin the rounds to their ceiling. */
  const nudge = (id: Id, dx: number, dy: number): boolean => {
    if (still.has(id)) return false;
    const box = byId.get(id)!;
    box.x += dx;
    box.y += dy;
    return true;
  };

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
        const clear = clearance(a, b);
        if (clear.x >= gap.x || clear.y >= gap.y) continue;

        const offset = {
          x: origin.get(b.id)!.x - origin.get(a.id)!.x,
          y: origin.get(b.id)!.y - origin.get(a.id)!.y,
        };
        // One pixel over what the gap asks, so the per-element rounding
        // applied when the plan lands cannot leave a pair a fraction short
        // and give a second press work to find.
        if (Math.abs(offset.x) >= Math.abs(offset.y)) {
          const sign = offset.x === 0 ? 1 : Math.sign(offset.x);
          const need = gap.x - clear.x + 1;
          a.x -= (sign * need) / 2;
          b.x += (sign * need) / 2;
        } else {
          const sign = Math.sign(offset.y);
          const need = gap.y - clear.y + 1;
          a.y -= (sign * need) / 2;
          b.y += (sign * need) / 2;
        }
        moved = true;
      }
    }

    // A label covered by a box it is not attached to: the box (or the
    // container carrying it) eases away and the label's endpoints ease the
    // other way, half each, so the space opens from both sides.
    for (let l = 0; l < drawn.length; l += 1) {
      const label = drawn[l]!;
      const rect = rectOf(label);
      for (let c = 0; c < coverables.length; c += 1) {
        const cover = coverables[c]!;
        if (
          cover.element === label.a ||
          cover.element === label.b ||
          cover.element === label.anchorA ||
          cover.element === label.anchorB
        ) {
          continue;
        }
        const clear = clearance(rect, coverableRect(cover));
        if (clear.x >= LABEL_BOX_CLEARANCE || clear.y >= LABEL_BOX_CLEARANCE) continue;

        const offset = {
          x: coverableOrigin[c]!.x - labelOrigin[l]!.x,
          y: coverableOrigin[c]!.y - labelOrigin[l]!.y,
        };
        // Two pixels over: a label's spot is the average of two rounded
        // boxes, so it needs more slack than a box does for a second press
        // to find it still clear.
        if (Math.abs(offset.x) >= Math.abs(offset.y)) {
          const sign = offset.x === 0 ? 1 : Math.sign(offset.x);
          const need = LABEL_BOX_CLEARANCE - clear.x + 2;
          moved = nudge(cover.push, (sign * need) / 2, 0) || moved;
          moved = nudge(label.a, (-sign * need) / 2, 0) || moved;
          moved = nudge(label.b, (-sign * need) / 2, 0) || moved;
        } else {
          const sign = offset.y === 0 ? 1 : Math.sign(offset.y);
          const need = LABEL_BOX_CLEARANCE - clear.y + 2;
          moved = nudge(cover.push, 0, (sign * need) / 2) || moved;
          moved = nudge(label.a, 0, (-sign * need) / 2) || moved;
          moved = nudge(label.b, 0, (-sign * need) / 2) || moved;
        }
      }
    }

    // Two labels on top of each other unstack vertically: a label is one
    // line tall, so the cheap move is always down or up, and it reads as the
    // pile fanning out. Two labels whose movable endpoints are the same
    // boxes cannot separate this way (the pushes cancel exactly), so they
    // are left alone; the renderer already fans parallel lines apart.
    const movableEnds = (label: LabelObstacle): string =>
      [label.a, label.b]
        .filter((id) => !still.has(id))
        .sort()
        .join(' ');
    for (let i = 0; i < drawn.length; i += 1) {
      for (let j = i + 1; j < drawn.length; j += 1) {
        const one = drawn[i]!;
        const two = drawn[j]!;
        if (movableEnds(one) === movableEnds(two)) continue;

        const clear = clearance(rectOf(one), rectOf(two));
        if (clear.x >= LABEL_LABEL_CLEARANCE || clear.y >= LABEL_LABEL_CLEARANCE) continue;

        const offset = labelOrigin[j]!.y - labelOrigin[i]!.y;
        const sign = offset === 0 ? 1 : Math.sign(offset);
        const need = LABEL_LABEL_CLEARANCE - clear.y + 2;
        moved = nudge(one.a, 0, (-sign * need) / 2) || moved;
        moved = nudge(one.b, 0, (-sign * need) / 2) || moved;
        moved = nudge(two.a, 0, (sign * need) / 2) || moved;
        moved = nudge(two.b, 0, (sign * need) / 2) || moved;
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

  // The widest label drawn between each pair of visible anchors: the
  // connection's own title at the line's midpoint, and a junction's answer
  // near its end. The gap between the separated boxes has to hold the widest
  // of them, and each drawn label is an obstacle other boxes and labels keep
  // clear of.
  const gapWidths = new Map<string, number>();
  const drawnLabels = new Map<string, { anchorA: Id; anchorB: Id; a: Id; b: Id; width: number }>();
  const noteLabel = (anchorA: Id, anchorB: Id, pair: [Id, Id], text: string | undefined): void => {
    if (text === undefined || text === '') return;
    const width = Math.ceil(text.length * LABEL_CHAR_WIDTH) + LABEL_PADDING;
    const gapKey = pairKey(pair[0], pair[1]);
    gapWidths.set(gapKey, Math.max(gapWidths.get(gapKey) ?? 0, width));
    const key = pairKey(anchorA, anchorB);
    const known = drawnLabels.get(key);
    if (!known || known.width < width) {
      drawnLabels.set(key, { anchorA, anchorB, a: pair[0], b: pair[1], width });
    }
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
        noteLabel(from, to, pair, element.title);
        for (const end of [from, to]) {
          const junction = elements[end];
          if (junction && isConnectionNode(junction)) {
            noteLabel(from, to, pair, junction.labels[element.id]);
          }
        }
      }
    }
  }

  // A label sits on one line, which the base vertical gap already clears, so
  // labels only ever widen the horizontal requirement.
  const gapOf = (a: Id, b: Id): Point => ({
    x: Math.max(GAP.x, (gapWidths.get(pairKey(a, b)) ?? 0) + LABEL_CLEARANCE),
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

  /** The centre of an element's drawn box, at its current position. */
  const centreAt = (id: Id): Point | null => {
    const at = next.get(id);
    if (!at) return null;
    const size = sizeOf(id);
    return { x: at.x + size.width / 2, y: at.y + size.height / 2 };
  };

  /**
   * The labels drawn inside a scope, ready for the solver: each one anchored
   * to the two boxes this scope moves, with offsets to where the line's ends
   * actually sit. Inner scopes settle before outer ones, so a member holds
   * still relative to its container and the offsets stay true while the
   * scope solves.
   */
  const scopeLabels = (inScope: ReadonlySet<Id>): LabelObstacle[] => {
    const list: LabelObstacle[] = [];
    for (const key of [...drawnLabels.keys()].sort()) {
      const label = drawnLabels.get(key)!;
      if (!inScope.has(label.a) || !inScope.has(label.b) || label.a === label.b) continue;
      const boxA = centreAt(label.a);
      const boxB = centreAt(label.b);
      const anchorA = centreAt(label.anchorA) ?? boxA;
      const anchorB = centreAt(label.anchorB) ?? boxB;
      if (!boxA || !boxB || !anchorA || !anchorB) continue;
      list.push({
        a: label.a,
        b: label.b,
        offsetA: { x: anchorA.x - boxA.x, y: anchorA.y - boxA.y },
        offsetB: { x: anchorB.x - boxB.x, y: anchorB.y - boxB.y },
        anchorA: label.anchorA,
        anchorB: label.anchorB,
        width: label.width,
      });
    }
    return list;
  };

  /**
   * The solid boxes drawn inside a scope's boxes: members of expanded groups,
   * each riding the ancestor this scope moves. An expanded container is an
   * outline, so it never becomes a satellite itself; what it holds does.
   */
  const scopeSatellites = (inScope: ReadonlySet<Id>): Satellite[] => {
    const list: Satellite[] = [];
    for (const id of Object.keys(elements).sort()) {
      const element = elements[id]!;
      if (isConnection(element) || inScope.has(id) || expandedGroups.has(id)) continue;
      if (!isRendered(elements, id, expandedGroups)) continue;
      const at = next.get(id);
      if (!at) continue;
      const rep = ancestorsOf(elements, id).find((ancestor) => inScope.has(ancestor));
      if (!rep) continue;
      const repAt = next.get(rep);
      if (!repAt) continue;
      list.push({
        rep,
        offset: { x: at.x - repAt.x, y: at.y - repAt.y },
        ...sizeOf(id),
        element: id,
      });
    }
    return list;
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

    const inScope = new Set(boxes.map((box) => box.id));
    const placed = separate(
      boxes,
      gapOf,
      scopeLabels(inScope),
      scopeSatellites(inScope),
      [],
      expandedGroups,
    );
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

  /** A group's movable content: its direct members and the cards pinned in it. */
  const membersInScope = (groupId: Id): Id[] =>
    [
      ...membersOf(elements, groupId)
        .filter((member) => !isConnection(member))
        .map((member) => member.id),
      ...(cardScopes.get(groupId) ?? []),
    ].filter((id) => next.has(id));

  /**
   * Grows a container around its members when one would poke out of it.
   * Refitting every time would shrink a box the reader sized on purpose.
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
    const current = { ...at, ...sizeOf(groupId) };
    const fits =
      bounds.minX >= current.x &&
      bounds.minY >= current.y &&
      bounds.maxX <= current.x + current.width &&
      bounds.maxY <= current.y + current.height;
    if (fits) return;

    const x = Math.round(bounds.minX - GROUP_PADDING.side);
    const y = Math.round(bounds.minY - GROUP_PADDING.top);
    // The container's own move carries nothing: its members are already placed.
    next.set(groupId, { x, y });
    grownContainers.set(groupId, {
      width: Math.max(Math.round(bounds.maxX + GROUP_PADDING.side) - x, MIN_GROUP_SIZE.width),
      height: Math.max(Math.round(bounds.maxY + GROUP_PADDING.bottom) - y, MIN_GROUP_SIZE.height),
    });
  };

  /**
   * Re-solves a group's members with the rest of the board frozen in place.
   *
   * The first pass over a scope cannot see where lines leaving the group go:
   * the outer boxes have not settled yet, so labels crossing the boundary are
   * solved against the containers, and two of them riding the same pair of
   * containers cannot separate at all. Once the whole board has settled, the
   * crossing labels have real geometry, and moving the members they start
   * from is the only lever that spreads them.
   */
  const reflowMembersInWorld = (groupId: Id, memberIds: Id[]): void => {
    const movable = new Set(memberIds);
    const boxes: Box[] = [...memberIds]
      .sort()
      .map((id) => ({ id, ...next.get(id)!, ...sizeOf(id) }));
    if (boxes.length === 0) return;

    // The frozen world: every rendered solid element that neither moves in
    // this pass nor rides something that does. Expanded containers stay out:
    // they are outlines, and a label may cross one.
    const pinned: Box[] = [];
    for (const id of Object.keys(elements).sort()) {
      const element = elements[id]!;
      if (isConnection(element) || movable.has(id) || expandedGroups.has(id)) continue;
      if (!isRendered(elements, id, expandedGroups)) continue;
      if (ancestorsOf(elements, id).some((ancestor) => movable.has(ancestor))) continue;
      const at = next.get(id);
      if (!at) continue;
      pinned.push({ id, ...at, ...sizeOf(id) });
    }
    const placeable = new Set([...movable, ...pinned.map((box) => box.id)]);

    // Labels with real geometry: each endpoint is its own anchor when the
    // solver can place it, or the movable ancestor carrying it. A label
    // whose ends both sit in the frozen world has nothing this pass can do.
    const worldLabels: LabelObstacle[] = [];
    for (const key of [...drawnLabels.keys()].sort()) {
      const label = drawnLabels.get(key)!;
      const endpoint = (anchor: Id): { rep: Id; offset: Point } | null => {
        if (placeable.has(anchor)) return { rep: anchor, offset: { x: 0, y: 0 } };
        const rep = [anchor, ...ancestorsOf(elements, anchor)].find((link) => movable.has(link));
        if (!rep) return null;
        const anchorCentre = centreAt(anchor);
        const repCentre = centreAt(rep);
        if (!anchorCentre || !repCentre) return null;
        return {
          rep,
          offset: { x: anchorCentre.x - repCentre.x, y: anchorCentre.y - repCentre.y },
        };
      };
      const endA = endpoint(label.anchorA);
      const endB = endpoint(label.anchorB);
      if (!endA || !endB || endA.rep === endB.rep) continue;
      if (!movable.has(endA.rep) && !movable.has(endB.rep)) continue;
      worldLabels.push({
        a: endA.rep,
        b: endB.rep,
        offsetA: endA.offset,
        offsetB: endB.offset,
        anchorA: label.anchorA,
        anchorB: label.anchorB,
        width: label.width,
      });
    }

    const placed = separate(
      boxes,
      gapOf,
      worldLabels,
      scopeSatellites(movable),
      pinned,
      expandedGroups,
    );
    // No re-anchoring here: a member shifting is the point of this pass, and
    // the container refit keeps the group's box around wherever they settle.
    for (const box of boxes) {
      const to = placed.get(box.id)!;
      moveWithDescendants(box.id, {
        x: Math.round(to.x) - box.x,
        y: Math.round(to.y) - box.y,
      });
    }
  };

  // The root scope: everything at the top level, and every card not pinned
  // inside a container. A card discusses the board from beside it, so it
  // needs room the same way a box does.
  const rootIds = Object.values(elements)
    .filter((element) => !isConnection(element) && element.groupId === null)
    .map((element) => element.id);

  const snapshot = (): Map<Id, Point> => new Map([...next].map(([id, at]) => [id, { ...at }]));
  const maxShift = (was: Map<Id, Point>): number =>
    Math.max(
      0,
      ...[...next].map(([id, at]) => {
        const from = was.get(id);
        return from === undefined ? 0 : Math.max(Math.abs(at.x - from.x), Math.abs(at.y - from.y));
      }),
    );

  /**
   * One full pass over the board: each group's members, the root, then each
   * group again with the world in view (lines leaving a group have somewhere
   * real to point only once the root has settled), refitting containers as
   * members claim room and letting the root separate a container that grew
   * into a neighbour.
   *
   * The inner cycle repeats while it keeps helping. Constraints that
   * genuinely conflict make a cycle move MORE than the one before (a member
   * push grows its container, the root pushes the containers apart, the
   * labels land somewhere new), so the loop stops at the first cycle that
   * moved further than its predecessor and puts that cycle back.
   */
  const pipeline = (): void => {
    for (const groupId of scopes) {
      const memberIds = membersInScope(groupId);
      if (memberIds.length === 0) continue;
      reflowScope(memberIds);
      refitContainer(groupId, memberIds);
    }
    reflowScope([...rootIds, ...(cardScopes.get(null) ?? [])]);

    let previousShift = Number.POSITIVE_INFINITY;
    for (let cycles = 0; cycles < 24; cycles += 1) {
      const before = snapshot();
      const beforeGrown = new Map([...grownContainers].map(([id, size]) => [id, { ...size }]));

      for (const groupId of [...scopes].reverse()) {
        const memberIds = membersInScope(groupId);
        if (memberIds.length === 0) continue;
        reflowMembersInWorld(groupId, memberIds);
        refitContainer(groupId, memberIds);
      }
      reflowScope([...rootIds, ...(cardScopes.get(null) ?? [])]);

      const shift = maxShift(before);
      if (shift === 0) break;
      if (shift >= previousShift) {
        next.clear();
        for (const [id, at] of before) next.set(id, at);
        grownContainers.clear();
        for (const [id, size] of beforeGrown) grownContainers.set(id, size);
        break;
      }
      previousShift = shift;
    }
  };

  // A pipeline run from a fresh vantage can improve on the last one's best:
  // the damped cycle stops short of conflict, and a restart from the settled
  // positions relaxes further. Repeat until a run holds still, which is also
  // what makes the plan a fixed point: pressing the button on its own output
  // computes nothing new.
  for (let runs = 0; runs < 6; runs += 1) {
    const before = snapshot();
    pipeline();
    if (maxShift(before) === 0) break;
  }

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
