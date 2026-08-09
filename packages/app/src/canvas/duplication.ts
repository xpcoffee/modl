import {
  duplicationSpan,
  isEntityLayout,
  isRendered,
  type AppState,
  type Id,
  type Point,
} from '@modl/core';
import { store } from '../store/store.js';

/**
 * Copying elements, app side (issue #29). Alt+drag and ctrl+V both land here:
 * work out what the copy covers, mint an id for each, and dispatch one
 * `duplicate-elements`. See docs/decisions/013-duplication.md.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What the reader copied, held until the next copy. Ids rather than a
 * snapshot, so a paste always produces a copy of what is on the board now;
 * anything deleted meanwhile simply drops out of the paste.
 *
 * A UI mode rather than domain state, like the placement picker, so it stays
 * out of the document and the trace.
 */
let copied: readonly Id[] = [];

export function copyToClipboard(ids: readonly Id[]): void {
  copied = [...ids];
}

/** The copied ids that are still in the document, in board order. */
export function pasteableIds(state: AppState): Id[] {
  return copied.filter((id) => state.document.model.elements[id] !== undefined);
}

/** A fresh session starts with an empty clipboard. */
export function forgetClipboard(): void {
  copied = [];
}

/**
 * The boxes a copy of these ids would draw, in flow coordinates: one per
 * element of the copy that is actually on the board. A member inside a
 * collapsed group is copied but not drawn, so it has no box here.
 */
export function copyRects(state: AppState, ids: readonly Id[]): Rect[] {
  const elements = state.document.model.elements;
  const expanded = new Set(state.expanded);
  const rects: Rect[] = [];

  for (const id of duplicationSpan(elements, ids)) {
    const entry = state.document.layout[id];
    if (!entry || !isEntityLayout(entry)) continue;
    if (!isRendered(elements, id, expanded)) continue;
    // An open group draws as its container box rather than the node it
    // collapses to.
    const size = expanded.has(id) && entry.expanded ? entry.expanded : entry;
    rects.push({ x: entry.x, y: entry.y, width: size.width, height: size.height });
  }
  return rects;
}

/** The rectangle those boxes sit in, or null when the copy draws nothing. */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
  };
}

/**
 * Copies these elements, moved by `offset`. Returns the source-to-copy map the
 * command carried, empty when there was nothing to copy: the caller reads it
 * to decide which container each copy landed in.
 */
export function duplicateElements(ids: readonly Id[], offset: Point): Record<Id, Id> {
  const span = duplicationSpan(store.getState().document.model.elements, ids);
  if (span.length === 0) return {};

  const idMap: Record<Id, Id> = {};
  for (const id of span) idMap[id] = crypto.randomUUID();

  const result = store.dispatch({ type: 'duplicate-elements', idMap, offset });
  return result.ok ? idMap : {};
}

export type { Rect as CopyRect };
