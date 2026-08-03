import { useSyncExternalStore } from 'react';
import type { EntityType } from '@modl/core';

/**
 * The type given to the next element created, shared by the toolbar picker
 * and by double-clicking the canvas so both agree on what gets made.
 *
 * A UI preference rather than domain state, so it stays out of the document
 * and out of the trace. The command it produces carries the type.
 */
let entityType: EntityType = 'component';
const listeners = new Set<() => void>();

export function getNewElementType(): EntityType {
  return entityType;
}

export function setNewElementType(next: EntityType): void {
  entityType = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNewElementType(): EntityType {
  return useSyncExternalStore(subscribe, getNewElementType, getNewElementType);
}
