import type { Id } from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { startCommentEdit, useCommentEdit } from './commentEditing.js';
import { CommentTextBox } from './CommentTextBox.js';
import type { BoardComment } from './derive.js';

/**
 * How a comment shows on the board (issue #37): a small badge on everything
 * it discusses, and the text only while the element or the comment itself is
 * selected. A remark has to be noticeable without competing with the model
 * it is about.
 *
 * A bubble is live in model mode too: clicking it selects the comment, a
 * second click (or Enter) opens its text box, and Delete removes it, all
 * without entering the discussion overlay.
 */

export function CommentBadge({ id, count }: { id: Id; count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="comment-badge"
      data-testid={`comment-badge-${id}`}
      aria-label={`${count} ${count === 1 ? 'comment' : 'comments'}`}
    >
      <CommentIcon />
      {count > 1 && <span className="comment-badge__count">{count}</span>}
    </span>
  );
}

export function CommentBubbles({
  id,
  comments,
  open,
}: {
  id: Id;
  comments: BoardComment[];
  open: boolean;
}) {
  const state = useAppState();
  const edit = useCommentEdit();
  if (!open || comments.length === 0) return null;

  const selected = new Set(state.selection);
  return (
    <div className="comment-bubbles nodrag nopan" data-testid={`comment-bubbles-${id}`}>
      {comments.map((comment) => {
        const editing = edit?.commentId === comment.id && edit.hostId === id;
        return (
          <p
            key={comment.id}
            className={`comment-bubble${selected.has(comment.id) ? ' is-selected' : ''}`}
            data-testid={`comment-bubble-${comment.id}`}
            onClick={(event) => {
              event.stopPropagation();
              if (editing) return;
              if (selected.has(comment.id)) startCommentEdit(comment.id, id);
              else store.dispatch({ type: 'set-selection', ids: [comment.id] });
            }}
          >
            {editing ? (
              <CommentTextBox commentId={comment.id} text={comment.text} />
            ) : (
              comment.text || <em>empty comment</em>
            )}
            {comment.targetCount > 1 && (
              <span
                className="comment-bubble__span"
                data-testid={`comment-span-${comment.id}`}
              >
                one comment across {comment.targetCount} elements
              </span>
            )}
          </p>
        );
      })}
    </div>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="comment-badge__icon">
      <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
    </svg>
  );
}
