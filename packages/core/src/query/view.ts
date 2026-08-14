import { isConnection, type Comment, type Element, type Id, type Note } from '../model/types.js';
import type { AppState } from '../commands/types.js';
import { notesMatchingTagTerms, parseFilter, selectIds } from './filter.js';
import { ancestorsOf, descendantsOf, visibleAnchor } from './groups.js';

/**
 * Viewing tools: three ways a reader focuses a crowded board, and one place
 * deciding how they compose.
 *
 * - Hiding an element mutes it and removes its connections from the board.
 * - Selecting elements highlights them with their direct connections and
 *   peers, and mutes the rest. A selected group counts its members, at every
 *   depth, as selected. A preference (`selectionHighlight`) turns this off.
 * - The tag filter mutes elements that do not match. A group above a match
 *   counts as matching, so a match inside a collapsed group still guides the
 *   reader to the group holding it. A matching connection's endpoints count
 *   too, so a filter whose only matches are connections still draws them
 *   (issue #92).
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
  for (const [id, element] of Object.entries(elements)) {
    // The reducer refuses to hide a connection; a connection id arriving here
    // anyway (an old trace) is ignored rather than treated as hidden.
    if (isConnection(element)) continue;
    if (chosen.has(id) || ancestorsOf(elements, id).some((group) => chosen.has(group))) {
      closed.add(id);
    }
  }
  return closed;
}

/**
 * Connections that are not drawn at all because they touch a hidden element.
 * "Touching" is judged where the connection lands on the board, so a hidden
 * member of a collapsed group does not take down the line pointing at the
 * group that stands in for it.
 */
export function suppressedConnectionIds(
  elements: Record<Id, Element>,
  expanded: ReadonlySet<Id>,
  hidden: ReadonlySet<Id>,
): Set<Id> {
  const suppressed = new Set<Id>();
  for (const element of Object.values(elements)) {
    if (!isConnection(element)) continue;
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
  /**
   * Matching descendants per group while the filter decides emphasis. A
   * collapsed group draws this as a badge, so the reader knows expanding it
   * finds the matches.
   */
  descendantMatches: Map<Id, number>;
}

/**
 * What the tag filter emphasises: every match, plus each group above one, so
 * a match inside a collapsed group guides the reader to the group holding it.
 * Hidden matches stay silent: hiding beats filtering, so a match the reader
 * put away neither unmutes nor counts towards the groups above it.
 */
export function filterGuidance(
  elements: Record<Id, Element>,
  expression: string,
  hidden: ReadonlySet<Id>,
  comments: Record<Id, Comment> = {},
  notes: Record<Id, Note> = {},
): { emphasised: Set<Id>; descendantMatches: Map<Id, number> } {
  const emphasised = selectIds(elements, expression, comments, notes);
  const descendantMatches = new Map<Id, number>();

  const parsed = parseFilter(expression);
  if (!parsed.ok || parsed.terms.length === 0) return { emphasised, descendantMatches };

  // One walk up each match's group chain covers every group on the board.
  for (const id of [...emphasised]) {
    if (hidden.has(id)) continue;
    for (const group of ancestorsOf(elements, id)) {
      emphasised.add(group);
      descendantMatches.set(group, (descendantMatches.get(group) ?? 0) + 1);
    }
  }
  return { emphasised, descendantMatches };
}

/** What every element on the board renders as, given the whole session. */
export function boardEmphasis(state: AppState): BoardEmphasis {
  const elements = state.document.model.elements;
  const expanded = new Set(state.expanded);
  const hidden = hiddenElementIds(elements, state.hidden);
  const suppressed = suppressedConnectionIds(elements, expanded, hidden);

  const muted = new Set<Id>();
  let descendantMatches = new Map<Id, number>();
  // A selected comment or note stands for the elements it speaks about, so
  // its targets highlight exactly as if the reader had pointed at them.
  const selection = state.selection.flatMap((id) =>
    elements[id]
      ? [id]
      : ((state.document.comments[id] ?? state.document.model.notes[id])?.targets.filter(
          (target) => elements[target],
        ) ?? []),
  );

  if (selection.length > 0 && state.selectionHighlight) {
    // The selection and everything one drawn connection away stays readable.
    // A selected group speaks for its members at every depth, so they join
    // the selection here and their connections highlight by the same rule.
    const chosen = new Set(selection);
    for (const id of selection) {
      for (const member of descendantsOf(elements, id)) chosen.add(member);
    }
    const near = new Set<Id>(chosen);
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
    const guidance = filterGuidance(
      elements,
      state.filter,
      hidden,
      state.document.comments,
      state.document.model.notes,
    );
    descendantMatches = guidance.descendantMatches;
    for (const id of Object.keys(elements)) {
      if (!guidance.emphasised.has(id)) muted.add(id);
    }
  }

  for (const id of hidden) muted.add(id);
  // The reader is pointing at a selected element, so it stays readable even
  // when hidden: that is how it gets shown again.
  for (const id of selection) muted.delete(id);

  return { muted, suppressed, descendantMatches };
}

/**
 * Elements focus mode removes from the board entirely: with the mode on and a
 * filter active, everything the filter neither matches nor promotes goes
 * unrendered instead of dimming. Connections are not listed; a connection
 * leaves the board when an endpoint does, judged by the renderer against its
 * visible anchors.
 *
 * Three kinds of element stay put, with their enclosing groups kept so what
 * remains still has somewhere to render:
 * - matches and the groups above them (`filterGuidance`);
 * - the selection, since the reader is pointing at it;
 * - elements the reader explicitly hid, which keep the hidden treatment
 *   (drawn muted) rather than joining the removal.
 */
export function focusHiddenIds(state: AppState): Set<Id> {
  const removed = new Set<Id>();
  if (!state.focusMode) return removed;
  const parsed = parseFilter(state.filter);
  if (!parsed.ok || parsed.terms.length === 0) return removed;

  const elements = state.document.model.elements;
  const hidden = hiddenElementIds(elements, state.hidden);
  const { emphasised } = filterGuidance(
    elements,
    state.filter,
    hidden,
    state.document.comments,
    state.document.model.notes,
  );

  // A selected comment or note stands for the elements it speaks about,
  // matching how boardEmphasis reads the selection.
  const selection = state.selection.flatMap((id) =>
    elements[id]
      ? [id]
      : ((state.document.comments[id] ?? state.document.model.notes[id])?.targets.filter(
          (target) => elements[target],
        ) ?? []),
  );

  const kept = new Set<Id>();
  for (const id of [...emphasised, ...selection, ...hidden]) {
    if (!elements[id]) continue;
    kept.add(id);
    for (const group of ancestorsOf(elements, id)) kept.add(group);
  }

  for (const [id, element] of Object.entries(elements)) {
    if (isConnection(element)) continue;
    if (!kept.has(id)) removed.add(id);
  }
  return removed;
}

/**
 * Notes whose cards belong on the board. A card is revealed rather than
 * always drawn, so the notes written against one situation stay out of the
 * way of a reader working in another; the badge on each target is what says
 * a note exists while its card is away (issue #83 review, decision 030).
 *
 * Two things reveal a card. The reader points at it, meaning the note or one
 * of the elements it describes is selected; a document-level note has no
 * targets, so only its own selection does that. Or a committed filter names
 * a context the note carries: the expression parses, holds at least one
 * non-negated tag term, and every tag term in it holds against the note's
 * tags, so `context=refunds -area=billing` reveals a refunds note that is not
 * tagged area=billing. Only tags reveal, because a text term, a bare `note`,
 * and `note=text` all pick elements rather than name a context.
 *
 * Notes mode is absent here: it is app state, and that layer draws every
 * card because it is where notes are written.
 */
export function visibleNoteIds(state: AppState): Set<Id> {
  const notes = state.document.model.notes;
  const selected = new Set(state.selection);
  const visible = new Set<Id>();
  for (const [id, note] of Object.entries(notes)) {
    if (selected.has(id) || note.targets.some((target) => selected.has(target))) visible.add(id);
  }

  const parsed = parseFilter(state.filter);
  if (!parsed.ok) return visible;
  if (!parsed.terms.some((term) => term.kind === 'tag' && !term.negated)) return visible;
  for (const id of notesMatchingTagTerms(notes, parsed.terms)) visible.add(id);
  return visible;
}

export interface Relation {
  connectionId: Id;
  /** The element at the other end, as it appears on the board. */
  peerId: Id;
}

/**
 * Where a reader can go from an element: every drawn connection touching it,
 * paired with the element at the other end. Feeds the relations menu. Ends
 * are resolved to their visible anchors; suppressed connections and peers
 * focus mode removed are left out, so every relation returned is on the
 * board the reader sees.
 */
export function relationsOf(state: AppState, id: Id): Relation[] {
  const elements = state.document.model.elements;
  const expanded = new Set(state.expanded);
  const hidden = hiddenElementIds(elements, state.hidden);
  const suppressed = suppressedConnectionIds(elements, expanded, hidden);
  const focusHidden = focusHiddenIds(state);
  const self = visibleAnchor(elements, id, expanded);
  if (focusHidden.has(self)) return [];

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
      for (const peer of to) if (peer !== self && !focusHidden.has(peer)) add(element.id, peer);
    }
    if (to.includes(self)) {
      for (const peer of from) if (peer !== self && !focusHidden.has(peer)) add(element.id, peer);
    }
  }

  return relations.sort(
    (a, b) =>
      a.connectionId.localeCompare(b.connectionId) || a.peerId.localeCompare(b.peerId),
  );
}
