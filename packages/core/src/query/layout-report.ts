import { isConnection, isEntity, isConnectionNode, type Document, type Id } from '../model/types.js';
import { membersOf } from './groups.js';

/**
 * Whether a generated layout is readable.
 *
 * A producer writing a document by hand or from a scan has no canvas to look
 * at. These checks answer the question it cannot answer for itself: are boxes
 * sitting on top of each other, is a member outside the container that claims
 * it, is something stranded far from everything else.
 *
 * Every check is geometric and pure, so it runs without a browser.
 */
export type LayoutIssueCode =
  | 'overlapping-entities'
  | 'member-outside-container'
  | 'stranded-entity'
  | 'missing-position'
  | 'zero-length-connection';

export interface LayoutIssue {
  code: LayoutIssueCode;
  elementIds: Id[];
  message: string;
}

export interface LayoutReport {
  issues: LayoutIssue[];
  /** Bounding box of everything placed, useful for choosing a canvas size. */
  bounds: { x: number; y: number; width: number; height: number } | null;
  entityCount: number;
  connectionCount: number;
}

interface Box {
  id: Id;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far apart two entities must be before they count as strangers. */
const STRANDED_DISTANCE = 2000;

function boxesOf(document: Document): { boxes: Box[]; missing: Id[] } {
  const boxes: Box[] = [];
  const missing: Id[] = [];

  for (const element of Object.values(document.model.elements)) {
    if (!isEntity(element) && !isConnectionNode(element)) continue;
    const layout = document.layout[element.id];
    if (!layout || !('x' in layout)) {
      missing.push(element.id);
      continue;
    }
    boxes.push({ id: element.id, x: layout.x, y: layout.y, width: layout.width, height: layout.height });
  }
  return { boxes, missing };
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/**
 * Checks the geometry of a document. Nothing here makes a document invalid;
 * it reports what a reader would find hard to follow.
 */
export function inspectLayout(document: Document): LayoutReport {
  const issues: LayoutIssue[] = [];
  const elements = document.model.elements;
  const { boxes, missing } = boxesOf(document);
  const byId = new Map(boxes.map((box) => [box.id, box]));

  for (const id of missing) {
    issues.push({
      code: 'missing-position',
      elementIds: [id],
      message: `entity ${id} has no position, so it will be placed on a default grid`,
    });
  }

  // Entities sitting on top of each other, ignoring a container and what it holds.
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (elements[a.id]?.groupId === b.id || elements[b.id]?.groupId === a.id) continue;
      if (!overlaps(a, b)) continue;
      issues.push({
        code: 'overlapping-entities',
        elementIds: [a.id, b.id],
        message: `${a.id} and ${b.id} overlap`,
      });
    }
  }

  // A member drawn outside the container that claims it, which is what a
  // hand-edited groupId leaves behind. Judged against the container's
  // expanded box regardless of how a session currently draws the group:
  // member positions are absolute, and the expanded box decides membership.
  for (const element of Object.values(elements)) {
    if (isConnection(element) || element.groupId === null) continue;
    const child = byId.get(element.id);
    const parentLayout = document.layout[element.groupId];
    if (!child || !parentLayout || !('x' in parentLayout)) continue;

    const parent = {
      x: parentLayout.x,
      y: parentLayout.y,
      width: parentLayout.expanded?.width ?? parentLayout.width,
      height: parentLayout.expanded?.height ?? parentLayout.height,
    };
    const inside =
      child.x >= parent.x &&
      child.y >= parent.y &&
      child.x + child.width <= parent.x + parent.width &&
      child.y + child.height <= parent.y + parent.height;

    if (!inside) {
      issues.push({
        code: 'member-outside-container',
        elementIds: [element.id, element.groupId],
        message: `${element.id} sits outside the box ${element.groupId} shows when expanded: move it inside, or delete its layout entry and re-run layout`,
      });
    }
  }

  // Something placed a long way from everything else.
  if (boxes.length > 1) {
    for (const box of boxes) {
      const nearest = Math.min(
        ...boxes
          .filter((other) => other.id !== box.id)
          .map((other) => Math.hypot(other.x - box.x, other.y - box.y)),
      );
      if (nearest > STRANDED_DISTANCE) {
        issues.push({
          code: 'stranded-entity',
          elementIds: [box.id],
          message: `${box.id} is ${Math.round(nearest)} from its nearest neighbour`,
        });
      }
    }
  }

  // A connection whose ends sit in the same place has nothing to draw.
  for (const element of Object.values(elements)) {
    if (!isConnection(element)) continue;
    for (const from of element.from) {
      for (const to of element.to) {
        const a = byId.get(from);
        const b = byId.get(to);
        if (!a || !b) continue;
        if (a.x === b.x && a.y === b.y) {
          issues.push({
            code: 'zero-length-connection',
            elementIds: [element.id],
            message: `${element.id} joins two entities in the same place`,
          });
        }
      }
    }
  }

  const bounds =
    boxes.length === 0
      ? null
      : (() => {
          const x = Math.min(...boxes.map((b) => b.x));
          const y = Math.min(...boxes.map((b) => b.y));
          return {
            x,
            y,
            width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
            height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
          };
        })();

  return {
    issues,
    bounds,
    entityCount: Object.values(elements).filter(isEntity).length,
    connectionCount: Object.values(elements).filter(isConnection).length,
  };
}

/**
 * Places entities that have no position on a tidy grid, leaving anything
 * already placed alone. Lets a producer emit structure and get a readable
 * board without inventing coordinates.
 */
export function autoLayout(document: Document, columns = 4): Document {
  const spacing = { x: 280, y: 180 };
  const layout = { ...document.layout };
  const placed: Id[] = [];

  const roots = Object.values(document.model.elements)
    .filter(isEntity)
    .filter((entity) => entity.groupId === null)
    .map((entity) => entity.id)
    .sort();

  for (const id of roots) {
    const existing = layout[id];
    if (existing && 'x' in existing) continue;
    const index = placed.length;
    layout[id] = {
      x: (index % columns) * spacing.x,
      y: Math.floor(index / columns) * spacing.y,
      width: 180,
      height: 72,
    };
    placed.push(id);
  }

  // Members are laid out inside their container, in rows.
  for (const id of Object.keys(document.model.elements).sort()) {
    const members = membersOf(document.model.elements, id).filter(isEntity);
    if (members.length === 0) continue;
    const parent = layout[id];
    if (!parent || !('x' in parent)) continue;

    members.forEach((member, index) => {
      const existing = layout[member.id];
      if (existing && 'x' in existing) return;
      layout[member.id] = {
        x: parent.x + 28 + (index % 2) * 200,
        y: parent.y + 48 + Math.floor(index / 2) * 100,
        width: 180,
        height: 72,
      };
    });
  }

  return { ...document, layout };
}
