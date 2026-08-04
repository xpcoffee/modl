import { useSyncExternalStore } from 'react';
import type { Id } from '@modl/core';

/**
 * Which element is being renamed in place.
 *
 * This is ephemeral focus rather than domain state, so it stays out of the
 * document and out of the trace. The rename itself arrives as a set-metadata
 * command when the edit commits.
 */
let editingId: Id | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getEditingId(): Id | null {
  return editingId;
}

export function startEditing(id: Id): void {
  editingId = id;
  emit();
}

export function stopEditing(): void {
  editingId = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEditingId(): Id | null {
  return useSyncExternalStore(subscribe, getEditingId, getEditingId);
}
