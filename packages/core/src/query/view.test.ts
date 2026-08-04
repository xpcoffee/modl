import { beforeEach, describe, expect, it } from 'vitest';
import { applyAll } from '../commands/apply.js';
import type { AppState, Command } from '../commands/types.js';
import { initialState } from '../state.js';
import { boardEmphasis, hiddenElementIds, relationsOf, suppressedConnectionIds } from './view.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const UI = '11111111-1111-4111-8111-111111111111';
const GATEWAY = '22222222-2222-4222-8222-222222222222';
const LEDGER = '33333333-3333-4333-8333-333333333333';
const AUTHORISE = '44444444-4444-4444-8444-444444444444';
const POST = '55555555-5555-4555-8555-555555555555';
const GROUP = '66666666-6666-4666-8666-666666666666';

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

/** UI -> Gateway -> Ledger, a chain of two connections. */
let base: AppState;

beforeEach(() => {
  base = must(
    initialState(DOC),
    entity(UI, 'Checkout UI'),
    entity(GATEWAY, 'Gateway', 280),
    entity(LEDGER, 'Ledger', 560),
    link(AUTHORISE, [UI], [GATEWAY]),
    link(POST, [GATEWAY], [LEDGER]),
    { type: 'set-tag', id: UI, key: 'team', values: ['web'] },
    { type: 'set-tag', id: GATEWAY, key: 'team', values: ['payments'] },
    { type: 'set-tag', id: LEDGER, key: 'team', values: ['payments'] },
  );
});

describe('hiddenElementIds', () => {
  it('holds the hidden element itself', () => {
    const hidden = hiddenElementIds(base.document.model.elements, [GATEWAY]);
    expect(hidden).toEqual(new Set([GATEWAY]));
  });

  it('closes over members of a hidden group', () => {
    const state = must(base, { type: 'set-group', id: UI, groupId: GATEWAY });
    const hidden = hiddenElementIds(state.document.model.elements, [GATEWAY]);
    expect(hidden.has(UI)).toBe(true);
    expect(hidden.has(LEDGER)).toBe(false);
  });
});

describe('suppressedConnectionIds', () => {
  it('suppresses every connection touching a hidden element', () => {
    const suppressed = suppressedConnectionIds(
      base.document.model.elements,
      new Set(),
      new Set([GATEWAY]),
    );
    expect(suppressed).toEqual(new Set([AUTHORISE, POST]));
  });

  it('suppresses a connection hidden by itself', () => {
    const suppressed = suppressedConnectionIds(
      base.document.model.elements,
      new Set(),
      new Set([AUTHORISE]),
    );
    expect(suppressed).toEqual(new Set([AUTHORISE]));
  });

  it('leaves the line to a collapsed group alone when a hidden member sits inside', () => {
    // UI joins a collapsed group; hiding UI must not take down the line that
    // now points at the group standing in for it.
    const state = must(
      base,
      entity(GROUP, 'Frontend'),
      { type: 'set-group', id: UI, groupId: GROUP },
    );
    const suppressed = suppressedConnectionIds(
      state.document.model.elements,
      new Set(),
      hiddenElementIds(state.document.model.elements, [UI]),
    );
    expect(suppressed.size).toBe(0);
  });
});

describe('boardEmphasis: hiding', () => {
  it('mutes a hidden element and suppresses its connections', () => {
    const state = must(base, { type: 'set-hidden', id: GATEWAY, hidden: true });
    const { muted, suppressed } = boardEmphasis(state);
    expect(muted).toEqual(new Set([GATEWAY]));
    expect(suppressed).toEqual(new Set([AUTHORISE, POST]));
  });
});

describe('boardEmphasis: selection highlight', () => {
  it('keeps the selection, its connections, and its peers readable', () => {
    const state = must(base, { type: 'set-selection', ids: [UI] });
    const { muted } = boardEmphasis(state);
    expect(muted).toEqual(new Set([LEDGER, POST]));
  });

  it('a multi-selection unions each element’s neighbourhood', () => {
    const state = must(base, { type: 'set-selection', ids: [UI, LEDGER] });
    const { muted } = boardEmphasis(state);
    expect(muted.size).toBe(0);
  });

  it('a selected connection highlights its endpoints', () => {
    const state = must(base, { type: 'set-selection', ids: [AUTHORISE] });
    const { muted } = boardEmphasis(state);
    expect(muted).toEqual(new Set([LEDGER, POST]));
  });

  it('an active selection overrides the tag filter inside the neighbourhood', () => {
    const state = must(
      base,
      { type: 'set-filter', expression: 'team=payments' },
      { type: 'set-selection', ids: [UI] },
    );
    const { muted } = boardEmphasis(state);
    // UI fails the filter and Gateway passes it; the highlight decides both.
    expect(muted.has(UI)).toBe(false);
    expect(muted.has(GATEWAY)).toBe(false);
    expect(muted.has(LEDGER)).toBe(true);
  });

  it('hiding beats highlighting for a peer', () => {
    const state = must(
      base,
      { type: 'set-hidden', id: GATEWAY, hidden: true },
      { type: 'set-selection', ids: [UI] },
    );
    const { muted, suppressed } = boardEmphasis(state);
    expect(muted.has(GATEWAY)).toBe(true);
    expect(suppressed.has(AUTHORISE)).toBe(true);
  });

  it('a directly selected element is never muted, even hidden', () => {
    const state = must(
      base,
      { type: 'set-hidden', id: GATEWAY, hidden: true },
      { type: 'set-selection', ids: [GATEWAY] },
    );
    const { muted } = boardEmphasis(state);
    expect(muted.has(GATEWAY)).toBe(false);
  });
});

describe('boardEmphasis: tag filter', () => {
  it('mutes elements that fail the filter when nothing is selected', () => {
    const state = must(base, { type: 'set-filter', expression: 'team=payments' });
    const { muted } = boardEmphasis(state);
    expect(muted.has(UI)).toBe(true);
    expect(muted.has(GATEWAY)).toBe(false);
  });
});

describe('relationsOf', () => {
  it('lists every drawn connection with the element at the other end', () => {
    expect(relationsOf(base, GATEWAY)).toEqual([
      { connectionId: AUTHORISE, peerId: UI },
      { connectionId: POST, peerId: LEDGER },
    ]);
  });

  it('leaves out suppressed connections', () => {
    const state = must(base, { type: 'set-hidden', id: LEDGER, hidden: true });
    expect(relationsOf(state, GATEWAY)).toEqual([{ connectionId: AUTHORISE, peerId: UI }]);
  });

  it('resolves a peer inside a collapsed group to the group', () => {
    const state = must(
      base,
      entity(GROUP, 'Backoffice'),
      { type: 'set-group', id: LEDGER, groupId: GROUP },
    );
    expect(relationsOf(state, GATEWAY)).toEqual([
      { connectionId: AUTHORISE, peerId: UI },
      { connectionId: POST, peerId: GROUP },
    ]);
  });

  it('returns nothing for an unconnected element', () => {
    const state = must(base, entity(GROUP, 'Loose end'));
    expect(relationsOf(state, GROUP)).toEqual([]);
  });
});
