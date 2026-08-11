import { useSyncExternalStore } from 'react';
import type { Id } from '@modl/core';

/**
 * Which comment is being edited, and where its text box is open. A comment
 * shows on every element it discusses, so without naming a host the box
 * would open in several places and they would fight over focus.
 *
 * Ephemeral focus like `editing.ts`: the text itself travels as
 * set-comment-text commands while typing.
 */
export interface CommentEdit {
  commentId: Id;
  /** The element whose bubble holds the open box, or 'overlay' for a card. */
  hostId: Id | 'overlay';
}

let editing: CommentEdit | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getCommentEdit(): CommentEdit | null {
  return editing;
}

export function startCommentEdit(commentId: Id, hostId: Id | 'overlay'): void {
  editing = { commentId, hostId };
  emit();
}

export function stopCommentEdit(): void {
  if (editing === null) return;
  editing = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCommentEdit(): CommentEdit | null {
  return useSyncExternalStore(subscribe, getCommentEdit, getCommentEdit);
}
