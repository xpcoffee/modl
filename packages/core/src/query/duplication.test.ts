import { beforeEach, describe, expect, it } from 'vitest';
import { applyAll } from '../commands/apply.js';
import type { AppState, Command } from '../commands/types.js';
import { initialState } from '../state.js';
import { duplicationSpan } from './duplication.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const UI = '11111111-1111-4111-8111-111111111111';
const GATEWAY = '22222222-2222-4222-8222-222222222222';
const LEDGER = '33333333-3333-4333-8333-333333333333';
const AUTHORISE = '44444444-4444-4444-8444-444444444444';
const POST = '55555555-5555-4555-8555-555555555555';
const GROUP = '66666666-6666-4666-8666-666666666666';
const INNER = '77777777-7777-4777-8777-777777777777';

function entity(id: string, title: string, x = 0): Command {
  return { type: 'create-entity', id, entityType: 'component', title, position: { x, y: 0 } };
}

function link(id: string, from: string[], to: string[]): Command {
  return { type: 'create-connection', id, connectionType: 'interaction', from, to, title: '' };
}

function must(state: AppState, ...commands: Command[]): AppState {
  const result = applyAll(state, commands);
  if (!result.ok) throw new Error(`unexpected rejection: ${JSON.stringify(result.error)}`);
  return result.state;
}

/** UI -> Gateway -> Ledger, with UI and Gateway inside a group. */
let base: AppState;
let elements: AppState['document']['model']['elements'];

beforeEach(() => {
  base = must(
    initialState(DOC),
    entity(UI, 'Checkout UI'),
    entity(GATEWAY, 'Gateway', 280),
    entity(LEDGER, 'Ledger', 560),
    link(AUTHORISE, [UI], [GATEWAY]),
    link(POST, [GATEWAY], [LEDGER]),
    { type: 'group-elements', id: GROUP, title: 'Payments', memberIds: [UI, GATEWAY], position: { x: 0, y: 0 } },
  );
  elements = base.document.model.elements;
});

describe('duplicationSpan', () => {
  it('is just the element when nothing hangs off it', () => {
    expect(duplicationSpan(elements, [LEDGER])).toEqual([LEDGER]);
  });

  it('carries the connection between two copied elements, selected or not', () => {
    expect(duplicationSpan(elements, [UI, GATEWAY])).toEqual([UI, GATEWAY, AUTHORISE].sort());
  });

  it('leaves out a connection reaching something that is not copied', () => {
    // Gateway -> Ledger keeps its far end on the board, so no copy of it.
    expect(duplicationSpan(elements, [GATEWAY])).toEqual([GATEWAY]);
  });

  it('copies a group with its members and their connections', () => {
    expect(duplicationSpan(elements, [GROUP])).toEqual([GROUP, UI, GATEWAY, AUTHORISE].sort());
  });

  it('reaches through nested groups whether they are open or shut', () => {
    const state = must(
      base,
      { type: 'group-elements', id: INNER, title: 'Inner', memberIds: [UI], position: { x: 0, y: 0 } },
      { type: 'set-group', id: INNER, groupId: GROUP },
    );
    // Unlike a selection span, a copy reaches members it cannot see: leaving
    // them behind would copy the group as an empty box.
    expect(duplicationSpan(state.document.model.elements, [GROUP])).toEqual(
      [GROUP, INNER, UI, GATEWAY, AUTHORISE].sort(),
    );
  });

  it('ignores a connection asked for on its own', () => {
    expect(duplicationSpan(elements, [AUTHORISE])).toEqual([]);
  });

  it('ignores an id that is not in the document', () => {
    expect(duplicationSpan(elements, ['nobody'])).toEqual([]);
  });

  it('is stable and free of repeats when a group and its member are both named', () => {
    expect(duplicationSpan(elements, [GROUP, UI, UI])).toEqual([GROUP, UI, GATEWAY, AUTHORISE].sort());
  });
});
