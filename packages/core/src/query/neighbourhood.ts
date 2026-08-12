import {
  isConnection,
  isConnectionNode,
  type Comment,
  type Connection,
  type Document,
  type Element,
  type Id,
} from '../model/types.js';
import { allComments } from './comments.js';
import { membersOf } from './groups.js';
import { labelsOfNode, labelsOnConnection } from './labels.js';

/**
 * Everything a reader needs before acting on one element: what points at it,
 * what it points at, what sits beside it in its group, and what has been said
 * about it. Acting on a review comment starts with this read every time, so
 * it is one query rather than four passes over the file.
 */
export interface Neighbourhood {
  element: Element;
  /** Connections whose `to` names the element, in id order. */
  incoming: Connection[];
  /** Connections whose `from` names the element, in id order. */
  outgoing: Connection[];
  /**
   * Elements sharing the element's group, in id order. Empty at the top
   * level: elements with no group are not each other's siblings.
   */
  siblings: Element[];
  /** Direct members when the element is a group, in id order. */
  members: Element[];
  /** Comments attached to the element, in the order they were written. */
  comments: Comment[];
}

/** The neighbourhood of one element, or null when the id names nothing. */
export function neighbourhoodOf(document: Document, id: Id): Neighbourhood | null {
  const elements = document.model.elements;
  const element = elements[id];
  if (!element) return null;

  const connections = Object.keys(elements)
    .sort()
    .map((key) => elements[key])
    .filter((candidate): candidate is Connection =>
      candidate !== undefined && isConnection(candidate),
    );

  return {
    element,
    incoming: connections.filter((connection) => connection.to.includes(id)),
    outgoing: connections.filter((connection) => connection.from.includes(id)),
    siblings:
      element.groupId === null
        ? []
        : membersOf(elements, element.groupId).filter((sibling) => sibling.id !== id),
    members: membersOf(elements, id),
    comments: allComments(document.comments).filter((comment) => comment.targets.includes(id)),
  };
}

/** The element's title, or its id when it has none. */
export function nameOf(elements: Record<Id, Element>, id: Id): string {
  const title = elements[id]?.title;
  return title !== undefined && title !== '' ? title : id;
}

function kindOf(element: Element): string {
  if (isConnection(element)) return `connection (${element.type}, ${element.direction})`;
  if (isConnectionNode(element)) return `connection-node (${element.shape})`;
  return `entity (${element.type})`;
}

/** One line per branch: id, type, the elements at the far end, title, labels. */
function branchLine(
  elements: Record<Id, Element>,
  connection: Connection,
  farSide: 'from' | 'to',
): string {
  const far = connection[farSide].map((endId) => nameOf(elements, endId)).join(', ');
  const title = connection.title === '' ? '' : `  "${connection.title}"`;
  const labels = labelsOnConnection(elements, connection.id)
    .map((entry) => `  [${entry.label}]`)
    .join('');
  return `  ${connection.id}  ${connection.type}  ${farSide} ${far}${title}${labels}`;
}

/**
 * The neighbourhood as text, or null when the id names nothing. Every section
 * prints with its count, so a reader sees an explicit zero rather than
 * wondering whether a section was left out.
 */
export function renderNeighbourhood(document: Document, id: Id): string | null {
  const found = neighbourhoodOf(document, id);
  if (!found) return null;

  const elements = document.model.elements;
  const { element, incoming, outgoing, siblings, members, comments } = found;
  const lines: string[] = [];

  lines.push(nameOf(elements, id));
  lines.push(`  id     ${element.id}`);
  lines.push(`  kind   ${kindOf(element)}`);
  if (element.groupId !== null) {
    lines.push(`  group  ${nameOf(elements, element.groupId)} (${element.groupId})`);
  }
  if (isConnection(element)) {
    for (const endId of element.from) lines.push(`  from   ${nameOf(elements, endId)} (${endId})`);
    for (const endId of element.to) lines.push(`  to     ${nameOf(elements, endId)} (${endId})`);
  }
  if (isConnectionNode(element)) {
    for (const entry of labelsOfNode(elements, id)) {
      lines.push(`  label  "${entry.label}" on ${nameOf(elements, entry.connectionId)} (${entry.connectionId})`);
    }
  }

  lines.push('', `incoming (${incoming.length})`);
  for (const connection of incoming) lines.push(branchLine(elements, connection, 'from'));

  lines.push('', `outgoing (${outgoing.length})`);
  for (const connection of outgoing) lines.push(branchLine(elements, connection, 'to'));

  lines.push('', `siblings (${siblings.length})`);
  for (const sibling of siblings) {
    lines.push(`  ${sibling.id}${sibling.title === '' ? '' : `  ${sibling.title}`}`);
  }

  if (members.length > 0) {
    lines.push('', `members (${members.length})`);
    for (const member of members) {
      lines.push(`  ${member.id}${member.title === '' ? '' : `  ${member.title}`}`);
    }
  }

  lines.push('', `comments (${comments.length})`);
  for (const comment of comments) {
    for (const textLine of comment.text.split('\n')) lines.push(`  ${textLine}`);
  }

  return lines.join('\n');
}
