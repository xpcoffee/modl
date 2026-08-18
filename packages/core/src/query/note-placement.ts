import {
  NOTE_CARD_SIZE,
  isConnection,
  isEntityLayout,
  type Id,
  type Note,
  type Point,
} from '../model/types.js';
import type { AppState } from '../commands/types.js';
import { renderedCentre, type Rect } from './card-placement.js';
import { focusLayoutState } from './focus.js';
import { allNotes } from './notes.js';
import { focusHiddenIds } from './view.js';
import { isRendered } from './groups.js';

/**
 * Where every note card sits on the board (issue #105). The renderer used to
 * derive an unpinned card's place from its targets alone, and a focus
 * compaction (decision 027) moved the elements out from under the pins, so
 * cards landed on top of element boxes. This derivation runs where the focus
 * layout already computes element positions, so the app renders what the core
 * derives: a pin the reader placed holds while the board draws its saved
 * geometry, and every other card starts above its targets and rises until it
 * covers no element box and no other card.
 */

/**
 * Where an unpinned card hangs off its targets' centroid: above them, where
 * comment cards hang below, so an element carrying both never draws the two
 * cards on top of each other.
 */
const DERIVED_OFFSET = {
  x: -NOTE_CARD_SIZE.width / 2,
  y: -NOTE_CARD_SIZE.height - 48,
} as const;

/** Clearance a rising card keeps from the box it cleared. */
const CARD_CLEARANCE = 16;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The targets' centroid plus the offset, or null for a document-level note. */
function centroidCard(anchors: readonly Point[]): Point | null {
  const first = anchors[0];
  if (first === undefined) return null;
  const centroid = anchors.reduce(
    (sum, point) => ({
      x: sum.x + point.x / anchors.length,
      y: sum.y + point.y / anchors.length,
    }),
    { x: 0, y: 0 },
  );
  return { x: centroid.x + DERIVED_OFFSET.x, y: centroid.y + DERIVED_OFFSET.y };
}

/**
 * Where unpinned document-level notes stack: above the content, apart from
 * the left edge where unpinned general remarks sit. A document-level note
 * normally arrives pinned where it was double-clicked; this fallback is for
 * files that carry one without a pin.
 */
function documentFallback(state: AppState, index: number): Point {
  const boxes = Object.values(state.document.layout).filter(isEntityLayout);
  const left = boxes.length === 0 ? 0 : Math.min(...boxes.map((box) => box.x));
  const top = boxes.length === 0 ? 0 : Math.min(...boxes.map((box) => box.y));
  return {
    x: left + index * (NOTE_CARD_SIZE.width + CARD_CLEARANCE),
    y: top - NOTE_CARD_SIZE.height - 60,
  };
}

/**
 * The card rises straight up from where it wants to sit until it covers
 * nothing. Rising keeps it centred over its targets, and the pass over the
 * solids repeats because clearing one box can push the card into another;
 * every step moves the card at least the clearance upward, so it ends above
 * whatever stack of boxes stood in the way.
 */
function risenClear(wanted: Point, solids: readonly Rect[]): Point {
  const at = { ...wanted };
  for (;;) {
    const covered = solids.filter((solid) => overlaps({ ...at, ...NOTE_CARD_SIZE }, solid));
    if (covered.length === 0) return at;
    at.y = Math.min(...covered.map((solid) => solid.y)) - NOTE_CARD_SIZE.height - CARD_CLEARANCE;
  }
}

/**
 * A position for every note card the board draws, keyed by note id. Cards
 * focus mode removed get none: they draw nowhere.
 *
 * A pin the reader placed holds exactly while the board draws its saved
 * geometry. The moment focus mode overlays a compacted layout, the pins stop
 * describing the board the reader sees, so every card derives from its
 * targets' compacted positions instead; the pin itself is never written, so
 * leaving the mode restores it, the same transient-view rule the layout
 * follows (decision 027).
 *
 * A derived card starts above its targets' centroid and rises clear of every
 * rendered element box and every card already placed. An expanded container
 * is an outline whose interior a card may share; its members are the solids a
 * card must clear. The card's box is `NOTE_CARD_SIZE`: the rendered height is
 * content-driven, so a card taller than the nominal size can still brush the
 * box above it.
 *
 * `drawn` overrides where a target's centre reads from, letting a card follow
 * an element mid-drag, the same override `renderedCentre` takes.
 */
export function noteCardPlacements(
  state: AppState,
  drawn?: (id: Id) => Point | undefined,
): Map<Id, Point> {
  const shown = focusLayoutState(state);
  const focusOverlaid = shown !== state;
  const removed = focusHiddenIds(state);
  const elements = shown.document.model.elements;
  const expanded = new Set(shown.expanded);

  const solids: Rect[] = [];
  for (const id of Object.keys(elements).sort()) {
    const element = elements[id]!;
    if (isConnection(element) || removed.has(id)) continue;
    if (!isRendered(elements, id, expanded) || expanded.has(id)) continue;
    const entry = shown.document.layout[id];
    if (!entry || !isEntityLayout(entry)) continue;
    solids.push({ x: entry.x, y: entry.y, width: entry.width, height: entry.height });
  }

  const placements = new Map<Id, Point>();
  const deriving: Note[] = [];
  for (const note of allNotes(state.document.model.notes)) {
    if (removed.has(note.id)) continue;
    const pin = shown.document.layout[note.id];
    if (pin && isEntityLayout(pin) && !focusOverlaid) {
      placements.set(note.id, { x: pin.x, y: pin.y });
      solids.push({ x: pin.x, y: pin.y, ...NOTE_CARD_SIZE });
    } else {
      deriving.push(note);
    }
  }

  let unpinnedDocumentNotes = 0;
  for (const note of deriving) {
    const anchors = note.targets
      .map((target) => renderedCentre(shown, target, drawn))
      .filter((point): point is Point => point !== null);
    const wanted = centroidCard(anchors) ?? documentFallback(shown, unpinnedDocumentNotes++);
    const at = risenClear(wanted, solids);
    placements.set(note.id, at);
    solids.push({ ...at, ...NOTE_CARD_SIZE });
  }
  return placements;
}
