import { useSyncExternalStore } from 'react';
import { fileStem } from '@modl/core';

/**
 * The file the board saves to.
 *
 * Like motion and keybindings this is session state rather than document
 * state: it says where the document goes on this machine, so it never
 * reaches the command bus or the trace. Unlike them it is forgotten on
 * reload: a FileSystemFileHandle survives only in IndexedDB, and restoring
 * one without the document it named would title an empty board. It lasts
 * exactly as long as the document it points at. See
 * docs/decisions/019-save-in-place.md.
 */
export interface FileContext {
  /** Null when the browser cannot write in place, where save re-downloads. */
  handle: FileSystemFileHandle | null;
  name: string | null;
}

let context: FileContext = { handle: null, name: null };
const listeners = new Set<() => void>();

export function fileContext(): FileContext {
  return context;
}

export function subscribeFileContext(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFileContext(): FileContext {
  return useSyncExternalStore(subscribeFileContext, fileContext, fileContext);
}

/** The tab names the open file: `modl - payments`, or `modl` alone. */
function stamp(): void {
  document.title = context.name ? `modl - ${fileStem(context.name)}` : 'modl';
}

function announce(): void {
  stamp();
  for (const listener of listeners) listener();
}

export function rememberFile(next: FileContext): void {
  context = next;
  announce();
}

export function forgetFile(): void {
  context = { handle: null, name: null };
  announce();
}
