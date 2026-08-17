import type { Document, Id } from '../model/types.js';
import type { DomainEvent } from '../commands/types.js';
import { sameValue } from './reconcile.js';

/**
 * The per-item events between two versions of one document, so a whole
 * document arriving reads to the canvas as the edits it contains: an element
 * an agent added warps in, one it removed warps out. `sync-document` emits
 * these; `load-document` does not, because a different document is a scene
 * change rather than a set of edits.
 */
export function changeEvents(before: Document, after: Document): DomainEvent[] {
  const events: DomainEvent[] = [];

  const walk = <T>(
    from: Record<Id, T>,
    to: Record<Id, T>,
    kind: 'element' | 'note' | 'comment',
  ): void => {
    for (const id of [...new Set([...Object.keys(from), ...Object.keys(to)])].sort()) {
      const had = from[id];
      const has = to[id];
      if (had === undefined && has !== undefined) events.push({ type: `${kind}-created`, id });
      else if (had !== undefined && has === undefined) events.push({ type: `${kind}-deleted`, id });
      else if (!sameValue(had, has)) events.push({ type: `${kind}-updated`, id });
    }
  };

  walk(before.model.elements, after.model.elements, 'element');
  walk(before.model.notes, after.model.notes, 'note');
  walk(before.comments, after.comments, 'comment');
  return events;
}
