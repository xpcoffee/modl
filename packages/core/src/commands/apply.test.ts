import { beforeEach, describe, expect, it } from 'vitest';
import { apply, applyAll } from './apply.js';
import { isGroup } from '../query/groups.js';
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
