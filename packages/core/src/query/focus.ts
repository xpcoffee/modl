import { isConnection, isEntityLayout, type Element, type ElementLayout, type Id } from '../model/types.js';
import type { AppState } from '../commands/types.js';
import { planCompact } from './compact.js';
import { focusHiddenIds } from './view.js';
import type { ReflowPlan } from './reflow.js';

/**
 * The compact layout focus mode draws (issues #76, #84). With the mode on,
 * the visible elements move closer together, keeping their reading order.
 * The pack reads the session's filter and expansion state, so a filter
 * shrinks the board to the matching flow, a collapse closes the space the
 * group's expanded footprint held, and an expand opens it again.
 *
 * The plan is a transient view, which is the whole difference from the
 * compact control: it never travels in a `reflow-layout` command, never
 * writes to the document, and never enters the undo history. It is
 * recomputed from the session and dropped the moment the mode turns off,
 * and every element then stands at its saved position.
 */

/**
 * Plans the compact layout for the elements focus mode leaves visible, or
 * null when the mode is off or nothing would move. The elements a filter
 * removes are treated as absent rather than pinned: the pack runs over a
 * board that never held them, so what remains closes up over the space they
 * occupied and a partly-emptied container refits around the members still
 * showing.
 */
export function planFocusLayout(state: AppState): ReflowPlan | null {
  if (!state.focusMode) return null;
  const removed = focusHiddenIds(state);

  const elements: Record<Id, Element> = {};
  for (const [id, element] of Object.entries(state.document.model.elements)) {
    if (removed.has(id)) continue;
    // A connection follows its endpoint off the board, and its bends with it.
    if (isConnection(element) && [...element.from, ...element.to].some((end) => removed.has(end))) {
      continue;
    }
    elements[id] = element;
  }

  const layout: Record<Id, ElementLayout> = {};
  for (const [id, entry] of Object.entries(state.document.layout)) {
    if (elements[id]) layout[id] = entry;
  }

  // Comment cards stay at their pinned positions: the overlay moves model
  // elements only, and a card is brought forward by selection, not by the
  // filter, so packing it would move it for no reason the reader can see.
  const document = {
    ...state.document,
    model: { ...state.document.model, elements },
    layout,
    comments: {},
  };
  return planCompact({ document, expanded: state.expanded });
}

/**
 * The session as focus mode draws it: the same state with the compact plan
 * merged into the layout, and the state itself untouched. The identity of
 * the return value says whether anything is overlaid: it is the input state
 * exactly when there is no plan to draw.
 */
export function focusLayoutState(state: AppState): AppState {
  const plan = planFocusLayout(state);
  if (!plan) return state;

  const layout: Record<Id, ElementLayout> = { ...state.document.layout };
  for (const [id, at] of Object.entries(plan.positions)) {
    const entry = layout[id];
    if (entry && isEntityLayout(entry)) layout[id] = { ...entry, x: at.x, y: at.y };
  }
  for (const [id, points] of Object.entries(plan.waypoints)) {
    const entry = layout[id];
    if (entry && !isEntityLayout(entry)) {
      layout[id] = { ...entry, waypoints: points.map((point) => ({ ...point })) };
    }
  }
  for (const [id, size] of Object.entries(plan.expanded)) {
    const entry = layout[id];
    if (entry && isEntityLayout(entry)) layout[id] = { ...entry, expanded: { ...size } };
  }
  return { ...state, document: { ...state.document, layout } };
}
