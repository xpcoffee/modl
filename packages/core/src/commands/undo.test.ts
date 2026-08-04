import { beforeEach, describe, expect, it } from 'vitest';
import { apply, applyAll } from './apply.js';
import { canRedo, canUndo } from './undo.js';
import { initialState } from '../state.js';
import { parseDocument, serializeDocument } from '../serialize/serialize.js';
import { replay, TraceRecorder } from '../trace/trace.js';
import type { AppState, Command } from './types.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const LINK = '44444444-4444-4444-8444-444444444444';
const MISSING = '99999999-9999-4999-8999-999999999999';

function entity(id: string, title: string, x = 0): Command {
  return { type: 'create-entity', id, entityType: 'component', title, position: { x, y: 0 } };
}

/** Fails the test if a command was rejected, and returns the new state. */
function must(state: AppState, ...commands: Command[]): AppState {
  const result = applyAll(state, commands);
  if (!result.ok) throw new Error(`unexpected rejection: ${JSON.stringify(result.error)}`);
  return result.state;
}

let base: AppState;

beforeEach(() => {
  base = must(initialState(DOC), entity(A, 'Checkout UI'), entity(B, 'Gateway', 240));
});

describe('undo', () => {
  it('removes the effect of the last command', () => {
    const state = must(base, entity(C, 'Ledger'), { type: 'undo' });
    expect(state.document.model.elements[C]).toBeUndefined();
    expect(state.document.layout[C]).toBeUndefined();
    expect(Object.keys(state.document.model.elements)).toHaveLength(2);
  });

  it('steps back one command at a time', () => {
    const once = must(base, { type: 'undo' });
    expect(Object.keys(once.document.model.elements)).toEqual([A]);

    const twice = must(once, { type: 'undo' });
    expect(Object.keys(twice.document.model.elements)).toHaveLength(0);
  });

  it('restores a deleted element with its layout', () => {
    const before = serializeDocument(base.document);
    const state = must(base, { type: 'delete-element', id: A }, { type: 'undo' });
    expect(serializeDocument(state.document)).toBe(before);
  });

  it('nothing-to-undo: rejects at the beginning of the history', () => {
    const empty = initialState(DOC);
    const result = apply(empty, { type: 'undo' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('nothing-to-undo');
  });

  it('emits history-moved with the new cursor', () => {
    const result = apply(base, { type: 'undo' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([{ type: 'history-moved', direction: 'undo', cursor: 1 }]);
  });

  it('skips a rejected command: it never entered the history', () => {
    const rejected = apply(base, entity(A, 'Duplicate'));
    expect(rejected.ok).toBe(false);

    const state = must(base, { type: 'undo' });
    expect(state.document.model.elements[B]).toBeUndefined();
    expect(state.document.model.elements[A]).toBeDefined();
  });
});

describe('redo', () => {
  it('replays what undo removed', () => {
    const before = serializeDocument(base.document);
    const state = must(base, { type: 'undo' }, { type: 'redo' });
    expect(serializeDocument(state.document)).toBe(before);
  });

  it('nothing-to-redo: rejects at the end of the history', () => {
    const result = apply(base, { type: 'redo' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('nothing-to-redo');
  });

  it('a new command after undo discards the redo branch', () => {
    const state = must(base, { type: 'undo' }, entity(C, 'Ledger'));
    expect(canRedo(state)).toBe(false);

    const result = apply(state, { type: 'redo' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('nothing-to-redo');
    // The branch really is gone: B was undone and C took its place.
    expect(state.document.model.elements[B]).toBeUndefined();
    expect(state.document.model.elements[C]).toBeDefined();
  });
});

describe('canUndo and canRedo', () => {
  it('follow the cursor', () => {
    const empty = initialState(DOC);
    expect(canUndo(empty)).toBe(false);
    expect(canRedo(empty)).toBe(false);

    expect(canUndo(base)).toBe(true);
    expect(canRedo(base)).toBe(false);

    const undone = must(base, { type: 'undo' });
    expect(canUndo(undone)).toBe(true);
    expect(canRedo(undone)).toBe(true);
  });
});

describe('session commands', () => {
  it('selection stays out of the history', () => {
    const state = must(
      base,
      { type: 'set-selection', ids: [A] },
      { type: 'undo' },
    );
    // Undo reached past the selection to the last document change.
    expect(state.document.model.elements[B]).toBeUndefined();
  });

  it('selecting after undo keeps redo alive', () => {
    const state = must(base, { type: 'undo' }, { type: 'set-selection', ids: [A] });
    expect(canRedo(state)).toBe(true);

    const redone = must(state, { type: 'redo' });
    expect(redone.document.model.elements[B]).toBeDefined();
  });

  it('filter, view, and expansion survive an undo', () => {
    const grouped = must(
      base,
      { type: 'group-elements', id: C, title: 'Payments', memberIds: [B], position: { x: 0, y: 0 } },
      { type: 'set-expanded', id: C, expanded: true },
      { type: 'set-filter', expression: 'team=web' },
      { type: 'set-view', pan: { x: 40, y: 60 }, zoom: 2 },
      entity(LINK, 'Extra'),
    );

    const state = must(grouped, { type: 'undo' });
    expect(state.document.model.elements[LINK]).toBeUndefined();
    expect(state.filter).toBe('team=web');
    expect(state.document.view).toEqual({ pan: { x: 40, y: 60 }, zoom: 2 });
    expect(state.expanded).toEqual([C]);
  });

  it('prunes selection of elements the undo removed', () => {
    const state = must(
      base,
      entity(C, 'Ledger'),
      { type: 'set-selection', ids: [A, C] },
      { type: 'undo' },
    );
    expect(state.selection).toEqual([A]);
  });

  it('set-hidden between two document commands does not break continuity', () => {
    const state = must(
      base,
      entity(C, 'Ledger'),
      { type: 'set-hidden', id: A, hidden: true },
      entity(LINK, 'Extra'),
    );

    // Undo walks the document commands only: Extra, then Ledger.
    const once = must(state, { type: 'undo' });
    expect(once.document.model.elements[LINK]).toBeUndefined();
    expect(once.document.model.elements[C]).toBeDefined();

    const twice = must(once, { type: 'undo' });
    expect(twice.document.model.elements[C]).toBeUndefined();

    // Redo comes all the way back.
    const redone = must(twice, { type: 'redo' }, { type: 'redo' });
    expect(redone.document.model.elements[C]).toBeDefined();
    expect(redone.document.model.elements[LINK]).toBeDefined();
  });

  it('hiding after undo keeps redo alive', () => {
    const state = must(
      base,
      { type: 'undo' },
      { type: 'set-hidden', id: A, hidden: true },
      { type: 'set-selection-highlight', enabled: false },
    );
    expect(canRedo(state)).toBe(true);

    const redone = must(state, { type: 'redo' });
    expect(redone.document.model.elements[B]).toBeDefined();
  });

  it('undoing past a hide neither re-shows nor re-hides', () => {
    const state = must(
      base,
      entity(C, 'Ledger'),
      { type: 'set-hidden', id: A, hidden: true },
      entity(LINK, 'Extra'),
      { type: 'undo' },
      { type: 'undo' },
    );

    // Both creations are undone; A stays hidden exactly as the user left it.
    expect(state.document.model.elements[C]).toBeUndefined();
    expect(state.hidden).toEqual([A]);

    const redone = must(state, { type: 'redo' });
    expect(redone.hidden).toEqual([A]);
  });

  it('the selection-highlight preference survives undo and redo', () => {
    const state = must(
      base,
      { type: 'set-selection-highlight', enabled: false },
      entity(C, 'Ledger'),
      { type: 'undo' },
    );
    expect(state.selectionHighlight).toBe(false);

    const redone = must(state, { type: 'redo' });
    expect(redone.selectionHighlight).toBe(false);
  });
});

describe('set-style is a document command', () => {
  it('undo restores the previous style and redo reapplies it', () => {
    const styled = must(base, { type: 'set-style', id: A, style: { fill: '#5b8def' } });
    expect(styled.document.model.elements[A]).toMatchObject({ style: { fill: '#5b8def' } });

    const undone = must(styled, { type: 'undo' });
    expect(undone.document.model.elements[A]?.style).toBeUndefined();

    const redone = must(undone, { type: 'redo' });
    expect(redone.document.model.elements[A]).toMatchObject({ style: { fill: '#5b8def' } });
  });

  it('undo steps back through style changes one at a time', () => {
    const styled = must(
      base,
      { type: 'set-style', id: A, style: { fill: '#5b8def' } },
      { type: 'set-style', id: A, style: { stroke: '#b3452f' } },
    );
    expect(styled.document.model.elements[A]?.style).toEqual({ fill: '#5b8def', stroke: '#b3452f' });

    const undone = must(styled, { type: 'undo' });
    expect(undone.document.model.elements[A]?.style).toEqual({ fill: '#5b8def' });
  });
});

describe('undo across load-document', () => {
  it('restores the document that was open before the load', () => {
    const before = serializeDocument(base.document);
    const other = parseDocument(serializeDocument(must(initialState(MISSING), entity(C, 'Solo')).document));
    if (!other.ok) throw new Error('fixture failed to parse');

    const loaded = must(base, { type: 'load-document', document: other.document });
    expect(loaded.document.model.elements[C]).toBeDefined();

    const undone = must(loaded, { type: 'undo' });
    expect(serializeDocument(undone.document)).toBe(before);

    const redone = must(undone, { type: 'redo' });
    expect(redone.document.model.elements[C]).toBeDefined();
  });
});

describe('undo in a trace', () => {
  it('records undo like any command, and the trace replays with it', () => {
    const recorder = new TraceRecorder(() => '2026-01-01T00:00:00.000Z');
    let state = initialState(DOC);
    for (const command of [
      entity(A, 'Checkout UI'),
      entity(B, 'Gateway', 240),
      { type: 'undo' } as Command,
      entity(C, 'Ledger', 480),
    ]) {
      const result = apply(state, command);
      recorder.record(command, result);
      if (result.ok) state = result.state;
    }

    // B was undone before C arrived, so the document holds A and C.
    expect(Object.keys(state.document.model.elements).sort()).toEqual([A, C]);

    const replayed = replay(initialState(DOC), recorder.all());
    expect(replayed.divergences).toEqual([]);
    expect(serializeDocument(replayed.state.document)).toBe(serializeDocument(state.document));
  });

  it('a replayed session can be undone all the way back', () => {
    const recorder = new TraceRecorder(() => '2026-01-01T00:00:00.000Z');
    let state = initialState(DOC);
    for (const command of [entity(A, 'Checkout UI'), entity(B, 'Gateway', 240)]) {
      const result = apply(state, command);
      recorder.record(command, result);
      if (result.ok) state = result.state;
    }

    let replayed = replay(initialState(DOC), recorder.all()).state;
    expect(canUndo(replayed)).toBe(true);

    while (canUndo(replayed)) replayed = must(replayed, { type: 'undo' });
    expect(Object.keys(replayed.document.model.elements)).toHaveLength(0);

    while (canRedo(replayed)) replayed = must(replayed, { type: 'redo' });
    expect(serializeDocument(replayed.document)).toBe(serializeDocument(state.document));
  });
});

describe('purity', () => {
  it('undo leaves the input state untouched', () => {
    const frozen = deepFreeze(structuredClone(base));
    const result = apply(frozen, { type: 'undo' });
    expect(result.ok).toBe(true);
    expect(Object.keys(frozen.document.model.elements)).toHaveLength(2);
    expect(frozen.undo.cursor).toBe(2);
  });
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
