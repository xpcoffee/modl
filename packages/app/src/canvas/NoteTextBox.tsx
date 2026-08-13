import { useEffect, useRef } from 'react';
import type { Id } from '@modl/core';
import { store } from '../store/store.js';
import { stopNoteEdit } from './noteEditing.js';

/**
 * The open text box of a note, with CommentTextBox's clicking-off semantics:
 * words keep the note (each keystroke already travelled as set-note-text),
 * an empty box abandons it, which is also how a quick-add is cancelled.
 */
export function NoteTextBox({ noteId, text }: { noteId: Id; text: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);

  return (
    <textarea
      ref={box}
      className="note-text-box nodrag nopan nowheel"
      data-testid={`note-text-box-${noteId}`}
      placeholder="Write a note"
      rows={3}
      value={text}
      onChange={(event) =>
        store.dispatch({ type: 'set-note-text', id: noteId, text: event.target.value })
      }
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          (event.target as HTMLTextAreaElement).blur();
        }
      }}
      onBlur={(event) => {
        stopNoteEdit();
        if (event.target.value.trim() === '') {
          store.dispatch({ type: 'delete-note', id: noteId });
        }
      }}
    />
  );
}
