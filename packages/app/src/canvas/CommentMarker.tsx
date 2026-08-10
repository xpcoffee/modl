import type { Id } from '@modl/core';
import type { BoardComment } from './derive.js';

/**
 * How a comment shows on the board (issue #37): a small badge on everything
 * it discusses, and the text only while the element or the comment itself is
 * selected. A remark has to be noticeable without competing with the model
 * it is about.
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
  if (!open || comments.length === 0) return null;
  return (
    <div className="comment-bubbles nodrag" data-testid={`comment-bubbles-${id}`}>
      {comments.map((comment) => (
        <p key={comment.id} className="comment-bubble" data-testid={`comment-bubble-${comment.id}`}>
          {comment.text || <em>empty comment</em>}
        </p>
      ))}
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
