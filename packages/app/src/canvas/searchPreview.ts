import { useSyncExternalStore } from 'react';

/**
 * The filter expression the board is showing *as if* it were applied, while
 * someone types in the search menu.
 *
 * Searching narrows the board as the query narrows, but the whole point of
 * the menu's first option is that applying the filter is a separate, deliberate
 * act. So a preview cannot be a `set-filter`: closing the menu would then have
 * to undo a command, and every keystroke would land in the trace. Like the
 * pan-to-relation highlight in highlight.ts, this is ephemeral focus, held
 * outside the store and off the bus. The committed filter is the one that
 * travels as a command.
 */
let preview: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Sets the previewed expression, or clears it with null. */
export function setSearchPreview(expression: string | null): void {
  if (expression === preview) return;
  preview = expression;
  emit();
}

function getPreview(): string | null {
  return preview;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSearchPreview(): string | null {
  return useSyncExternalStore(subscribe, getPreview, getPreview);
}
