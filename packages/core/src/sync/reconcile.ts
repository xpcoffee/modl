import type { Comment, Document, Element, ElementLayout, Id, Note } from '../model/types.js';
import { loadDocument, parseDocument } from '../serialize/serialize.js';

/**
 * Merges a document the board is showing with the same document as it now
 * sits on disk, so an agent editing the file and a reader editing the board
 * can work at the same time. See docs/decisions/032-file-sync.md.
 *
 * The merge is three-way, keyed by id: `base` is the file content both sides
 * last agreed on, `local` is the board, `incoming` is the file. Every map in
 * the document (elements, notes, comments, layout) and the title follow one
 * rule: whichever side moved away from the base is taken, and when both
 * moved, the file's version stands. That last clause is what issue 97 asks
 * for, and it makes the file the source of truth without the board snapping
 * back on every write.
 */

/** What one merged key took, for the status the reader sees. */
export type SyncOutcome = 'unchanged' | 'file' | 'local' | 'conflict';

export interface SyncReport {
  /** Keys the file changed and the board now shows the file's version of. */
  fromFile: Id[];
  /** Keys the board changed since the base, and keeps. */
  keptLocal: Id[];
  /** Keys both sides changed. Counted in `fromFile` too: the file's version stands. */
  conflicts: Id[];
  /**
   * True when the merged document failed validation and the file replaced the
   * board wholesale. A board-only element pointing at something the file
   * deleted does this.
   */
  mergeAbandoned: boolean;
}

export interface Reconciliation {
  document: Document;
  report: SyncReport;
}

/** JSON with object keys sorted, so two spellings of one value compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, held: unknown) => {
    if (held === null || typeof held !== 'object' || Array.isArray(held)) return held;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(held as Record<string, unknown>).sort()) {
      sorted[key] = (held as Record<string, unknown>)[key];
    }
    return sorted;
  });
}

/** Whether two values say the same thing, whatever order they spell it in. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  return canonical(a) === canonical(b);
}

/**
 * Picks one side of a key. Absence is a value: a key missing from `local`
 * that the base held is a board-side deletion, and the same rule keeps it
 * deleted when the file left it alone.
 */
function pick<T>(base: T | undefined, local: T | undefined, incoming: T | undefined): {
  value: T | undefined;
  outcome: SyncOutcome;
} {
  // The board's own object when the two agree, so the canvas re-renders only
  // what the file actually changed.
  if (sameValue(local, incoming)) return { value: local, outcome: 'unchanged' };
  if (sameValue(base, incoming)) return { value: local, outcome: 'local' };
  if (sameValue(base, local)) return { value: incoming, outcome: 'file' };
  return { value: incoming, outcome: 'conflict' };
}

class Tally {
  readonly fromFile = new Set<Id>();
  readonly keptLocal = new Set<Id>();
  readonly conflicts = new Set<Id>();

  note(id: Id, outcome: SyncOutcome): void {
    if (outcome === 'local') this.keptLocal.add(id);
    if (outcome === 'file') this.fromFile.add(id);
    if (outcome === 'conflict') {
      this.fromFile.add(id);
      this.conflicts.add(id);
    }
  }

  report(mergeAbandoned: boolean): SyncReport {
    const sorted = (ids: Set<Id>): Id[] => [...ids].sort();
    return {
      fromFile: sorted(this.fromFile),
      keptLocal: sorted(this.keptLocal),
      conflicts: sorted(this.conflicts),
      mergeAbandoned,
    };
  }
}

function mergeMap<T>(
  base: Record<Id, T> | undefined,
  local: Record<Id, T>,
  incoming: Record<Id, T>,
  tally: Tally,
): Record<Id, T> {
  const merged: Record<Id, T> = {};
  const ids = new Set([...Object.keys(base ?? {}), ...Object.keys(local), ...Object.keys(incoming)]);
  for (const id of ids) {
    const chosen = pick(base?.[id], local[id], incoming[id]);
    tally.note(id, chosen.outcome);
    if (chosen.value !== undefined) merged[id] = chosen.value;
  }
  return merged;
}

/**
 * What a file's JSON actually mentions, which is not the same as what a
 * loaded document holds: the loader fills a missing position with a grid slot
 * and a missing map with an empty one. A producer emitting structure alone
 * (docs/agents.md) would otherwise read as "every box moved to the grid, and
 * every comment deleted", and the merge would do exactly that. Silence is not
 * an instruction, so what the file leaves out, the board keeps.
 */
export interface FileStatement {
  /** Layout keys the file states. Null when it carries no layout map at all. */
  layout: ReadonlySet<Id> | null;
  comments: boolean;
  notes: boolean;
  /** Whether the file's view carries a first-open hint. */
  defaultExpanded: boolean;
}

/** Reads which maps and layout keys a document's JSON mentions. */
export function fileStatement(text: string): FileStatement {
  let raw: Record<string, unknown> = {};
  try {
    raw = (JSON.parse(text) ?? {}) as Record<string, unknown>;
  } catch {
    // A file that will not parse states nothing; the caller rejects it anyway.
  }
  const model = (raw['model'] ?? {}) as Record<string, unknown>;
  const view = (raw['view'] ?? {}) as Record<string, unknown>;
  const layout = raw['layout'] as Record<string, unknown> | undefined;
  return {
    layout: layout === undefined || layout === null ? null : new Set(Object.keys(layout)),
    comments: raw['comments'] !== undefined && raw['comments'] !== null,
    notes: model['notes'] !== undefined && model['notes'] !== null,
    defaultExpanded: view['defaultExpanded'] !== undefined,
  };
}

/** Everything a document holds counts as stated, for a caller with no file text. */
const STATES_EVERYTHING = Symbol('states-everything');

function mergeLayout(
  base: Record<Id, ElementLayout>,
  local: Record<Id, ElementLayout>,
  incoming: Record<Id, ElementLayout>,
  stated: FileStatement['layout'] | typeof STATES_EVERYTHING,
  tally: Tally,
): Record<Id, ElementLayout> {
  const merged: Record<Id, ElementLayout> = {};
  const ids = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(incoming)]);
  for (const id of ids) {
    if (stated !== STATES_EVERYTHING && !stated?.has(id)) {
      // The file says nothing about where this goes, so the board's own box
      // stands. A box only the file has is a new element's grid slot.
      const kept = local[id] ?? incoming[id];
      if (kept !== undefined) merged[id] = kept;
      if (!sameValue(local[id], base[id])) tally.note(id, 'local');
      continue;
    }
    const chosen = pick(base[id], local[id], incoming[id]);
    tally.note(id, chosen.outcome);
    if (chosen.value !== undefined) merged[id] = chosen.value;
  }
  return merged;
}

/**
 * Merges the board and the file. `base` is null on the first sync of a
 * session, where there is nothing to say which side moved and the file is
 * taken whole. `stated` names what the file's own JSON mentions; without it
 * every map the loaded document holds counts as the file's word.
 */
export function reconcileDocuments(
  base: Document | null,
  local: Document,
  incoming: Document,
  stated?: FileStatement,
): Reconciliation {
  const tally = new Tally();
  if (!base) {
    return { document: incoming, report: tally.report(false) };
  }

  const elements = mergeMap<Element>(
    base.model.elements,
    local.model.elements,
    incoming.model.elements,
    tally,
  );
  const notes =
    stated && !stated.notes
      ? { ...local.model.notes }
      : mergeMap<Note>(base.model.notes, local.model.notes, incoming.model.notes, tally);
  const comments =
    stated && !stated.comments
      ? { ...local.comments }
      : mergeMap<Comment>(base.comments, local.comments, incoming.comments, tally);
  const layout = mergeLayout(
    base.layout,
    local.layout,
    incoming.layout,
    stated ? stated.layout : STATES_EVERYTHING,
    tally,
  );

  // A layout entry for something no longer in the document goes unread;
  // dropping it here keeps the file the board writes back free of it.
  for (const id of Object.keys(layout)) {
    if (!elements[id] && !comments[id] && !notes[id]) delete layout[id];
  }

  const title = pick(base.title, local.title, incoming.title);
  const defaultExpanded =
    stated && !stated.defaultExpanded
      ? { value: local.view.defaultExpanded, outcome: 'unchanged' as const }
      : pick(base.view.defaultExpanded, local.view.defaultExpanded, incoming.view.defaultExpanded);

  const merged: Document = {
    formatVersion: incoming.formatVersion,
    id: incoming.id,
    title: title.value ?? incoming.title,
    model: { elements, notes },
    comments,
    layout,
    // The camera is where the reader is looking rather than part of the
    // domain, so a file arriving never moves it. An explicit load still
    // frames what the file says. The first-open hint is an edit to the
    // document, so it merges like anything else.
    view: {
      pan: { ...local.view.pan },
      zoom: local.view.zoom,
      ...(defaultExpanded.value === undefined ? {} : { defaultExpanded: defaultExpanded.value }),
    },
  };

  // The merge can produce a document neither side wrote: a connection the
  // board added to an element the file deleted has no endpoint left. The file
  // is the source of truth, so it replaces the board rather than the reader
  // losing the sync.
  const check = loadDocument(merged);
  if (!check.ok) return { document: incoming, report: tally.report(true) };

  return { document: check.document, report: tally.report(false) };
}

export type FileReconciliation =
  | {
      ok: true;
      /** The merged document, for the board. */
      document: Document;
      /** The file's own document, which is the base of the next merge. */
      file: Document;
      report: SyncReport;
    }
  | { ok: false; message: string };

/**
 * Merges the bytes read from the file into the board. The one entry point the
 * sync loop uses: reading the file's own JSON is how the merge tells a
 * position the file states from one the loader invented.
 */
export function reconcileFileText(
  base: Document | null,
  local: Document,
  text: string,
): FileReconciliation {
  const parsed = parseDocument(text);
  if (!parsed.ok) return { ok: false, message: parsed.errors.map((e) => e.message).join('; ') };
  const { document, report } = reconcileDocuments(
    base,
    local,
    parsed.document,
    fileStatement(text),
  );
  return { ok: true, document, file: parsed.document, report };
}
