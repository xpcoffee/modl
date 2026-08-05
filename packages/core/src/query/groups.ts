import { isConnection, isEntity, type Element, type Id } from '../model/types.js';

/**
 * Groups are how zooming works. A group is an entity that other elements
 * name in their `groupId`. Collapsing it hides the members and leaves the
 * group on the board; expanding it shows the members inside a container.
 */

/** Direct members of a group, in sorted id order so rendering is stable. */
export function membersOf(elements: Record<Id, Element>, groupId: Id): Element[] {
  return Object.keys(elements)
    .sort()
    .map((id) => elements[id])
    .filter((element): element is Element => element?.groupId === groupId);
}

/** Every group id from the element up to the root, nearest first. */
export function ancestorsOf(elements: Record<Id, Element>, id: Id): Id[] {
  const chain: Id[] = [];
  const seen = new Set<Id>([id]);
  let current = elements[id]?.groupId ?? null;

  while (current !== null && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = elements[current]?.groupId ?? null;
  }
  return chain;
}

/** True when making `id` a member of `groupId` would close a loop. */
export function wouldCycle(elements: Record<Id, Element>, id: Id, groupId: Id | null): boolean {
  if (groupId === null) return false;
  if (groupId === id) return true;
  return ancestorsOf(elements, groupId).includes(id);
}

/** Ids of every group that closes a loop, so validation can name them. */
export function cyclicGroupIds(elements: Record<Id, Element>): Id[] {
  const cyclic: Id[] = [];
  for (const [id, element] of Object.entries(elements)) {
    if (element.groupId === null) continue;
    const seen = new Set<Id>([id]);
    let current: Id | null = element.groupId;
    while (current !== null) {
      if (seen.has(current)) {
        cyclic.push(id);
        break;
      }
      seen.add(current);
      current = elements[current]?.groupId ?? null;
    }
  }
  return cyclic;
}

/**
 * True when the element itself is on the board. An element is hidden while
 * any group above it stays collapsed.
 */
export function isRendered(
  elements: Record<Id, Element>,
  id: Id,
  expanded: ReadonlySet<Id>,
): boolean {
  return ancestorsOf(elements, id).every((group) => expanded.has(group));
}

/**
 * The element that stands in for `id` on the board: itself when rendered,
 * otherwise the outermost collapsed group hiding it.
 */
export function visibleAnchor(
  elements: Record<Id, Element>,
  id: Id,
  expanded: ReadonlySet<Id>,
): Id {
  const chain = ancestorsOf(elements, id);
  // Walk from the root down and stop at the first collapsed group.
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const group = chain[i];
    if (group !== undefined && !expanded.has(group)) return group;
  }
  return id;
}

/** True when the entity has at least one member, so it draws as a group. */
export function isGroup(elements: Record<Id, Element>, id: Id): boolean {
  const element = elements[id];
  if (!element || !isEntity(element)) return false;
  return Object.values(elements).some((candidate) => candidate.groupId === id);
}

/** Every group in the document, sorted. */
export function groupIds(elements: Record<Id, Element>): Id[] {
  const groups = new Set<Id>();
  for (const element of Object.values(elements)) {
    if (element.groupId !== null) groups.add(element.groupId);
  }
  return [...groups].sort();
}

/**
 * Members of a group at every depth, including the group's own descendants
 * through nested groups.
 */
export function descendantsOf(elements: Record<Id, Element>, groupId: Id): Id[] {
  const found: Id[] = [];
  const queue = [groupId];
  const seen = new Set<Id>([groupId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const element of membersOf(elements, current)) {
      if (seen.has(element.id)) continue;
      seen.add(element.id);
      found.push(element.id);
      queue.push(element.id);
    }
  }
  return found;
}

/** Descendants of a group that are themselves groups, shallowest first. */
export function descendantGroupsOf(elements: Record<Id, Element>, groupId: Id): Id[] {
  return descendantsOf(elements, groupId).filter((id) => isGroup(elements, id));
}

/**
 * A connection is drawn when its anchors differ. A connection whose ends both
 * collapse into the same group has nothing to say at that zoom level.
 */
export function connectionAnchors(
  elements: Record<Id, Element>,
  connectionId: Id,
  expanded: ReadonlySet<Id>,
): { from: Id[]; to: Id[] } | null {
  const connection = elements[connectionId];
  if (!connection || !isConnection(connection)) return null;

  const from = [...new Set(connection.from.map((id) => visibleAnchor(elements, id, expanded)))];
  const to = [...new Set(connection.to.map((id) => visibleAnchor(elements, id, expanded)))];

  const pairs = from.flatMap((source) => to.map((target) => [source, target] as const));
  if (pairs.every(([source, target]) => source === target)) return null;

  return { from, to };
}
