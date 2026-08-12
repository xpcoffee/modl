import {
  isConnection,
  isConnectionNode,
  isEntity,
  type Connection,
  type Direction,
  type Document,
  type Element,
  type Id,
} from '../model/types.js';
import { allComments } from './comments.js';
import { labelsOnConnection } from './labels.js';
import { nameOf } from './neighbourhood.js';

/**
 * The model as plain text: an element table and a connection list, for
 * reading a document in a terminal or reviewing one in a diff. Everything is
 * sorted by id, and comments by the time they were written, so the same
 * document always dumps to the same text and a change shows as a small diff.
 *
 * Only `model` and `comments` appear. Layout is geometry, and a reader
 * checking geometry has `check` and `render`.
 */
export function dumpDocument(document: Document): string {
  const elements = document.model.elements;
  const sorted = Object.keys(elements)
    .sort()
    .map((id) => elements[id])
    .filter((element): element is Element => element !== undefined);
  const boxes = sorted.filter((element) => !isConnection(element));
  const connections = sorted.filter(isConnection);
  const comments = allComments(document.comments);

  const lines: string[] = [];
  lines.push(document.title === '' ? document.id : document.title);
  lines.push(
    [
      count(boxes.filter(isEntity).length, 'entity', 'entities'),
      count(boxes.filter(isConnectionNode).length, 'connection node'),
      count(connections.length, 'connection'),
      count(comments.length, 'comment'),
    ].join(', '),
  );

  if (boxes.length > 0) {
    lines.push('', 'elements');
    const idWidth = Math.max(...boxes.map((element) => element.id.length));
    const kindWidth = Math.max(...boxes.map((element) => element.kind.length));
    const typeWidth = Math.max(...boxes.map((element) => subtypeOf(element).length));
    for (const element of boxes) {
      const title = element.title === '' ? '' : `  ${element.title}`;
      const group = element.groupId === null ? '' : `  (in ${element.groupId})`;
      lines.push(
        `  ${element.id.padEnd(idWidth)}  ${element.kind.padEnd(kindWidth)}` +
          `  ${subtypeOf(element).padEnd(typeWidth)}${title}${group}`.trimEnd(),
      );
    }
  }

  if (connections.length > 0) {
    lines.push('', 'connections');
    const idWidth = Math.max(...connections.map((connection) => connection.id.length));
    const typeWidth = Math.max(...connections.map((connection) => connection.type.length));
    for (const connection of connections) {
      lines.push(
        `  ${connection.id.padEnd(idWidth)}  ${connection.type.padEnd(typeWidth)}` +
          `  ${endpointsOf(elements, connection)}`,
      );
    }
  }

  if (comments.length > 0) {
    lines.push('', 'comments');
    for (const comment of comments) {
      const targets =
        comment.targets.length === 0
          ? 'the document'
          : comment.targets.map((target) => nameOf(elements, target)).join(', ');
      lines.push(`  ${comment.id}  on ${targets}`);
      for (const textLine of comment.text.split('\n')) lines.push(`    ${textLine}`);
    }
  }

  return lines.join('\n');
}

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function subtypeOf(element: Element): string {
  return isConnectionNode(element) ? element.shape : element.type;
}

const ARROWS: Record<Direction, string> = { forward: '->', both: '<->', none: '--' };

/** `A, B -> C  "title"  [label]`, the join a reader otherwise does by hand. */
function endpointsOf(elements: Record<Id, Element>, connection: Connection): string {
  const from = connection.from.map((id) => nameOf(elements, id)).join(', ');
  const to = connection.to.map((id) => nameOf(elements, id)).join(', ');
  const title = connection.title === '' ? '' : `  "${connection.title}"`;
  const labels = labelsOnConnection(elements, connection.id)
    .map((entry) => `  [${entry.label}]`)
    .join('');
  return `${from} ${ARROWS[connection.direction]} ${to}${title}${labels}`;
}
