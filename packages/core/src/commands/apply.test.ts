import { beforeEach, describe, expect, it } from 'vitest';
import { apply, applyAll } from './apply.js';
import { isGroup } from '../query/groups.js';
import { labelsOfNode, labelsOnConnection } from '../query/labels.js';
import { initialState } from '../state.js';
import { parseDocument, serializeDocument } from '../serialize/serialize.js';
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

describe('duplicate-elements', () => {
  const COPY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const COPY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const COPY_LINK = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const GROUP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const COPY_GROUP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  function duplicate(idMap: Record<string, string>, offset = { x: 40, y: 40 }): Command {
    return { type: 'duplicate-elements', idMap, offset };
  }

  it('copies an element under its new id, offset from the original', () => {
    const state = must(
      base,
      { type: 'set-metadata', id: A, description: 'the front end' },
      { type: 'set-tag', id: A, key: 'team', values: ['web', 'core'] },
      { type: 'set-sources', id: A, sources: [{ ref: 'src/ui.ts:1' }] },
      { type: 'set-style', id: A, style: { fill: '#112233' } },
      duplicate({ [A]: COPY_A }),
    );

    expect(state.document.model.elements[COPY_A]).toEqual({
      id: COPY_A,
      kind: 'entity',
      type: 'component',
      title: 'Checkout UI',
      description: 'the front end',
      tags: { team: ['web', 'core'] },
      sources: [{ ref: 'src/ui.ts:1' }],
      groupId: null,
      style: { fill: '#112233' },
    });
    expect(state.document.layout[COPY_A]).toEqual({ x: 40, y: 40, width: 180, height: 72 });
    // The original is untouched.
    expect(state.document.layout[A]).toEqual({ x: 0, y: 0, width: 180, height: 72 });
  });

  it('shares nothing mutable with the element it copied', () => {
    const state = must(
      base,
      { type: 'set-tag', id: A, key: 'team', values: ['web'] },
      duplicate({ [A]: COPY_A }),
    );
    const original = state.document.model.elements[A];
    const copy = state.document.model.elements[COPY_A];
    expect(copy?.tags).not.toBe(original?.tags);
    expect(copy?.tags['team']).not.toBe(original?.tags['team']);
    expect(copy?.sources).not.toBe(original?.sources);
  });

  it('re-points a connection at the copies of its ends', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      duplicate({ [A]: COPY_A, [B]: COPY_B, [LINK]: COPY_LINK }),
    );
    expect(state.document.model.elements[COPY_LINK]).toMatchObject({
      kind: 'connection',
      from: [COPY_A],
      to: [COPY_B],
    });
  });

  it('leaves an end outside the copy pointing at the original', () => {
    const state = must(base, link(LINK, [A], [B]), duplicate({ [A]: COPY_A, [LINK]: COPY_LINK }));
    expect(state.document.model.elements[COPY_LINK]).toMatchObject({ from: [COPY_A], to: [B] });
  });

  it('keeps a copy inside the group its original belongs to', () => {
    const state = must(
      base,
      { type: 'group-elements', id: GROUP, title: 'Payments', memberIds: [A], position: { x: 0, y: 0 } },
      duplicate({ [A]: COPY_A }),
    );
    expect(state.document.model.elements[COPY_A]?.groupId).toBe(GROUP);
  });

  it('re-points a member at the copy of its group', () => {
    const state = must(
      base,
      { type: 'group-elements', id: GROUP, title: 'Payments', memberIds: [A], position: { x: 0, y: 0 } },
      duplicate({ [GROUP]: COPY_GROUP, [A]: COPY_A }),
    );
    expect(state.document.model.elements[COPY_A]?.groupId).toBe(COPY_GROUP);
    expect(state.document.model.elements[COPY_GROUP]?.groupId).toBeNull();
  });

  it('opens a copy of an open group, and keeps both of its sizes', () => {
    const state = must(
      base,
      { type: 'group-elements', id: GROUP, title: 'Payments', memberIds: [A], position: { x: 0, y: 0 } },
      { type: 'set-expanded', id: GROUP, expanded: true },
      { type: 'resize-element', id: GROUP, width: 400, height: 300 },
      duplicate({ [GROUP]: COPY_GROUP, [A]: COPY_A }, { x: 500, y: 0 }),
    );
    expect(state.expanded).toContain(COPY_GROUP);
    expect(state.document.layout[COPY_GROUP]).toMatchObject({
      x: (state.document.layout[GROUP] as { x: number }).x + 500,
      expanded: { width: 400, height: 300 },
    });
  });

  it('shifts a connection\'s bends with it', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      { type: 'set-waypoints', id: LINK, waypoints: [{ x: 100, y: 100 }] },
      duplicate({ [A]: COPY_A, [B]: COPY_B, [LINK]: COPY_LINK }, { x: 10, y: 20 }),
    );
    expect(state.document.layout[COPY_LINK]).toMatchObject({ waypoints: [{ x: 110, y: 120 }] });
  });

  it('selects the copies and reports them created', () => {
    const result = apply(base, duplicate({ [A]: COPY_A, [B]: COPY_B }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.selection.sort()).toEqual([COPY_A, COPY_B].sort());
    expect(result.events).toContainEqual({ type: 'element-created', id: COPY_A });
    expect(result.events).toContainEqual({ type: 'element-created', id: COPY_B });
  });

  it('is undoable in one step', () => {
    const state = must(base, duplicate({ [A]: COPY_A, [B]: COPY_B }), { type: 'undo' });
    expect(state.document.model.elements[COPY_A]).toBeUndefined();
    expect(state.document.model.elements[COPY_B]).toBeUndefined();
    expect(Object.keys(state.document.model.elements)).toHaveLength(2);
  });

  it('unknown-element: rejects copying something that is not there', () => {
    const result = apply(base, duplicate({ [MISSING]: COPY_A }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });

  it('duplicate-id: rejects an id already in the document', () => {
    const result = apply(base, duplicate({ [A]: B }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('duplicate-id');
  });

  it('duplicate-id: rejects two copies claiming one id', () => {
    const result = apply(base, duplicate({ [A]: COPY_A, [B]: COPY_A }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('duplicate-id');
  });

  it('schema-invalid: rejects a copy of nothing', () => {
    const result = apply(base, duplicate({}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('schema-invalid: rejects an offset that is not a number', () => {
    const result = apply(base, duplicate({ [A]: COPY_A }, { x: Number.NaN, y: 0 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('leaves the document valid to save and load', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      duplicate({ [A]: COPY_A, [B]: COPY_B, [LINK]: COPY_LINK }),
    );
    const parsed = parseDocument(serializeDocument(state.document));
    expect(parsed.ok).toBe(true);
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
    let state = must(base, { type: 'set-tag', id: A, key: 'team', values: ['web'] });
    expect(state.document.model.elements[A]?.tags).toEqual({ team: ['web'] });
    state = must(state, { type: 'remove-tag', id: A, key: 'team' });
    expect(state.document.model.elements[A]?.tags).toEqual({});
  });

  it('schema-invalid: rejects an empty tag key', () => {
    const result = apply(base, { type: 'set-tag', id: A, key: '', values: ['x'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('unknown-element: rejects tagging a missing element', () => {
    const result = apply(base, { type: 'set-tag', id: MISSING, key: 'k', values: ['v'] });
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

describe('rename-tag', () => {
  it('keeps the value and the position among the other tags', () => {
    const state = must(
      base,
      { type: 'set-tag', id: A, key: 'team', values: ['web'] },
      { type: 'set-tag', id: A, key: 'tier', values: ['1'] },
      { type: 'rename-tag', id: A, from: 'team', to: 'squad' },
    );
    expect(state.document.model.elements[A]?.tags).toEqual({ squad: ['web'], tier: ['1'] });
    expect(Object.keys(state.document.model.elements[A]?.tags ?? {})).toEqual(['squad', 'tier']);
  });

  it('lands as one command in the trace', () => {
    const state = must(base, { type: 'set-tag', id: A, key: 'team', values: ['web'] });
    const result = apply(state, { type: 'rename-tag', id: A, from: 'team', to: 'squad' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([{ type: 'element-updated', id: A }]);
  });

  it('unknown-element: rejects a tag that is not there', () => {
    const result = apply(base, { type: 'rename-tag', id: A, from: 'absent', to: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });

  it('schema-invalid: rejects an empty new key', () => {
    const state = must(base, { type: 'set-tag', id: A, key: 'team', values: ['web'] });
    const result = apply(state, { type: 'rename-tag', id: A, from: 'team', to: '  ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('duplicate-id: refuses to overwrite another tag', () => {
    const state = must(
      base,
      { type: 'set-tag', id: A, key: 'team', values: ['web'] },
      { type: 'set-tag', id: A, key: 'tier', values: ['1'] },
    );
    const result = apply(state, { type: 'rename-tag', id: A, from: 'team', to: 'tier' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('duplicate-id');
  });
});

describe('resize-element', () => {
  it('stores a new size and keeps the position', () => {
    const state = must(
      base,
      { type: 'move-element', id: A, position: { x: 30, y: 40 } },
      { type: 'resize-element', id: A, width: 400, height: 300 },
    );
    expect(state.document.layout[A]).toEqual({ x: 30, y: 40, width: 400, height: 300 });
  });

  it('schema-invalid: rejects a zero dimension', () => {
    const result = apply(base, { type: 'resize-element', id: A, width: 0, height: 100 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('resizes the container while expanded, leaving the collapsed size alone', () => {
    const state = must(
      base,
      { type: 'set-expanded', id: A, expanded: true },
      { type: 'resize-element', id: A, width: 500, height: 400 },
    );
    expect(state.document.layout[A]).toMatchObject({
      width: 180,
      height: 72,
      expanded: { width: 500, height: 400 },
    });
  });

  it('resizes the node while collapsed, leaving the container alone', () => {
    const state = must(
      base,
      { type: 'set-expanded', id: A, expanded: true },
      { type: 'resize-element', id: A, width: 500, height: 400 },
      { type: 'set-expanded', id: A, expanded: false },
      { type: 'resize-element', id: A, width: 220, height: 90 },
    );
    expect(state.document.layout[A]).toMatchObject({
      width: 220,
      height: 90,
      expanded: { width: 500, height: 400 },
    });
  });

  it('keeps both sizes when the element moves', () => {
    const state = must(
      base,
      { type: 'set-expanded', id: A, expanded: true },
      { type: 'resize-element', id: A, width: 500, height: 400 },
      { type: 'set-expanded', id: A, expanded: false },
      { type: 'move-element', id: A, position: { x: 90, y: 90 } },
    );
    expect(state.document.layout[A]).toEqual({
      x: 90,
      y: 90,
      width: 180,
      height: 72,
      expanded: { width: 500, height: 400 },
    });
  });

  it('round trips both sizes through the serializer', () => {
    const state = must(
      base,
      { type: 'set-expanded', id: A, expanded: true },
      { type: 'resize-element', id: A, width: 500, height: 400 },
    );
    const text = serializeDocument(state.document);
    const parsed = parseDocument(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeDocument(parsed.document)).toBe(text);
    expect(parsed.document.layout[A]).toMatchObject({ expanded: { width: 500, height: 400 } });
  });

  it('wrong-kind: rejects resizing a connection', () => {
    const state = must(base, link(LINK, [A], [B]));
    const result = apply(state, { type: 'resize-element', id: LINK, width: 10, height: 10 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong-kind');
  });
});

describe('connection layout', () => {
  it('stores waypoints in order', () => {
    const state = must(base, link(LINK, [A], [B]), {
      type: 'set-waypoints',
      id: LINK,
      waypoints: [
        { x: 100, y: 50 },
        { x: 160, y: 90 },
      ],
    });
    expect(state.document.layout[LINK]).toMatchObject({
      waypoints: [
        { x: 100, y: 50 },
        { x: 160, y: 90 },
      ],
    });
  });

  it('reads forward unless told otherwise', () => {
    const state = must(base, link(LINK, [A], [B]));
    expect(state.document.model.elements[LINK]).toMatchObject({ direction: 'forward' });
  });

  it('keeps its direction when waypoints change', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      { type: 'set-arrowheads', id: LINK, start: true, end: true },
      { type: 'set-waypoints', id: LINK, waypoints: [{ x: 1, y: 2 }] },
    );
    expect(state.document.model.elements[LINK]).toMatchObject({ direction: 'both' });
    expect(state.document.layout[LINK]).toMatchObject({ waypoints: [{ x: 1, y: 2 }] });
  });

  it('reads both ways, or neither', () => {
    let state = must(base, link(LINK, [A], [B]), { type: 'set-arrowheads', id: LINK, start: true, end: true });
    expect(state.document.model.elements[LINK]).toMatchObject({ direction: 'both' });
    state = must(state, { type: 'set-arrowheads', id: LINK, start: false, end: false });
    expect(state.document.model.elements[LINK]).toMatchObject({ direction: 'none' });
  });

  it('a head at the start alone turns the connection round', () => {
    // One way of saying backwards: swap the ends and keep reading forward.
    const state = must(
      base,
      link(LINK, [A], [B]),
      { type: 'set-arrowheads', id: LINK, start: true, end: false },
    );
    expect(state.document.model.elements[LINK]).toMatchObject({
      from: [B],
      to: [A],
      direction: 'forward',
    });
  });

  it('a flip takes the bends and the contact points with it', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      { type: 'set-connection-sides', id: LINK, source: 'top', target: 'bottom' },
      { type: 'set-waypoints', id: LINK, waypoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
      { type: 'set-arrowheads', id: LINK, start: true, end: false },
    );
    expect(state.document.layout[LINK]).toMatchObject({
      sourceSide: 'bottom',
      targetSide: 'top',
      waypoints: [{ x: 2, y: 2 }, { x: 1, y: 1 }],
    });
  });

  it('remembers the points a reader dragged onto', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      { type: 'set-connection-sides', id: LINK, source: 'bottom', target: 'top' },
    );
    expect(state.document.layout[LINK]).toMatchObject({ sourceSide: 'bottom', targetSide: 'top' });
  });

  it('clears a contact point with null, so the renderer picks again', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      { type: 'set-connection-sides', id: LINK, source: 'bottom', target: 'top' },
      { type: 'set-connection-sides', id: LINK, source: null, target: null },
    );
    expect(state.document.layout[LINK]).not.toHaveProperty('sourceSide');
  });

  it('clears waypoints with an empty list', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      { type: 'set-waypoints', id: LINK, waypoints: [{ x: 1, y: 2 }] },
      { type: 'set-waypoints', id: LINK, waypoints: [] },
    );
    expect(state.document.layout[LINK]).toMatchObject({ waypoints: [] });
  });

  it('wrong-kind: rejects waypoints on an entity', () => {
    const result = apply(base, { type: 'set-waypoints', id: A, waypoints: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong-kind');
  });

  it('wrong-kind: rejects arrowheads on an entity', () => {
    const result = apply(base, { type: 'set-arrowheads', id: A, start: true, end: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong-kind');
  });

  it('schema-invalid: rejects a waypoint that is not finite', () => {
    const state = must(base, link(LINK, [A], [B]));
    const result = apply(state, {
      type: 'set-waypoints',
      id: LINK,
      waypoints: [{ x: Number.NaN, y: 0 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('round trips through the serializer', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      { type: 'set-waypoints', id: LINK, waypoints: [{ x: 10, y: 20 }] },
      { type: 'set-arrowheads', id: LINK, start: true, end: true },
    );
    const text = serializeDocument(state.document);
    const parsed = parseDocument(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeDocument(parsed.document)).toBe(text);
    expect(parsed.document.model.elements[LINK]).toMatchObject({ direction: 'both' });
  });
});

describe('groups', () => {
  const GROUP = '66666666-6666-4666-8666-666666666666';

  it('sizes the container around its members without swelling the collapsed node', () => {
    const state = must(base, {
      type: 'group-elements',
      id: GROUP,
      title: 'Payments',
      memberIds: [A, B],
      position: { x: 0, y: 0 },
    });
    const layout = state.document.layout[GROUP] as {
      width: number;
      height: number;
      expanded: { width: number };
    };
    expect(layout.width).toBe(180);
    expect(layout.height).toBe(72);
    // Wide enough to hold both members, which sit 240 apart.
    expect(layout.expanded.width).toBeGreaterThan(400);
  });

  it('group-elements creates a group holding the members', () => {
    const state = must(base, {
      type: 'group-elements',
      id: GROUP,
      title: 'Payments',
      memberIds: [A, B],
      position: { x: 10, y: 10 },
    });
    expect(state.document.model.elements[GROUP]).toMatchObject({ kind: 'entity', title: 'Payments' });
    expect(state.document.model.elements[A]?.groupId).toBe(GROUP);
    expect(state.document.model.elements[B]?.groupId).toBe(GROUP);
    expect(state.selection).toEqual([GROUP]);
  });

  it('accepts a group with one member', () => {
    const state = must(base, {
      type: 'group-elements',
      id: GROUP,
      title: 'Solo',
      memberIds: [A],
      position: { x: 0, y: 0 },
    });
    expect(state.document.model.elements[A]?.groupId).toBe(GROUP);
  });

  it('accepts an empty group, which stays an ordinary entity', () => {
    const state = must(base, {
      type: 'group-elements',
      id: GROUP,
      title: 'Empty box',
      memberIds: [],
      position: { x: 0, y: 0 },
    });
    expect(state.document.model.elements[GROUP]).toBeDefined();
    expect(isGroup(state.document.model.elements, GROUP)).toBe(false);
  });

  it('set-group moves an element into a group', () => {
    const state = must(base, entity(C, 'Ledger'), { type: 'set-group', id: C, groupId: A });
    expect(state.document.model.elements[C]?.groupId).toBe(A);
  });

  it('set-group clears membership with null', () => {
    const state = must(
      base,
      { type: 'set-group', id: B, groupId: A },
      { type: 'set-group', id: B, groupId: null },
    );
    expect(state.document.model.elements[B]?.groupId).toBeNull();
  });

  it('group-cycle: rejects an element joining itself', () => {
    const result = apply(base, { type: 'set-group', id: A, groupId: A });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('group-cycle');
  });

  it('group-cycle: rejects a group joining its own descendant', () => {
    const state = must(base, { type: 'set-group', id: B, groupId: A });
    const result = apply(state, { type: 'set-group', id: A, groupId: B });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('group-cycle');
  });

  it('not-a-group: rejects a connection as a group', () => {
    const state = must(base, link(LINK, [A], [B]));
    const result = apply(state, { type: 'set-group', id: A, groupId: LINK });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-a-group');
  });

  it('ungroup lifts members to the parent of the group', () => {
    const state = must(
      base,
      { type: 'group-elements', id: GROUP, title: 'Payments', memberIds: [A, B], position: { x: 0, y: 0 } },
      { type: 'ungroup', id: GROUP },
    );
    expect(state.document.model.elements[A]?.groupId).toBeNull();
    expect(state.document.model.elements[GROUP]).toBeDefined();
  });

  it('not-a-group: rejects ungrouping an element with no members', () => {
    const result = apply(base, { type: 'ungroup', id: A });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-a-group');
  });

  it('deleting a group lifts its members rather than orphaning them', () => {
    const state = must(
      base,
      { type: 'group-elements', id: GROUP, title: 'Payments', memberIds: [A, B], position: { x: 0, y: 0 } },
      { type: 'delete-element', id: GROUP },
    );
    expect(state.document.model.elements[GROUP]).toBeUndefined();
    expect(state.document.model.elements[A]?.groupId).toBeNull();
  });

  it('set-expanded records and clears expansion', () => {
    let state = must(base, { type: 'set-expanded', id: A, expanded: true });
    expect(state.expanded).toEqual([A]);
    state = must(state, { type: 'set-expanded', id: A, expanded: false });
    expect(state.expanded).toEqual([]);
  });

  it('deleting an expanded group drops it from the expansion set', () => {
    const state = must(
      base,
      { type: 'group-elements', id: GROUP, title: 'Payments', memberIds: [A], position: { x: 0, y: 0 } },
      { type: 'set-expanded', id: GROUP, expanded: true },
      { type: 'delete-element', id: GROUP },
    );
    expect(state.expanded).toEqual([]);
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

describe('set-hidden', () => {
  it('adds and removes an id, kept sorted', () => {
    let state = must(
      base,
      { type: 'set-hidden', id: B, hidden: true },
      { type: 'set-hidden', id: A, hidden: true },
    );
    expect(state.hidden).toEqual([A, B]);

    state = must(state, { type: 'set-hidden', id: B, hidden: false });
    expect(state.hidden).toEqual([A]);
  });

  it('emits visibility-changed', () => {
    const result = apply(base, { type: 'set-hidden', id: A, hidden: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([{ type: 'visibility-changed', id: A, hidden: true }]);
  });

  it('hiding the same element twice holds it once', () => {
    const state = must(
      base,
      { type: 'set-hidden', id: A, hidden: true },
      { type: 'set-hidden', id: A, hidden: true },
    );
    expect(state.hidden).toEqual([A]);
  });

  it('unknown-element: rejects a missing id', () => {
    const result = apply(base, { type: 'set-hidden', id: MISSING, hidden: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });

  it('never reaches the saved document', () => {
    const state = must(base, { type: 'set-hidden', id: A, hidden: true });
    expect(serializeDocument(state.document)).toBe(serializeDocument(base.document));
  });

  it('deleting an element drops it from the hidden set', () => {
    const state = must(
      base,
      { type: 'set-hidden', id: A, hidden: true },
      { type: 'delete-element', id: A },
    );
    expect(state.hidden).toEqual([]);
  });

  it('loading a document clears the hidden set', () => {
    const other = must(initialState('55555555-5555-4555-8555-555555555555'), entity(C, 'Solo'));
    const state = must(
      must(base, { type: 'set-hidden', id: A, hidden: true }),
      { type: 'load-document', document: other.document },
    );
    expect(state.hidden).toEqual([]);
  });

  it('wrong-kind: refuses to hide a connection', () => {
    const state = must(base, link(LINK, [A], [B]));
    const result = apply(state, { type: 'set-hidden', id: LINK, hidden: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong-kind');
  });

  it('hiding deselects the element it hides', () => {
    const state = must(
      base,
      { type: 'set-selection', ids: [A, B] },
      { type: 'set-hidden', id: A, hidden: true },
    );
    expect(state.selection).toEqual([B]);
  });

  it('hiding deselects the connections it takes off the board', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      { type: 'set-selection', ids: [B, LINK] },
      { type: 'set-hidden', id: A, hidden: true },
    );
    expect(state.selection).toEqual([B]);
  });

  it('hiding a group deselects its selected members', () => {
    const state = must(
      base,
      { type: 'set-group', id: A, groupId: B },
      { type: 'set-expanded', id: B, expanded: true },
      { type: 'set-selection', ids: [A] },
      { type: 'set-hidden', id: B, hidden: true },
    );
    expect(state.selection).toEqual([]);
  });

  it('emits selection-changed only when the selection moved', () => {
    const result = apply(
      must(base, { type: 'set-selection', ids: [B] }),
      { type: 'set-hidden', id: A, hidden: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([{ type: 'visibility-changed', id: A, hidden: true }]);
  });
});

describe('set-selection-highlight', () => {
  it('turns the preference off and on', () => {
    let state = must(base, { type: 'set-selection-highlight', enabled: false });
    expect(state.selectionHighlight).toBe(false);

    state = must(state, { type: 'set-selection-highlight', enabled: true });
    expect(state.selectionHighlight).toBe(true);
  });

  it('survives a document load, unlike the rest of the session', () => {
    const other = must(initialState('55555555-5555-4555-8555-555555555555'), entity(C, 'Solo'));
    const state = must(
      must(base, { type: 'set-selection-highlight', enabled: false }),
      { type: 'load-document', document: other.document },
    );
    expect(state.selectionHighlight).toBe(false);
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

  it('rejects a document with no formatVersion', () => {
    const result = apply(base, {
      type: 'load-document',
      document: { nonsense: true } as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('version-unsupported');
  });

  it('schema-invalid: rejects a document whose elements are malformed', () => {
    const result = apply(base, {
      type: 'load-document',
      document: { formatVersion: 2, id: A, title: '', model: { elements: { x: 1 } } } as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });
});

describe('unknown commands', () => {
  it('rejects rather than returning nothing', () => {
    // A caller guessing a name gets something it can read, instead of
    // `undefined` crashing the dispatcher two frames later.
    const result = apply(base, { type: 'expand-group', id: A } as never);
    expect(result).toBeDefined();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-command');
    expect(result.error.message).toContain('expand-group');
  });
});

describe('merge-document', () => {
  it('upserts by id and leaves the rest alone', () => {
    const other = must(initialState(DOC), entity(C, 'Ledger'));
    const renamed = {
      ...other.document,
      model: {
        elements: {
          [C]: { ...other.document.model.elements[C]!, title: 'Ledger v2' },
        },
      },
    };

    const merged = must(base, { type: 'merge-document', document: renamed });
    expect(merged.document.model.elements[A]).toBeDefined();
    expect(merged.document.model.elements[C]?.title).toBe('Ledger v2');
  });

  it('reports created and updated separately', () => {
    const other = must(initialState(DOC), entity(C, 'Ledger'));
    const first = apply(base, { type: 'merge-document', document: other.document });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.events).toEqual([{ type: 'element-created', id: C }]);

    const again = apply(first.state, { type: 'merge-document', document: other.document });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.events).toEqual([{ type: 'element-updated', id: C }]);
  });

  it('refuses a merge that would break the document', () => {
    const dangling = {
      ...base.document,
      model: {
        elements: {
          [LINK]: {
            id: LINK, kind: 'connection' as const, type: 'interaction' as const,
            title: '', description: '', tags: {}, sources: [], groupId: null,
            from: [A], to: [MISSING],
          },
        },
      },
    };
    const result = apply(base, { type: 'merge-document', document: dangling as never });
    expect(result.ok).toBe(false);
  });
});

describe('set-sources', () => {
  it('records where a claim came from', () => {
    const state = must(base, {
      type: 'set-sources',
      id: A,
      sources: [{ ref: 'src/checkout.ts:42', note: 'calls authorise' }],
    });
    expect(state.document.model.elements[A]?.sources).toEqual([
      { ref: 'src/checkout.ts:42', note: 'calls authorise' },
    ]);
  });

  it('schema-invalid: rejects a source with no ref', () => {
    const result = apply(base, { type: 'set-sources', id: A, sources: [{ ref: '  ' }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });
});

describe('multi-valued tags', () => {
  it('holds several values under one key', () => {
    const state = must(base, { type: 'set-tag', id: A, key: 'flow', values: ['checkout', 'refund'] });
    expect(state.document.model.elements[A]?.tags['flow']).toEqual(['checkout', 'refund']);
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

describe('connection nodes', () => {
  const FORK = 'node-1';

  function node(id: string, shape: 'circle' | 'diamond' = 'diamond'): Command {
    return { type: 'create-connection-node', id, shape, title: 'ready?', position: { x: 120, y: 120 } };
  }

  it('creates a junction with a position', () => {
    const state = must(base, node(FORK));
    expect(state.document.model.elements[FORK]).toMatchObject({
      kind: 'connection-node',
      shape: 'diamond',
      title: 'ready?',
    });
    expect(state.document.layout[FORK]).toEqual({ x: 120, y: 120, width: 64, height: 64 });
  });

  it('joins connections on both sides', () => {
    const state = must(
      base,
      node(FORK),
      { type: 'create-connection', id: LINK, connectionType: 'interaction', from: [A], to: [FORK], title: '' },
      { type: 'create-connection', id: 'out-1', connectionType: 'interaction', from: [FORK], to: [B], title: '' },
    );
    expect(state.document.model.elements[LINK]).toMatchObject({ to: [FORK] });
    expect(state.document.model.elements['out-1']).toMatchObject({ from: [FORK] });
  });

  it('changes shape', () => {
    const state = must(base, node(FORK), { type: 'set-node-shape', id: FORK, shape: 'circle' });
    expect(state.document.model.elements[FORK]).toMatchObject({ shape: 'circle' });
  });

  it('wrong-kind: rejects reshaping something that is not a node', () => {
    const result = apply(base, { type: 'set-node-shape', id: A, shape: 'circle' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong-kind');
  });

  it('moves like anything else on the board', () => {
    const state = must(base, node(FORK), { type: 'move-element', id: FORK, position: { x: 5, y: 6 } });
    expect(state.document.layout[FORK]).toMatchObject({ x: 5, y: 6 });
  });

  it('invalid-endpoint: still refuses a connection as an endpoint', () => {
    const state = must(base, { type: 'create-connection', id: LINK, connectionType: 'interaction', from: [A], to: [B], title: '' });
    const result = apply(state, {
      type: 'create-connection', id: 'bad', connectionType: 'interaction', from: [LINK], to: [B], title: '',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-endpoint');
  });

  it('can sit inside a group', () => {
    const state = must(base, node(FORK), { type: 'set-group', id: FORK, groupId: A });
    expect(state.document.model.elements[FORK]?.groupId).toBe(A);
  });

  it('not-a-group: cannot itself hold members', () => {
    const state = must(base, node(FORK));
    const result = apply(state, { type: 'set-group', id: A, groupId: FORK });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-a-group');
  });
});

describe('connection labels', () => {
  const FORK = 'node-1';
  const IN = 'in-1';
  const OUT = 'out-1';

  /** A > fork > B, so the fork has a branch at each end. */
  function branching(): AppState {
    return must(
      base,
      { type: 'create-connection-node', id: FORK, shape: 'diamond', title: 'ready?', position: { x: 120, y: 0 } },
      link(IN, [A], [FORK]),
      link(OUT, [FORK], [B]),
    );
  }

  it('starts with no labels', () => {
    expect(branching().document.model.elements[FORK]).toMatchObject({ labels: {} });
  });

  it('writes the answer a branch carries', () => {
    const state = must(branching(), {
      type: 'set-connection-label',
      id: FORK,
      connectionId: OUT,
      label: 'stock on hand',
    });
    expect(state.document.model.elements[FORK]).toMatchObject({
      labels: { [OUT]: 'stock on hand' },
    });
    expect(labelsOfNode(state.document.model.elements, FORK)).toEqual([
      { nodeId: FORK, connectionId: OUT, label: 'stock on hand' },
    ]);
  });

  it('labels an incoming branch too', () => {
    const state = must(branching(), {
      type: 'set-connection-label', id: FORK, connectionId: IN, label: 'order placed',
    });
    expect(labelsOnConnection(state.document.model.elements, IN)).toEqual([
      { nodeId: FORK, connectionId: IN, label: 'order placed' },
    ]);
  });

  it('an empty label removes the entry rather than storing an empty string', () => {
    const state = must(
      branching(),
      { type: 'set-connection-label', id: FORK, connectionId: OUT, label: 'yes' },
      { type: 'set-connection-label', id: FORK, connectionId: OUT, label: '' },
    );
    expect(state.document.model.elements[FORK]).toMatchObject({ labels: {} });
  });

  it('emits element-updated for the node holding the label', () => {
    const result = apply(branching(), {
      type: 'set-connection-label', id: FORK, connectionId: OUT, label: 'yes',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([{ type: 'element-updated', id: FORK }]);
  });

  it('wrong-kind: only a connection node carries labels', () => {
    const result = apply(branching(), {
      type: 'set-connection-label', id: A, connectionId: OUT, label: 'yes',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong-kind');
  });

  it('invalid-endpoint: refuses a label for a connection that misses the node', () => {
    const state = must(branching(), link(LINK, [A], [B]));
    const result = apply(state, {
      type: 'set-connection-label', id: FORK, connectionId: LINK, label: 'yes',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-endpoint');
  });

  it('unknown-element: refuses a label for a connection that is not there', () => {
    const result = apply(branching(), {
      type: 'set-connection-label', id: FORK, connectionId: MISSING, label: 'yes',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });

  it('deleting the connection takes its label with it', () => {
    const state = must(
      branching(),
      { type: 'set-connection-label', id: FORK, connectionId: OUT, label: 'yes' },
      { type: 'delete-element', id: OUT },
    );
    expect(state.document.model.elements[FORK]).toMatchObject({ labels: {} });
  });

  it('deleting an endpoint that takes the connection with it clears the label', () => {
    const state = must(
      branching(),
      { type: 'set-connection-label', id: FORK, connectionId: OUT, label: 'yes' },
      { type: 'delete-element', id: B },
    );
    expect(state.document.model.elements[FORK]).toMatchObject({ labels: {} });
  });

  it('re-pointing a connection off the node drops the answer it gave', () => {
    const state = must(
      branching(),
      { type: 'set-connection-label', id: FORK, connectionId: OUT, label: 'yes' },
      { type: 'set-endpoints', id: OUT, from: [A], to: [B] },
    );
    expect(state.document.model.elements[FORK]).toMatchObject({ labels: {} });
  });

  it('re-pointing the far end keeps the answer', () => {
    const state = must(
      branching(),
      entity(C, 'Ledger', 480),
      { type: 'set-connection-label', id: FORK, connectionId: OUT, label: 'yes' },
      { type: 'set-endpoints', id: OUT, from: [FORK], to: [C] },
    );
    expect(state.document.model.elements[FORK]).toMatchObject({ labels: { [OUT]: 'yes' } });
  });

  it('a copy of a decision and its branch carries the label onto the copy', () => {
    const state = must(branching(), {
      type: 'set-connection-label', id: FORK, connectionId: OUT, label: 'yes',
    });
    const copied = must(state, {
      type: 'duplicate-elements',
      idMap: { [FORK]: 'fork-copy', [OUT]: 'out-copy', [B]: 'b-copy' },
      offset: { x: 40, y: 40 },
    });
    expect(copied.document.model.elements['fork-copy']).toMatchObject({
      labels: { 'out-copy': 'yes' },
    });
  });

  it('a copy of the decision alone starts with nothing to answer for', () => {
    const state = must(branching(), {
      type: 'set-connection-label', id: FORK, connectionId: OUT, label: 'yes',
    });
    const copied = must(state, {
      type: 'duplicate-elements',
      idMap: { [FORK]: 'fork-copy' },
      offset: { x: 40, y: 40 },
    });
    expect(copied.document.model.elements['fork-copy']).toMatchObject({ labels: {} });
  });

  it('converting a decision into an entity leaves no labels behind', () => {
    const state = must(
      branching(),
      { type: 'set-connection-label', id: FORK, connectionId: OUT, label: 'yes' },
      { type: 'convert-element', id: FORK, to: 'component' },
    );
    expect(state.document.model.elements[FORK]).not.toHaveProperty('labels');
  });

  it('a label survives a save and a load', () => {
    const state = must(branching(), {
      type: 'set-connection-label', id: FORK, connectionId: OUT, label: 'stock on hand',
    });
    const result = parseDocument(serializeDocument(state.document));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.model.elements[FORK]).toMatchObject({
      labels: { [OUT]: 'stock on hand' },
    });
  });

  it('undo puts a label back the way it was', () => {
    const state = must(
      branching(),
      { type: 'set-connection-label', id: FORK, connectionId: OUT, label: 'yes' },
      { type: 'set-connection-label', id: FORK, connectionId: OUT, label: 'no' },
      { type: 'undo' },
    );
    expect(state.document.model.elements[FORK]).toMatchObject({ labels: { [OUT]: 'yes' } });
  });
});

describe('artifacts', () => {
  it('is an entity type a connection can point at without a paradigm', () => {
    const state = must(
      base,
      { type: 'set-element-type', id: B, elementType: 'artifact' },
      { type: 'create-connection', id: LINK, connectionType: 'transition', from: [A], to: [B], title: '' },
    );
    expect(state.document.model.elements[B]).toMatchObject({ type: 'artifact' });
    expect(state.document.model.elements[LINK]).toMatchObject({ type: 'transition' });
  });
});

describe('set-style', () => {
  it('sets fill, stroke, and stroke style on an entity', () => {
    const state = must(base, {
      type: 'set-style',
      id: A,
      style: { fill: '#5b8def', stroke: '#46a758', strokeStyle: 'dashed' },
    });
    expect(state.document.model.elements[A]?.style).toEqual({
      fill: '#5b8def',
      stroke: '#46a758',
      strokeStyle: 'dashed',
    });
  });

  it('sets stroke and arrowhead on a connection', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      { type: 'set-style', id: LINK, style: { stroke: '#e5484d', arrowhead: 'open' } },
    );
    expect(state.document.model.elements[LINK]?.style).toEqual({
      stroke: '#e5484d',
      arrowhead: 'open',
    });
  });

  it('patches one field and leaves the rest alone', () => {
    const state = must(
      base,
      { type: 'set-style', id: A, style: { fill: '#5b8def', strokeStyle: 'dotted' } },
      { type: 'set-style', id: A, style: { fill: '#46a758' } },
    );
    expect(state.document.model.elements[A]?.style).toEqual({
      fill: '#46a758',
      strokeStyle: 'dotted',
    });
  });

  it('null clears a field, and clearing the last one drops the style', () => {
    const state = must(
      base,
      { type: 'set-style', id: A, style: { fill: '#5b8def' } },
      { type: 'set-style', id: A, style: { fill: null } },
    );
    expect(state.document.model.elements[A]).not.toHaveProperty('style');
  });

  it('emits element-updated', () => {
    const result = apply(base, { type: 'set-style', id: A, style: { fill: '#5b8def' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([{ type: 'element-updated', id: A }]);
  });

  it('styles a connection node like an entity', () => {
    const state = must(
      base,
      { type: 'create-connection-node', id: C, shape: 'diamond', title: '', position: { x: 0, y: 0 } },
      { type: 'set-style', id: C, style: { fill: '#8e4ec6', stroke: '#8e4ec6' } },
    );
    expect(state.document.model.elements[C]?.style).toEqual({
      fill: '#8e4ec6',
      stroke: '#8e4ec6',
    });
  });

  it('wrong-kind: a connection has no fill', () => {
    const state = must(base, link(LINK, [A], [B]));
    const result = apply(state, { type: 'set-style', id: LINK, style: { fill: '#5b8def' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong-kind');
  });

  it('wrong-kind: only a connection carries an arrowhead', () => {
    const result = apply(base, { type: 'set-style', id: A, style: { arrowhead: 'open' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong-kind');
  });

  it('schema-invalid: refuses a colour that is not #rrggbb', () => {
    const result = apply(base, { type: 'set-style', id: A, style: { fill: 'red' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('schema-invalid: refuses a stroke style it does not know', () => {
    const result = apply(base, {
      type: 'set-style',
      id: A,
      style: { strokeStyle: 'wavy' as never },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('unknown-element: refuses an id not in the document', () => {
    const result = apply(base, { type: 'set-style', id: MISSING, style: { fill: '#5b8def' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });
});

describe('creation with a style', () => {
  it('create-entity carries the style into the document', () => {
    const state = must(base, {
      type: 'create-entity',
      id: C,
      entityType: 'component',
      title: 'Ledger',
      position: { x: 0, y: 0 },
      style: { fill: '#5b8def', strokeStyle: 'dashed' },
    });
    expect(state.document.model.elements[C]?.style).toEqual({
      fill: '#5b8def',
      strokeStyle: 'dashed',
    });
  });

  it('create-connection carries the style into the document', () => {
    const state = must(base, {
      type: 'create-connection',
      id: LINK,
      connectionType: 'interaction',
      from: [A],
      to: [B],
      title: '',
      style: { stroke: '#46a758', arrowhead: 'diamond' },
    });
    expect(state.document.model.elements[LINK]?.style).toEqual({
      stroke: '#46a758',
      arrowhead: 'diamond',
    });
  });

  it('wrong-kind: create-connection refuses a fill', () => {
    const result = apply(base, {
      type: 'create-connection',
      id: LINK,
      connectionType: 'interaction',
      from: [A],
      to: [B],
      title: '',
      style: { fill: '#5b8def' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong-kind');
  });

  it('an empty style is not stored', () => {
    const state = must(base, {
      type: 'create-entity',
      id: C,
      entityType: 'component',
      title: 'Ledger',
      position: { x: 0, y: 0 },
      style: {},
    });
    expect(state.document.model.elements[C]).not.toHaveProperty('style');
  });

  it('a styled document round trips through the serializer', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      { type: 'set-style', id: A, style: { fill: '#5b8def', stroke: '#5b8def' } },
      { type: 'set-style', id: LINK, style: { stroke: '#e5484d', arrowhead: 'open' } },
    );
    const text = serializeDocument(state.document);
    const parsed = parseDocument(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeDocument(parsed.document)).toBe(text);
    expect(parsed.document.model.elements[LINK]?.style).toEqual({
      stroke: '#e5484d',
      arrowhead: 'open',
    });
  });
});

describe('reflow-layout', () => {
  const GROUP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const CARD = '77777777-7777-4777-8777-777777777777';

  it('applies every change in one history entry', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      { type: 'set-waypoints', id: LINK, waypoints: [{ x: 100, y: 100 }] },
    );
    const entries = state.undo.history.length;
    const next = must(state, {
      type: 'reflow-layout',
      positions: { [B]: { x: 400, y: 80 } },
      waypoints: { [LINK]: [{ x: 130, y: 140 }] },
      expanded: {},
    });

    expect(next.document.layout[B]).toEqual({ x: 400, y: 80, width: 180, height: 72 });
    expect(next.document.layout[LINK]).toEqual({ waypoints: [{ x: 130, y: 140 }] });
    expect(next.undo.history.length).toBe(entries + 1);
  });

  it('one undo restores every position exactly', () => {
    const state = must(
      base,
      link(LINK, [A], [B]),
      { type: 'set-waypoints', id: LINK, waypoints: [{ x: 100, y: 100 }] },
    );
    const before = serializeDocument(state.document);
    const undone = must(
      state,
      {
        type: 'reflow-layout',
        positions: { [A]: { x: -40, y: 12 }, [B]: { x: 400, y: 80 } },
        waypoints: { [LINK]: [{ x: 130, y: 140 }] },
        expanded: {},
      },
      { type: 'undo' },
    );
    expect(serializeDocument(undone.document)).toBe(before);
  });

  it('emits one move per element and comment-updated for a card', () => {
    const state = must(
      base,
      { type: 'create-comment', id: CARD, text: 'why?', targets: [A] },
      { type: 'move-comment', id: CARD, position: { x: 20, y: 20 } },
    );
    const result = apply(state, {
      type: 'reflow-layout',
      positions: { [B]: { x: 400, y: 80 }, [CARD]: { x: 20, y: 160 } },
      waypoints: {},
      expanded: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([
      { type: 'layout-reflowed', ids: [B, CARD] },
      { type: 'element-moved', id: B, position: { x: 400, y: 80 } },
      { type: 'comment-updated', id: CARD },
    ]);
  });

  it('resizes an expanded container', () => {
    const state = must(
      base,
      { type: 'group-elements', id: GROUP, title: 'G', memberIds: [A], position: { x: 0, y: 0 } },
      { type: 'set-expanded', id: GROUP, expanded: true },
    );
    const next = must(state, {
      type: 'reflow-layout',
      positions: {},
      waypoints: {},
      expanded: { [GROUP]: { width: 400, height: 300 } },
    });
    expect((next.document.layout[GROUP] as { expanded?: object }).expanded).toEqual({
      width: 400,
      height: 300,
    });
  });

  it('unknown-element: rejects a stale id without touching the layout', () => {
    const result = apply(base, {
      type: 'reflow-layout',
      positions: { [A]: { x: 10, y: 10 }, [MISSING]: { x: 0, y: 0 } },
      waypoints: {},
      expanded: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-element');
  });

  it('wrong-kind: rejects a position for a connection', () => {
    const state = must(base, link(LINK, [A], [B]));
    const result = apply(state, {
      type: 'reflow-layout',
      positions: { [LINK]: { x: 10, y: 10 } },
      waypoints: {},
      expanded: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong-kind');
  });

  it('schema-invalid: rejects a payload with nothing in it', () => {
    const result = apply(base, {
      type: 'reflow-layout',
      positions: {},
      waypoints: {},
      expanded: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });

  it('schema-invalid: rejects a position that is not finite', () => {
    const result = apply(base, {
      type: 'reflow-layout',
      positions: { [A]: { x: Number.NaN, y: 0 } },
      waypoints: {},
      expanded: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema-invalid');
  });
});
