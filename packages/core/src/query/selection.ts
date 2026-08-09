import { isConnection, type Element, type Id } from '../model/types.js';
import type { AppState } from '../commands/types.js';
import { connectionAnchors, descendantsOf, isRendered } from './groups.js';
import { hiddenElementIds, suppressedConnectionIds } from './view.js';

/**
 * Selection gestures (issue #27). Ctrl+click toggles one element, and on a
 * group that toggle speaks for the group's visible members too. Ctrl+A
 * selects everything drawn on the board. Both stop at what the reader can
 * see: members of a collapsed group and elements the reader put away stay
 * out, since pulling them in would act on things that are not on the board.
 * See docs/decisions/012-selection-gestures.md.
 */

/**
 * The ids one ctrl+click on `id` toggles: the element itself plus, for a
 * group, every visible member at any depth. A member is visible when no
 * group above it is collapsed and the reader has not put it away. On a
 * collapsed group only the group toggles: it already stands in for its
 * members, and the emphasis rule reads it that way.
 */
export function selectionSpanOf(
  elements: Record<Id, Element>,
  expanded: ReadonlySet<Id>,
  hidden: readonly Id[],
  id: Id,
): Id[] {
  const putAway = hiddenElementIds(elements, hidden);
  const span = [id];
  for (const member of descendantsOf(elements, id)) {
    if (isRendered(elements, member, expanded) && !putAway.has(member)) span.push(member);
  }
  return span;
}

/**
 * Every element drawn on the board, sorted: entities and connection nodes
 * outside any collapsed group and not put away, plus each connection that
 * draws as an edge (its ends resolve to different anchors and none of them
 * is hidden). This is what ctrl+A selects.
 */
export function visibleElementIds(state: AppState): Id[] {
  const elements = state.document.model.elements;
  const expanded = new Set(state.expanded);
  const putAway = hiddenElementIds(elements, state.hidden);
  const suppressed = suppressedConnectionIds(elements, expanded, putAway);

  const ids: Id[] = [];
  for (const id of Object.keys(elements).sort()) {
    const element = elements[id];
    if (!element) continue;
    if (isConnection(element)) {
      if (!suppressed.has(id) && connectionAnchors(elements, id, expanded) !== null) {
        ids.push(id);
      }
    } else if (isRendered(elements, id, expanded) && !putAway.has(id)) {
      ids.push(id);
    }
  }
  return ids;
}
