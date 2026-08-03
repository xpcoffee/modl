import {
  DEFAULT_ENTITY_SIZE,
  DEFAULT_VIEW,
  FORMAT_VERSION,
  isConnection,
  isEntity,
  isEntityLayout,
  type Document,
  type Element,
  type ElementLayout,
  type Id,
} from '../model/types.js';
import { isLoadable, validateDocument, type ValidationResult } from '../model/validate.js';

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

  const layout: Record<string, unknown> = {};
  for (const id of Object.keys(document.layout).sort()) {
    const entry = document.layout[id];
    if (entry) layout[id] = orderLayout(entry);
  }

  const ordered = {
    formatVersion: document.formatVersion,
    id: document.id,
    title: document.title,
    model: { elements },
    layout,
    view: {
      pan: { x: document.view.pan.x, y: document.view.pan.y },
      zoom: document.view.zoom,
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
    groupId: element.groupId,
  };

  if (isEntity(element)) return { ...base, type: element.type, ...tail };
  if (isConnection(element)) {
    return { ...base, type: element.type, from: [...element.from], to: [...element.to], ...tail };
  }
  return { ...base, shape: element.shape, ...tail };
}

function orderTags(tags: Record<string, string>): Record<string, string> {
  const ordered: Record<string, string> = {};
  for (const key of Object.keys(tags).sort()) {
    const value = tags[key];
    if (value !== undefined) ordered[key] = value;
  }
  return ordered;
}

function orderLayout(layout: ElementLayout): Record<string, unknown> {
  if (isEntityLayout(layout)) {
    return { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
  }
  return { waypoints: layout.waypoints.map((point) => ({ x: point.x, y: point.y })) };
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

  const input = raw as Document;
  const document: Document = {
    formatVersion: FORMAT_VERSION,
    id: input.id,
    title: input.title,
    model: { elements: { ...input.model.elements } },
    layout: withDefaultLayout(input.model.elements, input.layout ?? {}),
    view: input.view ?? DEFAULT_VIEW,
  };

  return { ok: true, document, warnings: result.warnings };
}

const GRID_COLUMNS = 4;
const GRID_SPACING = { x: 240, y: 140 } as const;

/**
 * Gives every entity a position. Ids absent from `layout` are placed on a
 * grid in sorted id order, which keeps the result deterministic.
 */
export function withDefaultLayout(
  elements: Record<Id, Element>,
  layout: Record<Id, ElementLayout>,
): Record<Id, ElementLayout> {
  const resolved: Record<Id, ElementLayout> = { ...layout };
  let placed = 0;

  for (const id of Object.keys(elements).sort()) {
    const element = elements[id];
    if (!element || !isEntity(element)) continue;
    if (resolved[id]) {
      placed += 1;
      continue;
    }
    resolved[id] = {
      x: (placed % GRID_COLUMNS) * GRID_SPACING.x,
      y: Math.floor(placed / GRID_COLUMNS) * GRID_SPACING.y,
      width: DEFAULT_ENTITY_SIZE.width,
      height: DEFAULT_ENTITY_SIZE.height,
    };
    placed += 1;
  }

  return resolved;
}

/** An empty document, used as the starting state of a session. */
export function emptyDocument(id: Id, title = 'Untitled domain'): Document {
  return {
    formatVersion: FORMAT_VERSION,
    id,
    title,
    model: { elements: {} },
    layout: {},
    view: { pan: { ...DEFAULT_VIEW.pan }, zoom: DEFAULT_VIEW.zoom },
  };
}
