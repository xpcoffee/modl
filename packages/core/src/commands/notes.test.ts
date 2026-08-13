import { beforeEach, describe, expect, it } from 'vitest';
import { apply, applyAll } from './apply.js';
import { initialState } from '../state.js';
import { allNotes, notesOn, notedElementIds } from '../query/notes.js';
import { formatTerm, matchingNoteIds, parseFilter, selectIds } from '../query/filter.js';
import { noteSuggestions, tagSuggestions } from '../query/search.js';
import { boardEmphasis, hiddenNoteIds } from '../query/view.js';
import { FORMAT_VERSION } from '../model/types.js';
import { validateDocument } from '../model/validate.js';
import { parseDocument, serializeDocument } from '../serialize/serialize.js';
import type { AppState, Command } from './types.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const LINK = '44444444-4444-4444-8444-444444444444';
const NOTE = '55555555-5555-4555-8555-555555555555';
const NOTE2 = '66666666-6666-4666-8666-666666666666';
const COMMENT = '77777777-7777-4777-8777-777777777777';
const MISSING = '99999999-9999-4999-8999-999999999999';

function entity(id: string, title: string, x = 0): Command {
  return { type: 'create-entity', id, entityType: 'component', title, position: { x, y: 0 } };
}

function link(id: string, from: string[], to: string[]): Command {
  return { type: 'create-connection', id, connectionType: 'interaction', from, to, title: '' };
}

function note(
  id: string,
  text: string,
  targets: string[],
  tags?: Record<string, string[]>,
): Command {
  return { type: 'create-note', id, text, targets, ...(tags === undefined ? {} : { tags }) };
}

/** Fails the test if a command was rejected, and returns the new state. */
function must(state: AppState, ...commands: Command[]): AppState {
  const result = applyAll(state, commands);
  if (!result.ok) throw new Error(`unexpected rejection: ${JSON.stringify(result.error)}`);
  return result.state;
}

let base: AppState;

beforeEach(() => {
  base = must(
    initialState(DOC),
    entity(A, 'Checkout UI'),
    entity(B, 'Gateway', 240),
    link(LINK, [A], [B]),
  );
});

describe('create-note', () => {
  it('stores the note inside the model, beside the elements', () => {
    const state = must(base, note(NOTE, 'refunds run through here', [A]));
    expect(state.document.model.notes[NOTE]).toEqual({
      id: NOTE,
      text: 'refunds run through here',
      targets: [A],
      tags: {},
    });
    expect(state.document.model.elements[NOTE]).toBeUndefined();
    expect(state.document.comments[NOTE]).toBeUndefined();
  });

  it('emits note-created', () => {
    const result = apply(base, note(NOTE, 'hm', [A]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([{ type: 'note-created', id: NOTE }]);
  });

  it('attaches to several elements at once, connections included', () => {
    const state = must(base, note(NOTE, 'this whole flow settles overnight', [A, B, LINK]));
    expect(notesOn(state.document.model.notes, LINK)).toHaveLength(1);
    expect(notedElementIds(state.document.model.notes)).toEqual(new Set([A, B, LINK]));
  });

  it('drops duplicate targets', () => {
    const state = must(base, note(NOTE, 'twice?', [A, A]));
    expect(state.document.model.notes[NOTE]?.targets).toEqual([A]);
  });

  it('a note with no targets describes the whole document', () => {
    const state = must(base, note(NOTE, 'amounts are minor units', []));
    expect(state.document.model.notes[NOTE]?.targets).toEqual([]);
    // Document-level notes belong to no element, so no element matches `note`.
    expect(
      selectIds(state.document.model.elements, 'note', {}, state.document.model.notes),
    ).toEqual(new Set());
  });

  it('carries tags in the same shape an element takes', () => {
    const state = must(base, note(NOTE, 'refund path', [A, B], { context: ['refunds'] }));
    expect(state.document.model.notes[NOTE]?.tags).toEqual({ context: ['refunds'] });
  });

  it('schema-invalid: rejects an empty tag key', () => {
    const result = apply(base, note(NOTE, 'x', [A], { '': ['refunds'] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('unknown-element: rejects a target that is not in the document', () => {
    const result = apply(base, note(NOTE, 'about nothing', [MISSING]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });

  it('duplicate-id: rejects an id already naming an element, a comment, or a note', () => {
    const onElement = apply(base, note(A, 'shadowing', [B]));
    expect(onElement.ok).toBe(false);
    if (!onElement.ok) expect(onElement.error.code).toBe('duplicate-id');

    const withComment = must(base, {
      type: 'create-comment',
      id: COMMENT,
      text: 'open question',
      targets: [A],
    });
    const onComment = apply(withComment, note(COMMENT, 'shadowing', [B]));
    expect(onComment.ok).toBe(false);
    if (!onComment.ok) expect(onComment.error.code).toBe('duplicate-id');

    const state = must(base, note(NOTE, 'first', [A]));
    const again = apply(state, note(NOTE, 'second', [B]));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('duplicate-id');
  });

  it('duplicate-id: a comment cannot take a note id either', () => {
    const state = must(base, note(NOTE, 'taken', [A]));
    const result = apply(state, { type: 'create-comment', id: NOTE, text: 'x', targets: [B] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('duplicate-id');
  });
});

describe('set-note-text and set-note-targets', () => {
  it('rewrites the text', () => {
    const state = must(
      base,
      note(NOTE, 'draft', [A]),
      { type: 'set-note-text', id: NOTE, text: 'final' },
    );
    expect(state.document.model.notes[NOTE]?.text).toBe('final');
  });

  it('repoints the targets', () => {
    const state = must(
      base,
      note(NOTE, 'moved on', [A]),
      { type: 'set-note-targets', id: NOTE, targets: [B, LINK] },
    );
    expect(state.document.model.notes[NOTE]?.targets).toEqual([B, LINK]);
  });

  it('unknown-element: rejects a note id that is not in the document', () => {
    const result = apply(base, { type: 'set-note-text', id: MISSING, text: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });

  it('detaching every target turns the note into a document-level one', () => {
    const state = must(
      base,
      note(NOTE, 'anchored', [A]),
      { type: 'set-note-targets', id: NOTE, targets: [] },
    );
    expect(state.document.model.notes[NOTE]?.targets).toEqual([]);
  });
});

describe('note tags', () => {
  it('set-note-tag writes a key and remove-note-tag takes it away', () => {
    const tagged = must(
      base,
      note(NOTE, 'refund path', [A]),
      { type: 'set-note-tag', id: NOTE, key: 'context', values: ['refunds'] },
    );
    expect(tagged.document.model.notes[NOTE]?.tags).toEqual({ context: ['refunds'] });

    const cleared = must(tagged, { type: 'remove-note-tag', id: NOTE, key: 'context' });
    expect(cleared.document.model.notes[NOTE]?.tags).toEqual({});
  });

  it('set-note-tag rejects an empty key', () => {
    const state = must(base, note(NOTE, 'x', [A]));
    const result = apply(state, { type: 'set-note-tag', id: NOTE, key: '', values: ['y'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('rename-tag reaches a note tag through the note id', () => {
    const state = must(
      base,
      note(NOTE, 'refund path', [A], { context: ['refunds'] }),
      { type: 'rename-tag', id: NOTE, from: 'context', to: 'flow' },
    );
    expect(state.document.model.notes[NOTE]?.tags).toEqual({ flow: ['refunds'] });
  });

  it('rename-tag on a note refuses a collision, like on an element', () => {
    const state = must(base, note(NOTE, 'x', [A], { context: ['refunds'], flow: ['checkout'] }));
    const result = apply(state, { type: 'rename-tag', id: NOTE, from: 'context', to: 'flow' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('duplicate-id');
  });
});

describe('delete-note', () => {
  it('removes the note and deselects it', () => {
    const state = must(
      base,
      note(NOTE, 'settled', [A]),
      { type: 'set-selection', ids: [NOTE] },
      { type: 'delete-note', id: NOTE },
    );
    expect(state.document.model.notes[NOTE]).toBeUndefined();
    expect(state.selection).toEqual([]);
  });
});

describe('deleting elements a note describes', () => {
  it('drops the deleted element from the targets', () => {
    const state = must(base, note(NOTE, 'both of these', [A, B]), {
      type: 'delete-element',
      id: A,
    });
    expect(state.document.model.notes[NOTE]?.targets).toEqual([B]);
  });

  it('deletes a note whose last target goes', () => {
    const result = apply(must(base, note(NOTE, 'only this', [A])), {
      type: 'delete-element',
      id: A,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.document.model.notes[NOTE]).toBeUndefined();
    expect(result.events).toContainEqual({ type: 'note-deleted', id: NOTE });
  });

  it('follows a cascade: a note on a connection goes when the connection does', () => {
    // Deleting B removes LINK, whose only other endpoint is A.
    const state = must(base, note(NOTE, 'is this call batched?', [LINK]), {
      type: 'delete-element',
      id: B,
    });
    expect(state.document.model.notes[NOTE]).toBeUndefined();
  });

  it('leaves a document-level note alone', () => {
    const state = must(base, note(NOTE, 'about the document', []), {
      type: 'delete-element',
      id: A,
    });
    expect(state.document.model.notes[NOTE]).toBeDefined();
  });
});

describe('pinned note cards', () => {
  it('move-note pins the card in layout, and the pin dies with the note', () => {
    const pinned = must(
      base,
      note(NOTE, 'park me here', [A]),
      { type: 'move-note', id: NOTE, position: { x: 300, y: 200 } },
    );
    expect(pinned.document.layout[NOTE]).toMatchObject({ x: 300, y: 200 });

    const gone = must(pinned, { type: 'delete-note', id: NOTE });
    expect(gone.document.layout[NOTE]).toBeUndefined();
  });

  it('a pinned note deleted by cascade takes its pin along', () => {
    const state = must(
      base,
      note(NOTE, 'only on A', [A]),
      { type: 'move-note', id: NOTE, position: { x: 10, y: 10 } },
      { type: 'delete-element', id: A },
    );
    expect(state.document.model.notes[NOTE]).toBeUndefined();
    expect(state.document.layout[NOTE]).toBeUndefined();
  });

  it('a pinned card round-trips through the file', () => {
    const state = must(
      base,
      note(NOTE, 'pinned', [A]),
      { type: 'move-note', id: NOTE, position: { x: 120, y: 80 } },
    );
    const text = serializeDocument(state.document);
    const parsed = parseDocument(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.layout[NOTE]).toMatchObject({ x: 120, y: 80 });
    expect(serializeDocument(parsed.document)).toBe(text);
  });

  it('move-note refuses an unknown note', () => {
    const result = apply(base, { type: 'move-note', id: MISSING, position: { x: 0, y: 0 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });
});

describe('selecting a note', () => {
  it('set-selection accepts a note id', () => {
    const state = must(base, note(NOTE, 'look here', [A]), {
      type: 'set-selection',
      ids: [NOTE],
    });
    expect(state.selection).toEqual([NOTE]);
  });

  it('highlights the elements the note describes', () => {
    const state = must(
      base,
      entity(C, 'Ledger', 480),
      note(NOTE, 'look here', [A]),
      { type: 'set-selection', ids: [NOTE] },
    );
    const { muted } = boardEmphasis(state);
    expect(muted.has(A)).toBe(false);
    expect(muted.has(C)).toBe(true);
  });
});

describe('filtering by note', () => {
  it('`note` selects every element a note is attached to', () => {
    const state = must(base, note(NOTE, 'hm', [A, LINK]));
    const selected = selectIds(
      state.document.model.elements,
      'note',
      state.document.comments,
      state.document.model.notes,
    );
    expect(selected).toEqual(new Set([A, LINK]));
  });

  it('`note=text` narrows to notes containing the text, case-insensitively', () => {
    const state = must(
      base,
      note(NOTE, 'Refunds reverse the entry', [A]),
      note(NOTE2, 'settles overnight', [B]),
    );
    const selected = selectIds(
      state.document.model.elements,
      'note=refunds',
      state.document.comments,
      state.document.model.notes,
    );
    expect(selected).toEqual(new Set([A]));
  });

  it('`-note` selects the undescribed rest', () => {
    const state = must(base, note(NOTE, 'hm', [A]));
    const selected = selectIds(
      state.document.model.elements,
      '-note',
      state.document.comments,
      state.document.model.notes,
    );
    expect(selected).toEqual(new Set([B, LINK]));
  });

  it('keeps a space inside quoted note text, and writes it back quoted', () => {
    const parsed = parseFilter('note="minor units"');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.terms).toEqual([{ kind: 'note', negated: false, text: 'minor units' }]);
    expect(formatTerm(parsed.terms[0]!)).toBe('note="minor units"');
  });

  it('a tag term reaches an element through its notes', () => {
    const state = must(base, note(NOTE, 'refund path', [A, B], { context: ['refunds'] }));
    const selected = selectIds(
      state.document.model.elements,
      'context=refunds',
      state.document.comments,
      state.document.model.notes,
    );
    expect(selected).toEqual(new Set([A, B]));
  });

  it('a tag named "note" filters through a quoted key, beside the note filter', () => {
    const state = must(
      base,
      { type: 'set-tag', id: A, key: 'note', values: ['todo'] },
      note(NOTE, 'still open', [B]),
    );

    const parsed = parseFilter('"note"=todo');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.terms).toEqual([{ kind: 'tag', negated: false, key: 'note', value: 'todo' }]);
    expect(formatTerm(parsed.terms[0]!)).toBe('"note"=todo');
    expect(
      selectIds(state.document.model.elements, '"note"=*', {}, state.document.model.notes),
    ).toEqual(new Set([A]));
    expect(
      selectIds(state.document.model.elements, 'note', {}, state.document.model.notes),
    ).toEqual(new Set([B]));
  });
});

describe('note visibility under a filter', () => {
  it('a tag term keeps the notes carrying the tag', () => {
    const state = must(
      base,
      note(NOTE, 'refund path', [A], { context: ['refunds'] }),
      note(NOTE2, 'untagged', [B]),
    );
    const parsed = parseFilter('context=refunds');
    if (!parsed.ok) throw new Error('filter failed to parse');
    expect(matchingNoteIds(state.document.model.notes, parsed.terms)).toEqual(new Set([NOTE]));
  });

  it('a text term keeps the notes containing the text', () => {
    const state = must(
      base,
      note(NOTE, 'Refunds reverse the entry', [A]),
      note(NOTE2, 'settles overnight', [B]),
    );
    const parsed = parseFilter('"refunds"');
    if (!parsed.ok) throw new Error('filter failed to parse');
    expect(matchingNoteIds(state.document.model.notes, parsed.terms)).toEqual(new Set([NOTE]));
  });

  it('comment terms and note terms hide no notes', () => {
    const state = must(base, note(NOTE, 'plain', [A]));
    const parsed = parseFilter('comment=retry note=other');
    if (!parsed.ok) throw new Error('filter failed to parse');
    expect(matchingNoteIds(state.document.model.notes, parsed.terms)).toEqual(new Set([NOTE]));
  });

  it('a committed filter hides the non-matching notes', () => {
    const state = must(
      base,
      note(NOTE, 'refund path', [A], { context: ['refunds'] }),
      note(NOTE2, 'untagged', [B]),
      { type: 'set-filter', expression: 'context=refunds' },
    );
    expect(hiddenNoteIds(state)).toEqual(new Set([NOTE2]));
  });

  it('no filter hides no notes', () => {
    const state = must(base, note(NOTE, 'plain', [A]));
    expect(hiddenNoteIds(state)).toEqual(new Set());
  });
});

describe('search suggestions', () => {
  it('offers note filters for a query found in a note', () => {
    const state = must(base, note(NOTE, 'refunds reverse the entry', [A]));
    const options = noteSuggestions(state.document.model.notes, 'refunds');
    expect(options.map((option) => option.label)).toContain('note=refunds');
  });

  it('offers tag filters for keys and values that only notes carry', () => {
    const state = must(base, note(NOTE, 'refund path', [A], { context: ['refunds'] }));
    const options = tagSuggestions(
      state.document.model.elements,
      'context',
      state.document.model.notes,
    );
    expect(options.map((option) => option.label)).toEqual(['context', 'context=refunds']);
  });
});

describe('undo and redo', () => {
  it('undoes a note and brings it back', () => {
    const created = must(base, note(NOTE, 'undo me', [A]));
    const undone = must(created, { type: 'undo' });
    expect(undone.document.model.notes[NOTE]).toBeUndefined();
    const redone = must(undone, { type: 'redo' });
    expect(redone.document.model.notes[NOTE]?.text).toBe('undo me');
  });

  it('undoing a delete-element restores the note it took along', () => {
    const state = must(base, note(NOTE, 'only on A', [A]), {
      type: 'delete-element',
      id: A,
    });
    const undone = must(state, { type: 'undo' });
    expect(undone.document.model.notes[NOTE]?.targets).toEqual([A]);
  });

  it('a selected note survives an unrelated undo', () => {
    const state = must(
      base,
      note(NOTE, 'keep me selected', [A]),
      entity(C, 'Ledger', 480),
      { type: 'set-selection', ids: [NOTE] },
      { type: 'undo' },
    );
    expect(state.selection).toEqual([NOTE]);
  });
});

describe('document format', () => {
  it('round-trips notes byte for byte, targets and tag values sorted', () => {
    const state = must(base, note(NOTE, 'still true?', [B, A], { context: ['z', 'a'] }));
    const text = serializeDocument(state.document);
    const parsed = parseDocument(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeDocument(parsed.document)).toBe(text);
    expect(parsed.document.model.notes[NOTE]?.targets).toEqual([A, B]);
    expect(parsed.document.model.notes[NOTE]?.tags).toEqual({ context: ['a', 'z'] });
  });

  it('loads a version 8 document at the current version with no notes', () => {
    const state = must(initialState(DOC), entity(A, 'Solo'));
    const raw = JSON.parse(serializeDocument(state.document)) as {
      formatVersion: number;
      model: Record<string, unknown>;
    };
    delete raw.model['notes'];
    raw.formatVersion = 8;
    const parsed = parseDocument(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.formatVersion).toBe(FORMAT_VERSION);
    expect(parsed.document.model.notes).toEqual({});
  });

  it('unknown-reference: rejects a note aimed at a missing element', () => {
    const state = must(base, note(NOTE, 'about A', [A]));
    const raw = JSON.parse(serializeDocument(state.document)) as {
      model: { notes: Record<string, { targets: string[] }> };
    };
    raw.model.notes[NOTE]!.targets = [MISSING];
    const result = validateDocument(raw);
    expect(result.errors.map((issue) => issue.code)).toContain('unknown-reference');
  });

  it('id-collision: rejects a note sharing an id with an element', () => {
    const state = must(base, note(NOTE, 'fine', [A]));
    const raw = JSON.parse(serializeDocument(state.document)) as {
      model: { notes: Record<string, { id: string; targets: string[] }> };
    };
    raw.model.notes[A] = { ...raw.model.notes[NOTE]!, id: A };
    delete raw.model.notes[NOTE];
    const result = validateDocument(raw);
    expect(result.errors.map((issue) => issue.code)).toContain('id-collision');
  });

  it('id-collision: rejects a note sharing an id with a comment', () => {
    const state = must(
      base,
      { type: 'create-comment', id: COMMENT, text: 'open question', targets: [A] },
      note(NOTE, 'fine', [A]),
    );
    const raw = JSON.parse(serializeDocument(state.document)) as {
      model: { notes: Record<string, { id: string; targets: string[] }> };
    };
    raw.model.notes[COMMENT] = { ...raw.model.notes[NOTE]!, id: COMMENT };
    delete raw.model.notes[NOTE];
    const result = validateDocument(raw);
    expect(result.errors.map((issue) => issue.code)).toContain('id-collision');
  });

  it('merge-document upserts notes', () => {
    const incoming = must(base, note(NOTE, 'from the producer', [A]));
    const state = must(base, { type: 'merge-document', document: incoming.document });
    expect(state.document.model.notes[NOTE]?.text).toBe('from the producer');
    expect(allNotes(state.document.model.notes).map((entry) => entry.id)).toEqual([NOTE]);
  });
});
