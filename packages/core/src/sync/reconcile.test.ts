import { beforeEach, describe, expect, it } from 'vitest';
import { applyAll } from '../commands/apply.js';
import { initialState } from '../state.js';
import { serializeDocument } from '../serialize/serialize.js';
import { changeEvents } from './changes.js';
import { reconcileDocuments, reconcileFileText } from './reconcile.js';
import type { AppState, Command } from '../commands/types.js';
import type { Document, EntityLayout } from '../model/types.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const LINK = '44444444-4444-4444-8444-444444444444';

function entity(id: string, title: string, x = 0): Command {
  return { type: 'create-entity', id, entityType: 'component', title, position: { x, y: 0 } };
}

function must(state: AppState, ...commands: Command[]): AppState {
  const result = applyAll(state, commands);
  if (!result.ok) throw new Error(`unexpected rejection: ${JSON.stringify(result.error)}`);
  return result.state;
}

/** The document as it stands after applying commands to `base`. */
function after(state: AppState, ...commands: Command[]): Document {
  return must(state, ...commands).document;
}

function boxOf(document: Document, id: string): EntityLayout {
  const entry = document.layout[id];
  if (!entry || !('x' in entry)) throw new Error(`no box for ${id}`);
  return entry;
}

let base: AppState;

beforeEach(() => {
  base = must(initialState(DOC), entity(A, 'Checkout UI'), entity(B, 'Gateway', 240));
});

describe('reconcileDocuments', () => {
  it('takes the file whole on the first sync of a session', () => {
    const file = after(base, entity(C, 'Ledger', 480));
    const merged = reconcileDocuments(null, base.document, file);
    expect(Object.keys(merged.document.model.elements).sort()).toEqual([A, B, C].sort());
    expect(merged.report.fromFile).toEqual([]);
  });

  it('keeps a box the board moved and the file left alone', () => {
    const local = after(base, { type: 'move-element', id: A, position: { x: 900, y: 900 } });
    const file = after(base, entity(C, 'Ledger', 480));

    const merged = reconcileDocuments(base.document, local, file);

    expect(boxOf(merged.document, A)).toMatchObject({ x: 900, y: 900 });
    expect(merged.document.model.elements[C]?.title).toBe('Ledger');
    expect(merged.report.keptLocal).toContain(A);
  });

  it('takes the file box when both sides moved the same element', () => {
    const local = after(base, { type: 'move-element', id: A, position: { x: 900, y: 900 } });
    const file = after(base, { type: 'move-element', id: A, position: { x: 100, y: 40 } });

    const merged = reconcileDocuments(base.document, local, file);

    expect(boxOf(merged.document, A)).toMatchObject({ x: 100, y: 40 });
    expect(merged.report.conflicts).toEqual([A]);
    expect(merged.report.fromFile).toContain(A);
  });

  it('takes the file title for an element the board also renamed', () => {
    const local = after(base, { type: 'set-metadata', id: A, title: 'Board name' });
    const file = after(base, { type: 'set-metadata', id: A, title: 'File name' });

    const merged = reconcileDocuments(base.document, local, file);

    expect(merged.document.model.elements[A]?.title).toBe('File name');
    expect(merged.report.conflicts).toEqual([A]);
  });

  it('keeps an element the board added and the file has not seen', () => {
    const local = after(base, entity(C, 'Ledger', 480));
    const file = after(base, { type: 'set-metadata', id: B, title: 'Payments gateway' });

    const merged = reconcileDocuments(base.document, local, file);

    expect(merged.document.model.elements[C]?.title).toBe('Ledger');
    expect(merged.document.model.elements[B]?.title).toBe('Payments gateway');
    expect(merged.report.keptLocal).toContain(C);
    expect(merged.report.fromFile).toContain(B);
  });

  it('keeps an element the board deleted out, when the file left it alone', () => {
    const local = after(base, { type: 'delete-element', id: B });
    const file = after(base, entity(C, 'Ledger', 480));

    const merged = reconcileDocuments(base.document, local, file);

    expect(merged.document.model.elements[B]).toBeUndefined();
    expect(Object.keys(merged.document.model.elements).sort()).toEqual([A, C].sort());
  });

  it('brings back an element the board deleted when the file changed it', () => {
    const local = after(base, { type: 'delete-element', id: B });
    const file = after(base, { type: 'set-metadata', id: B, title: 'Payments gateway' });

    const merged = reconcileDocuments(base.document, local, file);

    expect(merged.document.model.elements[B]?.title).toBe('Payments gateway');
  });

  it('drops the element the file deleted, and the board still shows it', () => {
    const file = after(base, { type: 'delete-element', id: B });

    const merged = reconcileDocuments(base.document, base.document, file);

    expect(merged.document.model.elements[B]).toBeUndefined();
    expect(merged.document.layout[B]).toBeUndefined();
  });

  it('never moves the camera, whatever the file says', () => {
    const local = after(base, { type: 'set-view', pan: { x: 40, y: 60 }, zoom: 2 });
    const file = after(base, { type: 'set-view', pan: { x: -500, y: -500 }, zoom: 0.2 });

    const merged = reconcileDocuments(base.document, local, file);

    expect(merged.document.view).toMatchObject({ pan: { x: 40, y: 60 }, zoom: 2 });
  });

  it('takes the file over the board when the merge would not load', () => {
    // The board drew a line into B while the file deleted B: the merged
    // document would hold a connection with a missing endpoint.
    const local = after(base, entity(C, 'Ledger', 480), {
      type: 'create-connection',
      id: LINK,
      connectionType: 'interaction',
      from: [C],
      to: [B],
      title: 'post',
    });
    const file = after(base, { type: 'delete-element', id: B });

    const merged = reconcileDocuments(base.document, local, file);

    expect(merged.report.mergeAbandoned).toBe(true);
    expect(Object.keys(merged.document.model.elements)).toEqual([A]);
  });

  it('reports nothing when the file matches the board', () => {
    const merged = reconcileDocuments(base.document, base.document, base.document);
    expect(merged.report).toEqual({
      fromFile: [],
      keptLocal: [],
      conflicts: [],
      mergeAbandoned: false,
    });
  });
});

describe('reconcileFileText', () => {
  /** The file as JSON, with `edit` applied to the parsed object first. */
  function fileText(document: Document, edit: (raw: Record<string, unknown>) => void): string {
    const raw = JSON.parse(serializeDocument(document)) as Record<string, unknown>;
    edit(raw);
    return `${JSON.stringify(raw, null, 2)}\n`;
  }

  function reconcile(local: AppState, text: string) {
    const result = reconcileFileText(base.document, local.document, text);
    if (!result.ok) throw new Error(`unexpected rejection: ${result.message}`);
    return result;
  }

  it('rejects a file that does not parse', () => {
    const result = reconcileFileText(base.document, base.document, '{ "half": ');
    expect(result.ok).toBe(false);
  });

  it('keeps every box when the file carries no layout at all', () => {
    const local = must(base, { type: 'move-element', id: A, position: { x: 900, y: 900 } });
    const text = fileText(must(local, { type: 'set-metadata', id: B, title: 'Payments' }).document, (raw) => {
      delete raw['layout'];
    });

    const merged = reconcile(local, text);

    expect(boxOf(merged.document, A)).toMatchObject({ x: 900, y: 900 });
    expect(merged.document.model.elements[B]?.title).toBe('Payments');
  });

  it('keeps the box of an element the file states no position for', () => {
    const local = must(base, { type: 'move-element', id: A, position: { x: 900, y: 900 } });
    const text = fileText(local.document, (raw) => {
      delete (raw['layout'] as Record<string, unknown>)[A];
    });

    expect(boxOf(reconcile(local, text).document, A)).toMatchObject({ x: 900, y: 900 });
  });

  it('keeps the comments when the file carries no comments map', () => {
    const local = must(base, {
      type: 'create-comment',
      id: C,
      text: 'is this still true?',
      targets: [A],
    });
    const text = fileText(local.document, (raw) => {
      delete raw['comments'];
    });

    expect(reconcile(local, text).document.comments[C]?.text).toBe('is this still true?');
  });

  it('takes a comment the file removed from a map it does carry', () => {
    const local = must(base, {
      type: 'create-comment',
      id: C,
      text: 'is this still true?',
      targets: [A],
    });
    // The base holds the comment, so the empty map the file carries is a
    // deletion rather than silence.
    const merged = reconcileFileText(
      local.document,
      local.document,
      serializeDocument(base.document),
    );
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.document.comments[C]).toBeUndefined();
  });

  it('reports the file as the base of the next merge', () => {
    const text = serializeDocument(must(base, entity(C, 'Ledger', 480)).document);
    const merged = reconcile(base, text);
    expect(Object.keys(merged.file.model.elements).sort()).toEqual([A, B, C].sort());
  });
});

describe('changeEvents', () => {
  it('names what one document holds and the other does not', () => {
    const local = base.document;
    const file = after(
      must(base, { type: 'delete-element', id: B }),
      entity(C, 'Ledger', 480),
      { type: 'set-metadata', id: A, title: 'Checkout' },
    );

    expect(changeEvents(local, file)).toEqual(
      expect.arrayContaining([
        { type: 'element-created', id: C },
        { type: 'element-deleted', id: B },
        { type: 'element-updated', id: A },
      ]),
    );
  });

  it('is empty between two spellings of the same document', () => {
    const copy = JSON.parse(JSON.stringify(base.document)) as Document;
    expect(changeEvents(base.document, copy)).toEqual([]);
  });
});
