import { isConnection, type Id, type Point } from '../model/types.js';
import type { AppState } from '../commands/types.js';
import { renderedCentre } from './card-placement.js';
import { connectionAnchors, visibleAnchor } from './groups.js';

/**
 * Where the camera goes when a reader chooses something to go to, and what
 * the arrival selects. The search menu and the relations roller both make
 * that move, and both have to answer the same two questions.
 */
export interface GoToTarget {
  /** Board point the camera centres on. */
  centre: Point;
  /** What the arrival selects: the element itself, or what stands in for it. */
  selectId: Id;
}

/** The midpoint of the box the points span, or null when there are none. */
function spanCentre(points: Point[]): Point | null {
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

/** Hand-placed bends the drawn line runs through. */
function waypointsOf(state: AppState, id: Id): Point[] {
  const entry = state.document.layout[id];
  return entry && 'waypoints' in entry ? entry.waypoints : [];
}

/**
 * Where to go for `id`, read off the layout the caller passes in. Pass
 * `focusLayoutState(state)` and the answer is where focus mode draws the
 * element; pass the state itself and it is the saved position.
 *
 * An entity or a junction hidden inside a collapsed group resolves to the
 * group standing in for it. A connection has no box of its own, so it
 * resolves to the middle of the line the board draws: the span of its
 * endpoints and any bends, which is where the label sits (issue #106).
 * Null when the element is unknown, or when nothing on the board stands
 * in for it.
 */
export function goToTarget(state: AppState, id: Id): GoToTarget | null {
  const elements = state.document.model.elements;
  const expanded = new Set(state.expanded);
  const element = elements[id];
  if (!element) return null;

  if (isConnection(element)) {
    const anchors = connectionAnchors(elements, id, expanded);
    if (anchors !== null) {
      const centre = spanCentre([
        ...[...anchors.from, ...anchors.to]
          .map((end) => renderedCentre(state, end))
          .filter((point): point is Point => point !== null),
        ...waypointsOf(state, id),
      ]);
      return centre === null ? null : { centre, selectId: id };
    }
    // Both ends collapsed into one group, so there is no line to go to. The
    // group swallowing it is the thing the reader can actually see.
    const end = element.from[0];
    if (end === undefined) return null;
    return goToTarget(state, visibleAnchor(elements, end, expanded));
  }

  const anchor = visibleAnchor(elements, id, expanded);
  const centre = renderedCentre(state, anchor);
  return centre === null ? null : { centre, selectId: anchor };
}
