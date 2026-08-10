import { useEffect, useRef } from 'react';
import type { Id } from '@modl/core';
import { store } from '../store/store.js';
import { stopCommentEdit } from './commentEditing.js';

/**
 * The open text box of a comment, shared by the overlay cards and the
 * model-mode bubbles so clicking off means the same thing everywhere: words
 * keep the comment (each keystroke already travelled as set-comment-text),
 * an empty box abandons it, which is also how a quick-add is cancelled.
 */
export function CommentTextBox({ commentId, text }: { commentId: Id; text: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);

  return (
    <textarea
      ref={box}
      className="comment-text-box nodrag nopan nowheel"
      data-testid={`comment-text-box-${commentId}`}
      placeholder="Write a comment"
      rows={3}
      value={text}
      onChange={(event) =>
        store.dispatch({ type: 'set-comment-text', id: commentId, text: event.target.value })
      }
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          (event.target as HTMLTextAreaElement).blur();
        }
      }}
      onBlur={(event) => {
        stopCommentEdit();
        if (event.target.value.trim() === '') {
          store.dispatch({ type: 'delete-comment', id: commentId });
        }
      }}
    />
  );
}
