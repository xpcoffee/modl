import { useSyncExternalStore } from 'react';
import type { Id } from '@modl/core';

/**
 * Which connection the pan-to-relation control is pointing at.
 *
 * This is hover feedback rather than domain state, like the rename focus in
 * editing.ts, so it stays out of the document and out of the trace. The pan
 * itself arrives as a set-view command when a relation is chosen.
 */
let highlightId: Id | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setHighlight(id: Id | null): void {
  if (id === highlightId) return;
  highlightId = id;
  emit();
}

function getHighlightId(): Id | null {
  return highlightId;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHighlightId(): Id | null {
  return useSyncExternalStore(subscribe, getHighlightId, getHighlightId);
}
