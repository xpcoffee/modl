import { isConnection, isConnectionNode, type Element, type Id } from '../model/types.js';

/** One answer a junction gives, against the branch it answers for. */
export interface ConnectionLabel {
  /** The connection node carrying the label. */
  nodeId: Id;
  /** The connection it labels. */
  connectionId: Id;
  label: string;
}

/**
 * Why the connections leaving a decision go the way they do.
 *
 * Labels live on the node (see docs/domain-model.md), so reading them for one
 * junction is a lookup. Sorted by connection id, so a caller listing them gets
 * the same order every time. Labels naming something that is not a connection
 * touching this node are left out: they are the `label-unattached` warning's
 * business, and drawing them would put an answer against no branch.
 */
export function labelsOfNode(elements: Record<Id, Element>, nodeId: Id): ConnectionLabel[] {
  const node = elements[nodeId];
  if (!node || !isConnectionNode(node)) return [];

  return Object.keys(node.labels)
    .sort()
    .flatMap((connectionId) => {
      const label = node.labels[connectionId];
      if (label === undefined || label === '') return [];
      const connection = elements[connectionId];
      if (!connection || !isConnection(connection)) return [];
      if (![...connection.from, ...connection.to].includes(nodeId)) return [];
      return [{ nodeId, connectionId, label }];
    });
}

/**
 * The answers written against one connection, one per junction at its ends. A
 * line running between two decisions answers both, which is why this returns a
 * list rather than a string.
 */
export function labelsOnConnection(
  elements: Record<Id, Element>,
  connectionId: Id,
): ConnectionLabel[] {
  const connection = elements[connectionId];
  if (!connection || !isConnection(connection)) return [];

  const ends = [...new Set([...connection.from, ...connection.to])].sort();
  return ends.flatMap((end) =>
    labelsOfNode(elements, end).filter((entry) => entry.connectionId === connectionId),
  );
}
