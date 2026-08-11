import type { Id } from '@modl/core';

/**
 * The badge marking everything a comment discusses (issue #37). Compact on
 * purpose: the text itself renders as a movable card (CommentOverlay) while
 * the element or the comment is selected, in either mode, so the badge only
 * has to say "there is discussion here".
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

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="comment-badge__icon">
      <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
    </svg>
  );
}
