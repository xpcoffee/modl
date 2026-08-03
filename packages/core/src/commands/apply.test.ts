import { beforeEach, describe, expect, it } from 'vitest';
import { apply, applyAll } from './apply.js';
import { initialState } from '../state.js';
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

function link(id: string, from: string[], to: string[]): Command {
  return { type: 'create-connection', id, connectionType: 'interaction', from, to, title: '' };
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

describe('purity', () => {
  it('leaves the input state untouched', () => {
    const frozen = deepFreeze(structuredClone(base));
    const result = apply(frozen, entity(C, 'Ledger'));
    expect(result.ok).toBe(true);
    expect(Object.keys(frozen.document.model.elements)).toHaveLength(2);
  });

  it('returns a different state object', () => {
    const result = apply(base, entity(C, 'Ledger'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).not.toBe(base);
  });
});

describe('create-entity', () => {
  it('adds the entity with a layout entry', () => {
    const state = must(base, entity(C, 'Ledger', 480));
    expect(state.document.model.elements[C]).toMatchObject({
      kind: 'entity',
      type: 'component',
      title: 'Ledger',
      groupId: null,
    });
    expect(state.document.layout[C]).toEqual({ x: 480, y: 0, width: 180, height: 72 });
  });

  it('emits element-created', () => {
    const result = apply(base, entity(C, 'Ledger'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([{ type: 'element-created', id: C }]);
  });

  it('duplicate-id: rejects an id already in the document', () => {
    const result = apply(base, entity(A, 'Again'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('duplicate-id');
    expect(result.error.commandType).toBe('create-entity');
  });
});

describe('create-connection', () => {
  it('joins two entities', () => {
    const state = must(base, link(LINK, [A], [B]));
    expect(state.document.model.elements[LINK]).toMatchObject({
      kind: 'connection',
      from: [A],
      to: [B],
    });
  });

  it('supports many-to-many endpoints', () => {
    const state = must(base, entity(C, 'Ledger'), link(LINK, [A, B], [C]));
    expect(state.document.model.elements[LINK]).toMatchObject({ from: [A, B], to: [C] });
  });

  it('invalid-endpoint: rejects an unknown endpoint', () => {
    const result = apply(base, link(LINK, [A], [MISSING]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-endpoint');
  });

  it('invalid-endpoint: rejects a connection as an endpoint', () => {
    const state = must(base, link(LINK, [A], [B]));
    const result = apply(state, link(C, [LINK], [B]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-endpoint');
  });

  it('empty-endpoints: rejects a missing target', () => {
    const result = apply(base, link(LINK, [A], []));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('empty-endpoints');
  });

  it('self-connection: rejects an entity joined to itself', () => {
    const result = apply(base, link(LINK, [A], [A]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('self-connection');
  });
});

describe('move-element', () => {
  it('updates the position and keeps the size', () => {
    const state = must(base, { type: 'move-element', id: A, position: { x: 50, y: 60 } });
    expect(state.document.layout[A]).toEqual({ x: 50, y: 60, width: 180, height: 72 });
  });

  it('unknown-element: rejects a missing id', () => {
    const result = apply(base, { type: 'move-element', id: MISSING, position: { x: 0, y: 0 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });

  it('wrong-kind: rejects moving a connection', () => {
    const state = must(base, link(LINK, [A], [B]));
    const result = apply(state, { type: 'move-element', id: LINK, position: { x: 0, y: 0 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong-kind');
  });
});

describe('metadata and tags', () => {
  it('sets title and description independently', () => {
    let state = must(base, { type: 'set-metadata', id: A, title: 'Renamed' });
    expect(state.document.model.elements[A]?.title).toBe('Renamed');
    state = must(state, { type: 'set-metadata', id: A, description: 'A description' });
    expect(state.document.model.elements[A]).toMatchObject({
      title: 'Renamed',
      description: 'A description',
    });
  });

  it('sets and removes tags', () => {
    let state = must(base, { type: 'set-tag', id: A, key: 'team', value: 'web' });
    expect(state.document.model.elements[A]?.tags).toEqual({ team: 'web' });
    state = must(state, { type: 'remove-tag', id: A, key: 'team' });
    expect(state.document.model.elements[A]?.tags).toEqual({});
  });

  it('schema-invalid: rejects an empty tag key', () => {
    const result = apply(base, { type: 'set-tag', id: A, key: '', value: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('unknown-element: rejects tagging a missing element', () => {
    const result = apply(base, { type: 'set-tag', id: MISSING, key: 'k', value: 'v' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });
});

describe('set-element-type', () => {
  it('changes an entity type', () => {
    const state = must(base, { type: 'set-element-type', id: A, elementType: 'state' });
    expect(state.document.model.elements[A]).toMatchObject({ kind: 'entity', type: 'state' });
  });

  it('changes a connection type', () => {
    const state = must(base, link(LINK, [A], [B]), {
      type: 'set-element-type',
      id: LINK,
      elementType: 'transition',
    });
    expect(state.document.model.elements[LINK]).toMatchObject({ type: 'transition' });
  });

  it('schema-invalid: rejects a connection type on an entity', () => {
    const result = apply(base, { type: 'set-element-type', id: A, elementType: 'transition' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('schema-invalid: rejects an entity type on a connection', () => {
    const state = must(base, link(LINK, [A], [B]));
    const result = apply(state, { type: 'set-element-type', id: LINK, elementType: 'component' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('unknown-element: rejects a missing id', () => {
    const result = apply(base, { type: 'set-element-type', id: MISSING, elementType: 'state' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });
});

describe('delete-element', () => {
  it('removes the element and its layout', () => {
    const state = must(base, { type: 'delete-element', id: A });
    expect(state.document.model.elements[A]).toBeUndefined();
    expect(state.document.layout[A]).toBeUndefined();
  });

  it('cascades to connections left with no endpoint', () => {
    const state = must(base, link(LINK, [A], [B]), { type: 'delete-element', id: A });
    expect(state.document.model.elements[LINK]).toBeUndefined();
  });

  it('trims a surviving many-to-many connection instead of deleting it', () => {
    const state = must(
      base,
      entity(C, 'Ledger'),
      link(LINK, [A, B], [C]),
      { type: 'delete-element', id: A },
    );
    expect(state.document.model.elements[LINK]).toMatchObject({ from: [B], to: [C] });
  });

  it('names every removed element in its events', () => {
    const state = must(base, link(LINK, [A], [B]));
    const result = apply(state, { type: 'delete-element', id: A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const deleted = result.events.filter((e) => e.type === 'element-deleted').map((e) => e.id);
    expect(deleted).toEqual([A, LINK]);
  });

  it('drops the element from the selection', () => {
    const state = must(base, { type: 'set-selection', ids: [A, B] }, { type: 'delete-element', id: A });
    expect(state.selection).toEqual([B]);
  });
});

describe('set-filter', () => {
  it('stores a valid expression', () => {
    const state = must(base, { type: 'set-filter', expression: 'team=web' });
    expect(state.filter).toBe('team=web');
  });

  it('invalid-filter: leaves the previous filter in place', () => {
    const state = must(base, { type: 'set-filter', expression: 'team=web' });
    const result = apply(state, { type: 'set-filter', expression: '=broken' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-filter');
    expect(state.filter).toBe('team=web');
  });
});

describe('set-view', () => {
  it('stores pan and zoom', () => {
    const state = must(base, { type: 'set-view', pan: { x: 10, y: 20 }, zoom: 1.5 });
    expect(state.document.view).toEqual({ pan: { x: 10, y: 20 }, zoom: 1.5 });
  });

  it('schema-invalid: rejects zero zoom', () => {
    const result = apply(base, { type: 'set-view', pan: { x: 0, y: 0 }, zoom: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });
});

describe('set-selection', () => {
  it('unknown-element: rejects selecting a missing id', () => {
    const result = apply(base, { type: 'set-selection', ids: [MISSING] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });
});

describe('load-document', () => {
  it('replaces the document and clears session state', () => {
    const other = must(initialState('55555555-5555-4555-8555-555555555555'), entity(C, 'Solo'));
    const state = must(
      must(base, { type: 'set-filter', expression: 'team=web' }),
      { type: 'load-document', document: other.document },
    );
    expect(Object.keys(state.document.model.elements)).toEqual([C]);
    expect(state.filter).toBe('');
    expect(state.selection).toEqual([]);
  });

  it('version-unsupported: rejects a newer format', () => {
    const result = apply(base, {
      type: 'load-document',
      document: { ...base.document, formatVersion: 99 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('version-unsupported');
  });

  it('schema-invalid: rejects a malformed document', () => {
    const result = apply(base, {
      type: 'load-document',
      document: { nonsense: true } as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });
});

describe('applyAll', () => {
  it('stops at the first rejection', () => {
    const result = applyAll(base, [entity(C, 'Ledger'), entity(C, 'Duplicate'), entity(MISSING, 'Never')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('duplicate-id');
  });
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}
