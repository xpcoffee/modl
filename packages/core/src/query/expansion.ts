import type { Element, Id } from '../model/types.js';
import { descendantGroupsOf, isGroup, membersOf } from './groups.js';

/**
 * Batch expansion operations for the expansion menu (issue #20). Each helper
 * returns the group ids one pick of the menu should touch, in dispatch order,
 * given `itemIds`: the items the operation reads as one group's contents. A
 * single selected group passes its members (or itself while collapsed), and a
 * multi-selection passes the selected ids, which is how a selection behaves
 * as a group without being one. See docs/decisions/011-expansion-tooling.md.
 *
 * An empty result means the operation would change nothing, and the menu
 * drops the option.
 */

/** Every group among the items and their descendants, shallowest first. */
function groupsWithin(elements: Record<Id, Element>, itemIds: readonly Id[]): Id[] {
  const found: Id[] = [];
  const seen = new Set<Id>();
  const queue = [...itemIds];

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    if (isGroup(elements, id)) found.push(id);
    for (const member of membersOf(elements, id)) queue.push(member.id);
  }
  return found;
}

/**
 * The collapsed groups the reader can currently see: collapsed items, and
 * collapsed groups sitting inside a run of expanded ones. Expanding these
 * shows one more level of detail everywhere. A collapsed group hidden inside
 * another collapsed group stays untouched, so nothing expands out of sight.
 */
export function expandNextLevelTargets(
  elements: Record<Id, Element>,
  expanded: ReadonlySet<Id>,
  itemIds: readonly Id[],
): Id[] {
  const targets: Id[] = [];
  const seen = new Set<Id>();
  const queue = [...itemIds];

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    if (isGroup(elements, id) && !expanded.has(id)) {
      targets.push(id);
      continue;
    }
    for (const member of membersOf(elements, id)) queue.push(member.id);
  }
  return targets;
}

/**
 * The "leaf" expanded groups: expanded groups with no expanded group below
 * them. Collapsing these puts away the deepest open level while every level
 * above stays open, the inverse of one expand-next-level.
 */
export function collapseNextLevelTargets(
  elements: Record<Id, Element>,
  expanded: ReadonlySet<Id>,
  itemIds: readonly Id[],
): Id[] {
  return groupsWithin(elements, itemIds).filter(
    (id) =>
      expanded.has(id) && descendantGroupsOf(elements, id).every((group) => !expanded.has(group)),
  );
}

/** Every collapsed group among the items and below them, shallowest first. */
export function expandAllTargets(
  elements: Record<Id, Element>,
  expanded: ReadonlySet<Id>,
  itemIds: readonly Id[],
): Id[] {
  return groupsWithin(elements, itemIds).filter((id) => !expanded.has(id));
}

/**
 * Every expanded group among the items and below them, shallowest first, so
 * the dispatched sweep collapses root items before what they contain: the
 * order issue #20 asks for, and the one a replayed trace shows.
 */
export function collapseAllTargets(
  elements: Record<Id, Element>,
  expanded: ReadonlySet<Id>,
  itemIds: readonly Id[],
): Id[] {
  return groupsWithin(elements, itemIds).filter((id) => expanded.has(id));
}
