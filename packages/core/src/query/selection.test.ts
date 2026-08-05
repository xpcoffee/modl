import { beforeEach, describe, expect, it } from 'vitest';
import { applyAll } from '../commands/apply.js';
import type { AppState, Command } from '../commands/types.js';
import { initialState } from '../state.js';
import { selectionSpanOf, visibleElementIds } from './selection.js';

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
});

describe('selectionSpanOf', () => {
  it('is just the element for a non-group', () => {
    const span = selectionSpanOf(base.document.model.elements, new Set(), [], LEDGER);
    expect(span).toEqual([LEDGER]);
  });

  it('is just the group while it is collapsed', () => {
    const span = selectionSpanOf(base.document.model.elements, new Set(), [], GROUP);
    expect(span).toEqual([GROUP]);
  });

  it('carries an expanded group\'s members', () => {
    const span = selectionSpanOf(base.document.model.elements, new Set([GROUP]), [], GROUP);
    expect(span).toEqual([GROUP, UI, GATEWAY]);
  });

  it('reaches through nested expanded groups only', () => {
    const state = must(
      base,
      { type: 'group-elements', id: INNER, title: 'Inner', memberIds: [UI], position: { x: 0, y: 0 } },
      { type: 'set-group', id: INNER, groupId: GROUP },
    );
    const open = selectionSpanOf(state.document.model.elements, new Set([GROUP, INNER]), [], GROUP);
    expect(open).toEqual([GROUP, GATEWAY, INNER, UI]);

    // Inner stays collapsed, so it stands in for UI and UI stays out.
    const shut = selectionSpanOf(state.document.model.elements, new Set([GROUP]), [], GROUP);
    expect(shut).toEqual([GROUP, GATEWAY, INNER]);
  });

  it('leaves out a member the reader put away', () => {
    const span = selectionSpanOf(base.document.model.elements, new Set([GROUP]), [UI], GROUP);
    expect(span).toEqual([GROUP, GATEWAY]);
  });
});

describe('visibleElementIds', () => {
  it('holds every element while everything is open', () => {
    const state = must(base, { type: 'set-expanded', id: GROUP, expanded: true });
    expect(visibleElementIds(state).sort()).toEqual(
      [UI, GATEWAY, LEDGER, AUTHORISE, POST, GROUP].sort(),
    );
  });

  it('leaves out members of a collapsed group, keeping the group', () => {
    const ids = visibleElementIds(base);
    expect(ids).toContain(GROUP);
    expect(ids).toContain(LEDGER);
    expect(ids).not.toContain(UI);
    expect(ids).not.toContain(GATEWAY);
  });

  it('keeps a connection that draws against a collapsed group', () => {
    // Gateway -> Ledger draws as Group -> Ledger, so it stays selectable.
    expect(visibleElementIds(base)).toContain(POST);
  });

  it('leaves out a connection with both ends inside one collapsed group', () => {
    expect(visibleElementIds(base)).not.toContain(AUTHORISE);
  });

  it('leaves out put-away elements and the connections touching them', () => {
    const state = must(
      base,
      { type: 'set-expanded', id: GROUP, expanded: true },
      { type: 'set-hidden', id: LEDGER, hidden: true },
    );
    const ids = visibleElementIds(state);
    expect(ids).not.toContain(LEDGER);
    expect(ids).not.toContain(POST);
    expect(ids).toContain(GATEWAY);
  });
});
