import { beforeEach, describe, expect, it } from 'vitest';
import { apply, applyAll } from './apply.js';
import { initialState } from '../state.js';
import { commentsOn, commentedElementIds } from '../query/comments.js';
import { formatTerm, parseFilter, selectIds } from '../query/filter.js';
import { commentSuggestions, tagSuggestions } from '../query/search.js';
import { boardEmphasis } from '../query/view.js';
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
const MISSING = '99999999-9999-4999-8999-999999999999';

function entity(id: string, title: string, x = 0): Command {
  return { type: 'create-entity', id, entityType: 'component', title, position: { x, y: 0 } };
}

function link(id: string, from: string[], to: string[]): Command {
  return { type: 'create-connection', id, connectionType: 'interaction', from, to, title: '' };
}

function comment(id: string, text: string, targets: string[]): Command {
  return { type: 'create-comment', id, text, targets };
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

describe('create-comment', () => {
  it('stores the comment beside the model, not inside it', () => {
    const state = must(base, comment(NOTE, 'is this still true?', [A]));
    expect(state.document.comments[NOTE]).toEqual({
      id: NOTE,
      text: 'is this still true?',
      targets: [A],
    });
    expect(state.document.model.elements[NOTE]).toBeUndefined();
  });

  it('emits comment-created', () => {
    const result = apply(base, comment(NOTE, 'hm', [A]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([{ type: 'comment-created', id: NOTE }]);
  });

  it('attaches to several elements at once, connections included', () => {
    const state = must(base, comment(NOTE, 'this whole flow is provisional', [A, B, LINK]));
    expect(commentsOn(state.document.comments, LINK)).toHaveLength(1);
    expect(commentedElementIds(state.document.comments)).toEqual(new Set([A, B, LINK]));
  });

  it('drops duplicate targets', () => {
    const state = must(base, comment(NOTE, 'twice?', [A, A]));
    expect(state.document.comments[NOTE]?.targets).toEqual([A]);
  });

  it('empty-endpoints: rejects a comment attached to nothing', () => {
    const result = apply(base, comment(NOTE, 'floating', []));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('empty-endpoints');
  });

  it('unknown-element: rejects a target that is not in the document', () => {
    const result = apply(base, comment(NOTE, 'about nothing', [MISSING]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });

  it('duplicate-id: rejects an id already naming an element or a comment', () => {
    const onElement = apply(base, comment(A, 'shadowing', [B]));
    expect(onElement.ok).toBe(false);
    if (!onElement.ok) expect(onElement.error.code).toBe('duplicate-id');

    const state = must(base, comment(NOTE, 'first', [A]));
    const again = apply(state, comment(NOTE, 'second', [B]));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('duplicate-id');
  });
});

describe('set-comment-text and set-comment-targets', () => {
  it('rewrites the text', () => {
    const state = must(
      base,
      comment(NOTE, 'draft', [A]),
      { type: 'set-comment-text', id: NOTE, text: 'final' },
    );
    expect(state.document.comments[NOTE]?.text).toBe('final');
  });

  it('repoints the targets', () => {
    const state = must(
      base,
      comment(NOTE, 'moved on', [A]),
      { type: 'set-comment-targets', id: NOTE, targets: [B, LINK] },
    );
    expect(state.document.comments[NOTE]?.targets).toEqual([B, LINK]);
  });

  it('unknown-element: rejects a comment id that is not in the document', () => {
    const result = apply(base, { type: 'set-comment-text', id: MISSING, text: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });

  it('empty-endpoints: refuses to detach a comment from everything', () => {
    const state = must(base, comment(NOTE, 'anchored', [A]));
    const result = apply(state, { type: 'set-comment-targets', id: NOTE, targets: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('empty-endpoints');
  });
});

describe('delete-comment', () => {
  it('removes the comment and deselects it', () => {
    const state = must(
      base,
      comment(NOTE, 'resolved', [A]),
      { type: 'set-selection', ids: [NOTE] },
      { type: 'delete-comment', id: NOTE },
    );
    expect(state.document.comments[NOTE]).toBeUndefined();
    expect(state.selection).toEqual([]);
  });
});

describe('deleting elements a comment discusses', () => {
  it('drops the deleted element from the targets', () => {
    const state = must(base, comment(NOTE, 'both of these', [A, B]), {
      type: 'delete-element',
      id: A,
    });
    expect(state.document.comments[NOTE]?.targets).toEqual([B]);
  });

  it('deletes a comment whose last target goes', () => {
    const result = apply(must(base, comment(NOTE, 'only this', [A])), {
      type: 'delete-element',
      id: A,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.document.comments[NOTE]).toBeUndefined();
    expect(result.events).toContainEqual({ type: 'comment-deleted', id: NOTE });
  });

  it('follows a cascade: a comment on a connection goes when the connection does', () => {
    // Deleting B removes LINK, whose only other endpoint is A.
    const state = must(base, comment(NOTE, 'is this call needed?', [LINK]), {
      type: 'delete-element',
      id: B,
    });
    expect(state.document.comments[NOTE]).toBeUndefined();
  });
});

describe('selecting a comment', () => {
  it('set-selection accepts a comment id', () => {
    const state = must(base, comment(NOTE, 'look here', [A]), {
      type: 'set-selection',
      ids: [NOTE],
    });
    expect(state.selection).toEqual([NOTE]);
  });

  it('highlights the elements the comment discusses', () => {
    const state = must(
      base,
      entity(C, 'Ledger', 480),
      comment(NOTE, 'look here', [A]),
      { type: 'set-selection', ids: [NOTE] },
    );
    const { muted } = boardEmphasis(state);
    expect(muted.has(A)).toBe(false);
    expect(muted.has(C)).toBe(true);
  });
});

describe('filtering by comment', () => {
  it('`comment` selects every element a comment is attached to', () => {
    const state = must(base, comment(NOTE, 'hm', [A, LINK]));
    const selected = selectIds(
      state.document.model.elements,
      'comment',
      state.document.comments,
    );
    expect(selected).toEqual(new Set([A, LINK]));
  });

  it('`comment=text` narrows to comments containing the text, case-insensitively', () => {
    const state = must(
      base,
      comment(NOTE, 'Retry on timeout?', [A]),
      comment(NOTE2, 'rename this', [B]),
    );
    const selected = selectIds(
      state.document.model.elements,
      'comment=retry',
      state.document.comments,
    );
    expect(selected).toEqual(new Set([A]));
  });

  it('`-comment` selects the undiscussed rest', () => {
    const state = must(base, comment(NOTE, 'hm', [A]));
    const selected = selectIds(
      state.document.model.elements,
      '-comment',
      state.document.comments,
    );
    expect(selected).toEqual(new Set([B, LINK]));
  });

  it('keeps a space inside quoted comment text, and writes it back quoted', () => {
    const parsed = parseFilter('comment="fix this"');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.terms).toEqual([{ kind: 'comment', negated: false, text: 'fix this' }]);
    expect(formatTerm(parsed.terms[0]!)).toBe('comment="fix this"');
  });

  it('offers comment filters in the search menu', () => {
    const state = must(base, comment(NOTE, 'retry on timeout', [A]));
    const options = commentSuggestions(state.document.comments, 'retry');
    expect(options.map((option) => option.label)).toContain('comment=retry');
  });

  it('a tag named "comment" filters through a quoted key, beside the comment filter', () => {
    const state = must(
      base,
      { type: 'set-tag', id: A, key: 'comment', values: ['todo'] },
      comment(NOTE, 'still open', [B]),
    );

    // Search offers both: the tag written with a quoted key, and the comment filter.
    const tags = tagSuggestions(state.document.model.elements, 'comment');
    expect(tags.map((option) => option.label)).toEqual(['"comment"=*', '"comment"=todo']);
    const commentOptions = commentSuggestions(state.document.comments, 'comment');
    expect(commentOptions.map((option) => option.label)).toContain('comment');

    // The quoted key round-trips as a tag term and matches the tagged element.
    const parsed = parseFilter('"comment"=todo');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.terms).toEqual([{ kind: 'tag', negated: false, key: 'comment', value: 'todo' }]);
    expect(formatTerm(parsed.terms[0]!)).toBe('"comment"=todo');
    expect(
      selectIds(state.document.model.elements, '"comment"=*', state.document.comments),
    ).toEqual(new Set([A]));
    expect(
      selectIds(state.document.model.elements, 'comment', state.document.comments),
    ).toEqual(new Set([B]));
  });
});

describe('undo and redo', () => {
  it('undoes a comment and brings it back', () => {
    const created = must(base, comment(NOTE, 'undo me', [A]));
    const undone = must(created, { type: 'undo' });
    expect(undone.document.comments[NOTE]).toBeUndefined();
    const redone = must(undone, { type: 'redo' });
    expect(redone.document.comments[NOTE]?.text).toBe('undo me');
  });

  it('undoing a delete-element restores the comment it took along', () => {
    const state = must(base, comment(NOTE, 'only on A', [A]), {
      type: 'delete-element',
      id: A,
    });
    const undone = must(state, { type: 'undo' });
    expect(undone.document.comments[NOTE]?.targets).toEqual([A]);
  });
});

describe('document format', () => {
  it('round-trips comments byte for byte', () => {
    const state = must(base, comment(NOTE, 'still true?', [B, A]));
    const text = serializeDocument(state.document);
    const parsed = parseDocument(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Targets are written sorted, so the round trip is byte-identical.
    expect(serializeDocument(parsed.document)).toBe(text);
    expect(parsed.document.comments[NOTE]?.targets).toEqual([A, B]);
  });

  it('loads a version 6 document as version 7 with no comments', () => {
    const state = must(initialState(DOC), entity(A, 'Solo'));
    const raw = JSON.parse(serializeDocument(state.document)) as Record<string, unknown>;
    delete raw['comments'];
    raw['formatVersion'] = 6;
    const parsed = parseDocument(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.formatVersion).toBe(7);
    expect(parsed.document.comments).toEqual({});
  });

  it('unknown-reference: rejects a comment aimed at a missing element', () => {
    const state = must(base, comment(NOTE, 'about A', [A]));
    const raw = JSON.parse(serializeDocument(state.document)) as {
      comments: Record<string, { targets: string[] }>;
    };
    raw.comments[NOTE]!.targets = [MISSING];
    const result = validateDocument(raw);
    expect(result.errors.map((issue) => issue.code)).toContain('unknown-reference');
  });

  it('id-collision: rejects a comment sharing an id with an element', () => {
    const state = must(base, comment(NOTE, 'fine', [A]));
    const raw = JSON.parse(serializeDocument(state.document)) as {
      comments: Record<string, { id: string; targets: string[] }>;
    };
    raw.comments[A] = { ...raw.comments[NOTE]!, id: A };
    delete raw.comments[NOTE];
    const result = validateDocument(raw);
    expect(result.errors.map((issue) => issue.code)).toContain('id-collision');
  });

  it('merge-document upserts comments', () => {
    const incoming = must(base, comment(NOTE, 'from the producer', [A]));
    const state = must(base, { type: 'merge-document', document: incoming.document });
    expect(state.document.comments[NOTE]?.text).toBe('from the producer');
  });
});
