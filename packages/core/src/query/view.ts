import { isConnection, type Element, type Id } from '../model/types.js';
import type { AppState } from '../commands/types.js';
import { selectIds } from './filter.js';
import { ancestorsOf, visibleAnchor } from './groups.js';

/**
 * Viewing tools: three ways a reader focuses a crowded board, and one place
 * deciding how they compose.
 *
 * - Hiding an element mutes it and removes its connections from the board.
 * - Selecting elements highlights them with their direct connections and
 *   peers, and mutes the rest.
 * - The tag filter mutes elements that do not match.
 *
 * Precedence: hiding beats highlighting beats filtering, except that a
 * directly selected element is never muted, since the reader is pointing at
 * it. See docs/decisions/009-viewing-tools.md.
 */

/** Hidden ids plus everything inside a hidden group, at any depth. */
export function hiddenElementIds(
  elements: Record<Id, Element>,
  hidden: readonly Id[],
): Set<Id> {
  const chosen = new Set(hidden);
  const closed = new Set<Id>();
  for (const id of Object.keys(elements)) {
    if (chosen.has(id) || ancestorsOf(elements, id).some((group) => chosen.has(group))) {
      closed.add(id);
    }
  }
  return closed;
}

/**
 * Connections that are not drawn at all: hidden themselves, or touching a
 * hidden element. "Touching" is judged where the connection lands on the
 * board, so a hidden member of a collapsed group does not take down the line
 * pointing at the group that stands in for it.
 */
export function suppressedConnectionIds(
  elements: Record<Id, Element>,
  expanded: ReadonlySet<Id>,
  hidden: ReadonlySet<Id>,
): Set<Id> {
  const suppressed = new Set<Id>();
  for (const element of Object.values(elements)) {
    if (!isConnection(element)) continue;
    if (hidden.has(element.id)) {
      suppressed.add(element.id);
      continue;
    }
    const anchors = [...element.from, ...element.to].map((end) =>
      visibleAnchor(elements, end, expanded),
    );
    if (anchors.some((anchor) => hidden.has(anchor))) suppressed.add(element.id);
  }
  return suppressed;
}

export interface BoardEmphasis {
  /** Elements drawn faded. */
  muted: Set<Id>;
  /** Connections not drawn at all. */
  suppressed: Set<Id>;
}

/** What every element on the board renders as, given the whole session. */
export function boardEmphasis(state: AppState): BoardEmphasis {
  const elements = state.document.model.elements;
  const expanded = new Set(state.expanded);
  const hidden = hiddenElementIds(elements, state.hidden);
  const suppressed = suppressedConnectionIds(elements, expanded, hidden);

  const muted = new Set<Id>();
  const selection = state.selection.filter((id) => elements[id]);

  if (selection.length > 0) {
    // The selection and everything one drawn connection away stays readable.
    const chosen = new Set(selection);
    const near = new Set<Id>(selection);
    for (const id of selection) {
      const element = elements[id];
      if (element && isConnection(element) && !suppressed.has(id)) {
        for (const end of [...element.from, ...element.to]) {
          near.add(visibleAnchor(elements, end, expanded));
        }
      }
    }
    for (const element of Object.values(elements)) {
      if (!isConnection(element) || suppressed.has(element.id)) continue;
      const anchors = [...element.from, ...element.to].map((end) =>
        visibleAnchor(elements, end, expanded),
      );
      if (!anchors.some((anchor) => chosen.has(anchor))) continue;
      near.add(element.id);
      for (const anchor of anchors) near.add(anchor);
    }
    for (const id of Object.keys(elements)) {
      if (!near.has(id)) muted.add(id);
    }
  } else {
    const matching = selectIds(elements, state.filter);
    for (const id of Object.keys(elements)) {
      if (!matching.has(id)) muted.add(id);
    }
  }

  for (const id of hidden) muted.add(id);
  // The reader is pointing at a selected element, so it stays readable even
  // when hidden: that is how it gets shown again.
  for (const id of selection) muted.delete(id);

  return { muted, suppressed };
}

export interface Relation {
  connectionId: Id;
  /** The element at the other end, as it appears on the board. */
  peerId: Id;
}

/**
 * Where a reader can go from an element: every drawn connection touching it,
 * paired with the element at the other end. Feeds the pan-to-relation
 * control. Ends are resolved to their visible anchors, and suppressed
 * connections are left out, so every relation returned is on the board.
 */
export function relationsOf(state: AppState, id: Id): Relation[] {
  const elements = state.document.model.elements;
  const expanded = new Set(state.expanded);
  const hidden = hiddenElementIds(elements, state.hidden);
  const suppressed = suppressedConnectionIds(elements, expanded, hidden);
  const self = visibleAnchor(elements, id, expanded);

  const relations: Relation[] = [];
  const seen = new Set<string>();
  const add = (connectionId: Id, peerId: Id): void => {
    const key = `${connectionId} ${peerId}`;
    if (seen.has(key)) return;
    seen.add(key);
    relations.push({ connectionId, peerId });
  };

  for (const element of Object.values(elements)) {
    if (!isConnection(element) || suppressed.has(element.id)) continue;
    const from = element.from.map((end) => visibleAnchor(elements, end, expanded));
    const to = element.to.map((end) => visibleAnchor(elements, end, expanded));
    if (from.includes(self)) {
      for (const peer of to) if (peer !== self) add(element.id, peer);
    }
    if (to.includes(self)) {
      for (const peer of from) if (peer !== self) add(element.id, peer);
    }
  }

  return relations.sort(
    (a, b) =>
      a.connectionId.localeCompare(b.connectionId) || a.peerId.localeCompare(b.peerId),
  );
}
