import { suggestedFileName } from '@modl/core';
import { fileContext, rememberFile } from './fileContext.js';

/**
 * Saving and opening through the File System Access API, with download and
 * file-input fallbacks where the API is missing. See
 * docs/decisions/019-save-in-place.md.
 */

interface FilePickerType {
  description?: string;
  accept: Record<string, string[]>;
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: FilePickerType[];
    }) => Promise<FileSystemFileHandle>;
    showOpenFilePicker?: (options?: { types?: FilePickerType[] }) => Promise<FileSystemFileHandle[]>;
  }
}

// Chromium rejects a multi-dot extension, so `.modl.json` cannot be listed.
const PICKER_TYPES: FilePickerType[] = [
  { description: 'modl document', accept: { 'application/json': ['.json'] } },
];

export type SaveResult =
  | { outcome: 'saved'; name: string }
  | { outcome: 'canceled' }
  | { outcome: 'failed'; message: string };

export type PickResult =
  | { outcome: 'picked'; file: File; handle: FileSystemFileHandle }
  | { outcome: 'canceled' }
  | { outcome: 'unsupported' }
  | { outcome: 'failed'; message: string };

/** Downloads text as a file. */
export function download(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function wasCanceled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function writeTo(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

/** Saves to the remembered file, asking again when there is none or it no longer writes. */
export async function saveDocumentFile(text: string, title: string): Promise<SaveResult> {
  const { handle } = fileContext();
  if (handle) {
    try {
      await writeTo(handle, text);
      return { outcome: 'saved', name: handle.name };
    } catch {
      // Fall through to the picker below.
    }
  }
  return saveDocumentFileAs(text, title);
}

/** Asks where to save, then remembers the answer for the next plain save. */
export async function saveDocumentFileAs(text: string, title: string): Promise<SaveResult> {
  const suggested = fileContext().name ?? suggestedFileName(title);
  if (!window.showSaveFilePicker) {
    download(suggested, text);
    rememberFile({ handle: null, name: suggested });
    return { outcome: 'saved', name: suggested };
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: suggested,
      types: PICKER_TYPES,
    });
    await writeTo(handle, text);
    rememberFile({ handle, name: handle.name });
    return { outcome: 'saved', name: handle.name };
  } catch (error) {
    if (wasCanceled(error)) return { outcome: 'canceled' };
    return { outcome: 'failed', message: messageOf(error) };
  }
}

/** Asks which file to open; the caller remembers the handle only after a successful parse. */
export async function pickDocumentFile(): Promise<PickResult> {
  if (!window.showOpenFilePicker) return { outcome: 'unsupported' };
  try {
    const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES });
    if (!handle) return { outcome: 'canceled' };
    return { outcome: 'picked', file: await handle.getFile(), handle };
  } catch (error) {
    if (wasCanceled(error)) return { outcome: 'canceled' };
    return { outcome: 'failed', message: messageOf(error) };
  }
}
