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

/**
 * The badge marking everything a note describes (issue #83). A sticky-note
 * glyph in the note accent, so what is model content tells apart from the
 * speech bubble of discussion at a glance.
 */
export function NoteBadge({ id, count }: { id: Id; count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="note-badge"
      data-testid={`note-badge-${id}`}
      aria-label={`${count} ${count === 1 ? 'note' : 'notes'}`}
    >
      <NoteIcon />
      {count > 1 && <span className="note-badge__count">{count}</span>}
    </span>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="note-badge__icon">
      <path
        fillRule="evenodd"
        d="M20 2H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10l8-8V4a2 2 0 0 0-2-2zm-6 18v-6h6z"
      />
    </svg>
  );
}
