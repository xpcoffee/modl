import { useSyncExternalStore } from 'react';
import type { EntityType } from '@modl/core';

/** What the next click on the canvas will place. */
export type PlacementType = EntityType | 'connection-node' | 'decision';

/**
 * The kind of element waiting to be placed.
 *
 * Picking a type arms the canvas; the next click or drag puts one down and
 * disarms it. A UI mode rather than domain state, so it stays out of the
 * document and the trace: the command it produces carries everything.
 */
let pending: PlacementType | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getPending(): PlacementType | null {
  return pending;
}

export function arm(type: PlacementType): void {
  pending = type;
  emit();
}

export function disarm(): void {
  pending = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePending(): PlacementType | null {
  return useSyncExternalStore(subscribe, getPending, getPending);
}

/** Every type a reader can place, in the order the picker shows them. */
export const PLACEABLE: { type: PlacementType; label: string }[] = [
  { type: 'component', label: 'component' },
  { type: 'state', label: 'state' },
  { type: 'step', label: 'step' },
  { type: 'artifact', label: 'artifact' },
  { type: 'connection-node', label: 'connection node' },
  { type: 'decision', label: 'decision' },
];
