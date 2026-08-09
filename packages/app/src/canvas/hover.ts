import { useSyncExternalStore } from 'react';
import type { Id } from '@modl/core';

/**
 * Which element the pointer is resting on.
 *
 * Hover feedback rather than domain state, like the pan emphasis in
 * highlight.ts, so it stays out of the document and out of the trace. A
 * decision uses it to show what its branches answer, and to offer its
 * connections menu, without the reader having to select it first.
 */
let hoveredId: Id | null = null;
const listeners = new Set<() => void>();

export function setHovered(id: Id | null): void {
  if (id === hoveredId) return;
  hoveredId = id;
  for (const listener of listeners) listener();
}

/** Clears the hover only if it is still on this element. */
export function clearHovered(id: Id): void {
  if (hoveredId === id) setHovered(null);
}

function getHoveredId(): Id | null {
  return hoveredId;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHoveredId(): Id | null {
  return useSyncExternalStore(subscribe, getHoveredId, getHoveredId);
}
