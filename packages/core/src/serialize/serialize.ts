import {
  DEFAULT_ENTITY_SIZE,
  DEFAULT_VIEW,
  CONNECTION_NODE_SIZE,
  FORMAT_VERSION,
  isConnection,
  isEntity,
  isEntityLayout,
  isConnectionNode,
  type Document,
  type Element,
  type ElementLayout,
  type Id,
} from '../model/types.js';
import { isLoadable, validateDocument, type ValidationResult } from '../model/validate.js';
import { migrateDocument } from './migrate.js';

/**
 * Writes a document as JSON. Deterministic: the same document always produces
 * the same bytes, so golden-file tests and git diffs stay readable.
 *
 * Element keys are sorted. Object keys follow a fixed declaration order.
 */
export function serializeDocument(document: Document): string {
  const elements: Record<string, unknown> = {};
  for (const id of Object.keys(document.model.elements).sort()) {
    const element = document.model.elements[id];
    if (element) elements[id] = orderElement(element);
  }

  const notes: Record<string, unknown> = {};
  for (const id of Object.keys(document.model.notes).sort()) {
    const note = document.model.notes[id];
    if (note) {
      notes[id] = {
        id: note.id,
        text: note.text,
        targets: [...note.targets].sort(),
        tags: orderTags(note.tags),
      };
    }
  }

  const comments: Record<string, unknown> = {};
  for (const id of Object.keys(document.comments).sort()) {
    const comment = document.comments[id];
    if (comment) {
      comments[id] = {
        id: comment.id,
        text: comment.text,
        ...(comment.createdAt === undefined ? {} : { createdAt: comment.createdAt }),
        targets: [...comment.targets].sort(),
      };
    }
  }

  const layout: Record<string, unknown> = {};
  for (const id of Object.keys(document.layout).sort()) {
    const entry = document.layout[id];
    if (entry) layout[id] = orderLayout(entry);
  }

  const ordered = {
    formatVersion: document.formatVersion,
    id: document.id,
    title: document.title,
    model: { elements, notes },
    comments,
    layout,
    view: {
      pan: { x: document.view.pan.x, y: document.view.pan.y },
      zoom: document.view.zoom,
      ...(document.view.defaultExpanded === undefined
        ? {}
        : {
            defaultExpanded:
              document.view.defaultExpanded === true
                ? true
                : [...document.view.defaultExpanded].sort(),
          }),
    },
  };

  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function orderElement(element: Element): Record<string, unknown> {
  const base = {
    id: element.id,
    kind: element.kind,
  };
  const tail = {
    title: element.title,
    description: element.description,
    tags: orderTags(element.tags),
    sources: element.sources.map((source) => ({
      ref: source.ref,
      ...(source.note === undefined ? {} : { note: source.note }),
    })),
    groupId: element.groupId,
    ...(element.style === undefined ? {} : { style: orderStyle(element.style) }),
  };

  if (isEntity(element)) return { ...base, type: element.type, ...tail };
  if (isConnection(element)) {
    return {
      ...base,
      type: element.type,
      from: [...element.from],
      to: [...element.to],
      direction: element.direction,
      ...tail,
    };
  }
  return { ...base, shape: element.shape, labels: orderLabels(element.labels), ...tail };
}

/** Sorted by connection id, so two documents saying the same thing match. */
function orderLabels(labels: Record<Id, string>): Record<Id, string> {
  const ordered: Record<Id, string> = {};
  for (const id of Object.keys(labels).sort()) {
    const label = labels[id];
    if (label !== undefined) ordered[id] = label;
  }
  return ordered;
}

function orderStyle(style: NonNullable<Element['style']>): Record<string, unknown> {
  return {
    ...(style.fill === undefined ? {} : { fill: style.fill }),
    ...(style.stroke === undefined ? {} : { stroke: style.stroke }),
    ...(style.strokeStyle === undefined ? {} : { strokeStyle: style.strokeStyle }),
    ...(style.arrowhead === undefined ? {} : { arrowhead: style.arrowhead }),
  };
}

function orderTags(tags: Record<string, string[]>): Record<string, string[]> {
  const ordered: Record<string, string[]> = {};
  for (const key of Object.keys(tags).sort()) {
    const values = tags[key];
    if (values !== undefined) ordered[key] = [...values].sort();
  }
  return ordered;
}

function orderLayout(layout: ElementLayout): Record<string, unknown> {
  if (isEntityLayout(layout)) {
    return {
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      ...(layout.expanded
        ? { expanded: { width: layout.expanded.width, height: layout.expanded.height } }
        : {}),
    };
  }
  return {
    waypoints: layout.waypoints.map((point) => ({ x: point.x, y: point.y })),
    ...(layout.sourceSide === undefined ? {} : { sourceSide: layout.sourceSide }),
    ...(layout.targetSide === undefined ? {} : { targetSide: layout.targetSide }),
  };
}

export type ParseResult =
  | { ok: true; document: Document; warnings: ValidationResult['warnings'] }
  | { ok: false; errors: ValidationResult['errors'] };

/**
 * Reads a document from JSON text. Applies defaults for a missing `layout`
 * or `view`, so a programmatic producer can emit structure alone.
 */
export function parseDocument(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    return {
      ok: false,
      errors: [{ code: 'schema-invalid', message: `not valid JSON: ${(cause as Error).message}` }],
    };
  }
  return loadDocument(raw);
}

/** Validates an already-parsed value and fills in layout defaults. */
export function loadDocument(raw: unknown): ParseResult {
  const result = validateDocument(raw);
  if (!isLoadable(result)) return { ok: false, errors: result.errors };

  const upgraded = migrateDocument(raw);
  const input = (upgraded.ok ? upgraded.document : raw) as Document;
  const document: Document = {
    formatVersion: FORMAT_VERSION,
    id: input.id,
    title: input.title,
    model: {
      elements: { ...input.model.elements },
      notes: { ...(input.model.notes ?? {}) },
    },
    comments: { ...(input.comments ?? {}) },
    layout: withDefaultLayout(input.model.elements, input.layout ?? {}),
    view: input.view ?? DEFAULT_VIEW,
  };

  return { ok: true, document, warnings: result.warnings };
}

const GRID_COLUMNS = 4;
const GRID_SPACING = { x: 280, y: 180 } as const;
const MEMBER_PADDING = { top: 48, side: 28, bottom: 28 } as const;

/**
 * Gives every entity a position, placing members inside the group that holds
 * them.
 *
 * A flat grid in sorted id order scatters a grouped document, because ids
 * carry no meaning: members land nowhere near their container, and since the
 * container box also decides membership, the document reads as noise. A
 * producer emitting structure alone should still get something legible.
 */
export function withDefaultLayout(
  elements: Record<Id, Element>,
  layout: Record<Id, ElementLayout>,
): Record<Id, ElementLayout> {
  const resolved: Record<Id, ElementLayout> = { ...layout };

  const membersOfGroup = (groupId: Id | null): Id[] =>
    Object.keys(elements)
      .sort()
      .filter((id) => {
        const element = elements[id];
        // Connection nodes are placed too: a junction with no position is invisible.
        return (
          element !== undefined &&
          (isEntity(element) || isConnectionNode(element)) &&
          element.groupId === groupId
        );
      });

  /** Places a branch and reports the room it needed. */
  const place = (id: Id, at: { x: number; y: number }): { width: number; height: number } => {
    const members = membersOfGroup(id);
    const existing = resolved[id];
    const already = existing && 'x' in existing ? existing : undefined;
    const origin = already ? { x: already.x, y: already.y } : at;
    const element = elements[id];
    const ownSize = element && isConnectionNode(element) ? CONNECTION_NODE_SIZE : DEFAULT_ENTITY_SIZE;

    if (members.length === 0) {
      if (!already) {
        resolved[id] = { ...origin, ...ownSize };
      }
      const box = (resolved[id] ?? { ...origin, ...ownSize }) as {
        width: number;
        height: number;
      };
      return { width: box.width, height: box.height };
    }

    // Members sit in a row inside their container, innermost sized first.
    let cursor = origin.x + MEMBER_PADDING.side;
    let tallest = 0;
    for (const member of members) {
      const size = place(member, { x: cursor, y: origin.y + MEMBER_PADDING.top });
      cursor += size.width + MEMBER_PADDING.side;
      tallest = Math.max(tallest, size.height);
    }

    const width = cursor - origin.x;
    const height = MEMBER_PADDING.top + tallest + MEMBER_PADDING.bottom;
    // A size the document already carries wins: this fills gaps, it does not
    // re-lay-out a board someone has arranged.
    const box = already?.expanded ?? { width, height };
    resolved[id] = {
      ...origin,
      ...DEFAULT_ENTITY_SIZE,
      ...(already ? { width: already.width, height: already.height } : {}),
      expanded: box,
    };
    return box;
  };

  let column = 0;
  let rowY = 0;
  let rowHeight = 0;

  for (const id of membersOfGroup(null)) {
    const size = place(id, { x: column * GRID_SPACING.x, y: rowY });
    rowHeight = Math.max(rowHeight, size.height);
    column += Math.max(1, Math.ceil(size.width / GRID_SPACING.x));
    if (column >= GRID_COLUMNS) {
      column = 0;
      rowY += rowHeight + GRID_SPACING.y - DEFAULT_ENTITY_SIZE.height;
      rowHeight = 0;
    }
  }

  return resolved;
}

/** An empty document, used as the starting state of a session. */
export function emptyDocument(id: Id, title = 'Untitled domain'): Document {
  return {
    formatVersion: FORMAT_VERSION,
    id,
    title,
    model: { elements: {}, notes: {} },
    comments: {},
    layout: {},
    view: { pan: { ...DEFAULT_VIEW.pan }, zoom: DEFAULT_VIEW.zoom },
  };
}
