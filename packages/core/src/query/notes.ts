import type { Id, Note } from '../model/types.js';

/**
 * Reading notes from the model. Notes live in `model.notes` (issue #83), so
 * the board and the filter reach them through these rather than through the
 * elements they describe.
 */

/** Notes attached to an element, sorted by id so a render is stable. */
export function notesOn(notes: Record<Id, Note>, elementId: Id): Note[] {
  return Object.values(notes)
    .filter((note) => note.targets.includes(elementId))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Every note, sorted by id so the order is stable. */
export function allNotes(notes: Record<Id, Note>): Note[] {
  return Object.values(notes).sort((a, b) => a.id.localeCompare(b.id));
}

/** Ids of elements with at least one note attached. */
export function notedElementIds(notes: Record<Id, Note>): Set<Id> {
  const ids = new Set<Id>();
  for (const note of Object.values(notes)) {
    for (const target of note.targets) ids.add(target);
  }
  return ids;
}
