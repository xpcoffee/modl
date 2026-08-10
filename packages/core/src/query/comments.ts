import type { Comment, Id } from '../model/types.js';

/**
 * Reading comments from the document. Comments live beside the model
 * (issue #37), so the board and the filter reach them through these rather
 * than through the elements they discuss.
 */

/** Comments attached to an element, sorted by id so a render is stable. */
export function commentsOn(comments: Record<Id, Comment>, elementId: Id): Comment[] {
  return Object.values(comments)
    .filter((comment) => comment.targets.includes(elementId))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Every comment, sorted by id. Drives the list a reader browses. */
export function allComments(comments: Record<Id, Comment>): Comment[] {
  return Object.values(comments).sort((a, b) => a.id.localeCompare(b.id));
}

/** Ids of elements with at least one comment attached. */
export function commentedElementIds(comments: Record<Id, Comment>): Set<Id> {
  const ids = new Set<Id>();
  for (const comment of Object.values(comments)) {
    for (const target of comment.targets) ids.add(target);
  }
  return ids;
}
