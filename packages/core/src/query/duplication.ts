import { isConnection, type Element, type Id } from '../model/types.js';
import { descendantsOf } from './groups.js';

/**
 * Copying elements (issue #29). Alt+drag and paste ask the same question
 * first: given what the reader pointed at, what does a copy actually cover?
 * See docs/decisions/013-duplication.md.
 */

/**
 * Every id one copy of `ids` covers, sorted: the elements themselves, every
 * member at any depth of a group among them, and each connection whose ends
 * all land inside that set.
 *
 * A copy is self-contained. A group without its members would copy as an
 * empty box, so the members come along. A connection reaching something that
 * is not being copied stays out: joining the copy to it would draw a line the
 * reader never asked for, and copying it as-is would double a line already on
 * the board. An internal connection comes along whether or not it was
 * selected, since the relationship is part of what the reader is copying.
 *
 * Connections in `ids` are not copied for their own sake: a line needs both
 * of its ends to say anything.
 */
export function duplicationSpan(elements: Record<Id, Element>, ids: readonly Id[]): Id[] {
  const covered = new Set<Id>();
  for (const id of ids) {
    const element = elements[id];
    if (!element || isConnection(element)) continue;
    covered.add(id);
    for (const member of descendantsOf(elements, id)) covered.add(member);
  }

  const span = [...covered];
  for (const [id, element] of Object.entries(elements)) {
    if (!isConnection(element)) continue;
    if ([...element.from, ...element.to].every((ref) => covered.has(ref))) span.push(id);
  }
  return span.sort();
}
