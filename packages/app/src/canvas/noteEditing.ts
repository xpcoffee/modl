import { useSyncExternalStore } from 'react';
import type { Id } from '@modl/core';
import { store } from '../store/store.js';

/**
 * Notes mode and the open note text box. Ephemeral focus like
 * `commentEditing.ts`: the text itself travels as set-note-text commands
 * while typing. The mode has no command of its own, unlike the discussion
 * overlay's `set-comment-overlay`: it lives here, off the bus, and the two
 * modes exclude each other (entering one leaves the other).
 */
export interface NoteEdit {
  noteId: Id;
}

let mode = false;
let editing: NoteEdit | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNotesMode(): boolean {
  return mode;
}

export function useNotesMode(): boolean {
  return useSyncExternalStore(subscribe, getNotesMode, getNotesMode);
}

export function getNoteEdit(): NoteEdit | null {
  return editing;
}

export function startNoteEdit(noteId: Id): void {
  editing = { noteId };
  emit();
}

export function stopNoteEdit(): void {
  if (editing === null) return;
  editing = null;
  emit();
}

export function useNoteEdit(): NoteEdit | null {
  return useSyncExternalStore(subscribe, getNoteEdit, getNoteEdit);
}

/**
 * Closes whatever note card is open the way clicking off would: an empty
 * note is abandoned, one with words is already saved.
 */
export function settleOpenNoteCard(): void {
  const edit = editing;
  if (edit === null) return;
  stopNoteEdit();
  const note = store.getState().document.model.notes[edit.noteId];
  if (note && note.text.trim() === '') {
    store.dispatch({ type: 'delete-note', id: edit.noteId });
  }
}

/**
 * Enters notes mode. The discussion overlay closes first, and element ids
 * leave the selection the way `set-comment-overlay` drops them: pressing an
 * element here speaks notes, so the element selection UI never shows.
 */
export function enterNotesMode(): void {
  const state = store.getState();
  if (state.commentOverlay) {
    store.dispatch({ type: 'set-comment-overlay', open: false });
  }
  const noteIds = state.selection.filter((id) => state.document.model.notes[id]);
  if (noteIds.length !== state.selection.length) {
    store.dispatch({ type: 'set-selection', ids: noteIds });
  }
  if (mode) return;
  mode = true;
  emit();
}

export function leaveNotesMode(): void {
  if (!mode) return;
  settleOpenNoteCard();
  mode = false;
  emit();
}
