import { useSyncExternalStore } from 'react';
import {
  reconcileFileText,
  serializeDocument,
  type Document,
  type SyncReport,
} from '@modl/core';
import { store } from '../store/store.js';
import { fileContext, subscribeFileContext } from './fileContext.js';
import { messageOf, writeTo } from './fileAccess.js';

/**
 * Keeps the board and the open file the same while an agent edits the file
 * and a reader edits the board (issue 97). Session state like the file it
 * follows, and off until asked for. See docs/decisions/032-file-sync.md.
 *
 * Two loops, both timer-driven:
 *
 * - every change to the document schedules a write, debounced, so a drag
 *   writes once on release rather than once a frame;
 * - a poll reads the file and, when its bytes differ from the last agreed
 *   ones, merges them into the board through `sync-document`.
 *
 * Neither loop can see the other's writes as an outside change: `agreed`
 * holds the exact bytes the two sides last shared, and a poll reading those
 * bytes back has nothing to do.
 */

/** Long enough that a drag or a burst of typing writes once. */
export const WRITE_DEBOUNCE_MS = 400;
/**
 * The File System Access API has no change notification, so the file is read
 * on a timer. Twice a second reads fast enough to feel immediate and reads a
 * board-sized document cheaply.
 */
export const POLL_MS = 500;

export type SyncPhase = 'off' | 'watching' | 'writing' | 'error';

export interface SyncState {
  on: boolean;
  phase: SyncPhase;
  /** What the last write or inbound change did, for the toolbar to show. */
  message: string;
}

let state: SyncState = { on: false, phase: 'off', message: '' };
const listeners = new Set<() => void>();

/** The exact bytes the board and the file last shared. */
let agreed: string | null = null;
/** The document behind `agreed`, ignoring the camera: what a write compares against. */
let agreedSignature: string | null = null;
/** The file content both sides last agreed on, the base of every merge. */
let base: Document | null = null;

let writeTimer: number | null = null;
let pollTimer: number | null = null;
/** A write or a read is in flight; the other loop waits rather than interleaving. */
let inFlight = false;

export function syncState(): SyncState {
  return state;
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSync, syncState, syncState);
}

function announce(next: Partial<SyncState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/**
 * The document as bytes with the camera flattened. A pan or a zoom is not a
 * change worth a write: it would put the file through a round of churn every
 * time the reader looks somewhere else, and an agent watching the file would
 * see nothing it cares about. The camera still travels with the next real
 * change.
 */
function signatureOf(document: Document): string {
  return serializeDocument({ ...document, view: { ...document.view, pan: { x: 0, y: 0 }, zoom: 1 } });
}

interface PermissionQueryable {
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
}

/**
 * A handle from an earlier picker can still be read-only, and asking for write
 * access needs the gesture that turned sync on, so it happens here rather than
 * at the first write.
 */
async function canWrite(handle: FileSystemFileHandle): Promise<boolean> {
  const gate = handle as FileSystemFileHandle & PermissionQueryable;
  if (!gate.queryPermission) return true;
  if ((await gate.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await gate.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

async function write(): Promise<void> {
  const { handle } = fileContext();
  if (!state.on || !handle || inFlight) return;
  inFlight = true;
  announce({ phase: 'writing' });
  const document = store.getState().document;
  const text = serializeDocument(document);
  try {
    await writeTo(handle, text);
  } catch (error) {
    inFlight = false;
    announce({ phase: 'error', message: `could not write ${handle.name}: ${messageOf(error)}` });
    return;
  }
  agreed = text;
  agreedSignature = signatureOf(document);
  base = document;
  inFlight = false;
  announce({ phase: 'watching', message: `wrote ${handle.name}` });
}

function scheduleWrite(): void {
  if (writeTimer !== null) window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => {
    writeTimer = null;
    if (inFlight) {
      scheduleWrite();
      return;
    }
    void write();
  }, WRITE_DEBOUNCE_MS);
}

/** What the merge did, in the words the toolbar shows. */
function reportMessage(report: SyncReport): string {
  if (report.mergeAbandoned) return 'the file replaced the board';
  const parts: string[] = [];
  if (report.fromFile.length > 0) parts.push(`${report.fromFile.length} from the file`);
  if (report.keptLocal.length > 0) parts.push(`${report.keptLocal.length} kept here`);
  if (report.conflicts.length > 0) parts.push(`${report.conflicts.length} settled by the file`);
  // Bytes can differ while the document does not: a file written by another
  // program with the same content in a different order.
  return parts.length === 0 ? 'read the file' : parts.join(', ');
}

function applyIncoming(
  text: string,
  merged: { document: Document; file: Document; report: SyncReport },
): void {
  const { document, file, report } = merged;
  const previous = { agreed, base, agreedSignature };
  // Recorded before the dispatch, because the dispatch runs the write loop:
  // it compares the merged board against these bytes and schedules a write
  // only where the merge kept something the file has not got. The base is
  // what the file holds rather than what the board now shows.
  agreed = text;
  base = file;
  agreedSignature = signatureOf(file);

  const result = store.dispatch({ type: 'sync-document', document });
  if (!result.ok) {
    agreed = previous.agreed;
    base = previous.base;
    agreedSignature = previous.agreedSignature;
    announce({ phase: 'error', message: `could not read the file: ${result.error.message}` });
    return;
  }
  announce({ phase: 'watching', message: reportMessage(report) });
}

async function poll(): Promise<void> {
  const { handle } = fileContext();
  if (!state.on || !handle || inFlight || writeTimer !== null) return;
  inFlight = true;
  try {
    const text = await (await handle.getFile()).text();
    if (text === agreed) {
      if (state.phase === 'error') announce({ phase: 'watching', message: '' });
      return;
    }
    const merged = reconcileFileText(base, store.getState().document, text);
    if (!merged.ok) {
      // A write by another program is not atomic, so a read can land on half
      // a file. The next read is 500ms away and the board keeps what it has.
      announce({ phase: 'error', message: 'the file does not read as a document yet' });
      return;
    }
    applyIncoming(text, merged);
  } catch (error) {
    announce({ phase: 'error', message: `could not read ${handle.name}: ${messageOf(error)}` });
  } finally {
    inFlight = false;
  }
}

/** The document last measured, so a click that only changes the selection is free. */
let measured: Document | null = null;

function onDocumentChanged(): void {
  if (!state.on) return;
  const document = store.getState().document;
  if (document === measured) return;
  measured = document;
  if (signatureOf(document) === agreedSignature) return;
  scheduleWrite();
}

/**
 * A new file arrives from a save-as or a load. Whichever it was, that file and
 * the board agree at this moment, so the base restarts from what the board
 * holds and one write settles the bytes.
 */
function onFileChanged(): void {
  if (!state.on) return;
  if (!fileContext().handle) {
    disableSync('sync needs a file it can write to');
    return;
  }
  agreed = null;
  agreedSignature = null;
  base = store.getState().document;
  void write();
}

/**
 * Turns sync on for the file the board is saving to. The board goes out
 * first: the reader is looking at it, so it is written and both sides start
 * from those bytes.
 */
export async function enableSync(): Promise<boolean> {
  if (state.on) return true;
  const { handle } = fileContext();
  if (!handle) {
    announce({ phase: 'error', message: 'save the board to a file first' });
    return false;
  }
  if (!(await canWrite(handle))) {
    announce({ phase: 'error', message: `no permission to write ${handle.name}` });
    return false;
  }
  announce({ on: true, phase: 'writing', message: '' });
  base = store.getState().document;
  await write();
  if (pollTimer === null) pollTimer = window.setInterval(() => void poll(), POLL_MS);
  return true;
}

export function disableSync(message = ''): void {
  if (writeTimer !== null) window.clearTimeout(writeTimer);
  if (pollTimer !== null) window.clearInterval(pollTimer);
  writeTimer = null;
  pollTimer = null;
  agreed = null;
  agreedSignature = null;
  base = null;
  measured = null;
  announce({ on: false, phase: message === '' ? 'off' : 'error', message });
}

export async function toggleSync(): Promise<void> {
  if (state.on) disableSync();
  else await enableSync();
}

/** A fresh session has no file, so it has nothing to follow. */
export function forgetSync(): void {
  disableSync();
}

let installed = false;

/** Connects both loops to the store and to the remembered file. Idempotent. */
export function installSync(): void {
  if (installed) return;
  installed = true;
  store.subscribe(onDocumentChanged);
  subscribeFileContext(onFileChanged);
}
