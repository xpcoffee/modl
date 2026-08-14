import { beforeEach, describe, expect, it } from 'vitest';
import { applyAll } from '../commands/apply.js';
import type { AppState, Command } from '../commands/types.js';
import { initialState } from '../state.js';
import { boardEmphasis, focusHiddenIds, hiddenElementIds, relationsOf, suppressedConnectionIds } from './view.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const UI = '11111111-1111-4111-8111-111111111111';
const GATEWAY = '22222222-2222-4222-8222-222222222222';
const LEDGER = '33333333-3333-4333-8333-333333333333';
const AUTHORISE = '44444444-4444-4444-8444-444444444444';
const POST = '55555555-5555-4555-8555-555555555555';
const GROUP = '66666666-6666-4666-8666-666666666666';
const INNER = '77777777-7777-4777-8777-777777777777';
const REPORT = '88888888-8888-4888-8888-888888888888';
const NOTE = '99999999-9999-4999-8999-999999999999';

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

  it('ignores a connection id arriving from an old trace', () => {
    const hidden = hiddenElementIds(base.document.model.elements, [AUTHORISE]);
    expect(hidden.size).toBe(0);
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

  it('never suppresses on a connection id in the hidden set', () => {
    // Connections cannot be hidden directly; one leaves the board only when
    // an endpoint hides.
    const suppressed = suppressedConnectionIds(
      base.document.model.elements,
      new Set(),
      new Set([AUTHORISE]),
    );
    expect(suppressed.size).toBe(0);
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

  it('the preference turns the highlight off, leaving hide and filter alone', () => {
    const state = must(
      base,
      { type: 'set-selection-highlight', enabled: false },
      { type: 'set-filter', expression: 'team=payments' },
      { type: 'set-hidden', id: LEDGER, hidden: true },
      { type: 'set-selection', ids: [GATEWAY] },
    );
    const { muted, suppressed } = boardEmphasis(state);
    // No highlight: the filter still mutes UI, hiding still mutes the ledger.
    expect(muted.has(UI)).toBe(true);
    expect(muted.has(LEDGER)).toBe(true);
    expect(muted.has(GATEWAY)).toBe(false);
    expect(suppressed.has(POST)).toBe(true);
  });
});

describe('boardEmphasis: selecting a group', () => {
  /** The payments side (gateway, ledger) in a group, plus an unconnected report. */
  function withPaymentsGroup(...commands: Command[]): AppState {
    return must(
      base,
      entity(REPORT, 'Report', 840),
      {
        type: 'group-elements',
        id: GROUP,
        title: 'Payments',
        memberIds: [GATEWAY, LEDGER],
        position: { x: 280, y: 0 },
      },
      ...commands,
    );
  }

  it('collapsed: the re-pointed external connection and its peer stay readable', () => {
    const state = withPaymentsGroup({ type: 'set-selection', ids: [GROUP] });
    const { muted } = boardEmphasis(state);
    // The members are not drawn, but authorise re-points at the group and
    // stays lit along with the UI at its other end. Only the report fades.
    expect(muted).toEqual(new Set([REPORT]));
  });

  it('expanded: members, their intra-group connection, and their external connections stay readable', () => {
    const state = withPaymentsGroup(
      { type: 'set-expanded', id: GROUP, expanded: true },
      { type: 'set-selection', ids: [GROUP] },
    );
    const { muted } = boardEmphasis(state);
    // Gateway and ledger are members, post runs between them, authorise
    // leaves the group for the UI. Only the report fades.
    expect(muted).toEqual(new Set([REPORT]));
  });

  it('reaches members of a nested group', () => {
    const state = must(
      base,
      entity(REPORT, 'Report', 840),
      {
        type: 'group-elements',
        id: INNER,
        title: 'Books',
        memberIds: [LEDGER],
        position: { x: 560, y: 0 },
      },
      {
        type: 'group-elements',
        id: GROUP,
        title: 'Payments',
        memberIds: [GATEWAY, INNER],
        position: { x: 280, y: 0 },
      },
      { type: 'set-expanded', id: GROUP, expanded: true },
      { type: 'set-expanded', id: INNER, expanded: true },
      { type: 'set-selection', ids: [GROUP] },
    );
    const { muted } = boardEmphasis(state);
    expect(muted.has(LEDGER)).toBe(false);
    expect(muted.has(POST)).toBe(false);
    expect(muted.has(REPORT)).toBe(true);
  });

  it('hiding still beats the group highlight for a member', () => {
    const state = withPaymentsGroup(
      { type: 'set-expanded', id: GROUP, expanded: true },
      { type: 'set-hidden', id: LEDGER, hidden: true },
      { type: 'set-selection', ids: [GROUP] },
    );
    const { muted, suppressed } = boardEmphasis(state);
    expect(muted.has(LEDGER)).toBe(true);
    expect(suppressed.has(POST)).toBe(true);
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

describe('boardEmphasis: filter matching a connection', () => {
  const NOTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  /** Only the authorise connection carries the flow tag. */
  const tagged = (state: AppState): AppState =>
    must(
      state,
      { type: 'set-tag', id: AUTHORISE, key: 'flow', values: ['checkout'] },
      { type: 'set-filter', expression: 'flow=checkout' },
    );

  it('keeps the connection and its endpoints readable (issue #92)', () => {
    const { muted } = boardEmphasis(tagged(base));
    expect(muted).toEqual(new Set([LEDGER, POST]));
  });

  it('keeps a group holding an endpoint readable', () => {
    const state = tagged(
      must(base, entity(GROUP, 'Frontend'), { type: 'set-group', id: UI, groupId: GROUP }),
    );
    const { muted, descendantMatches } = boardEmphasis(state);
    expect(muted.has(GROUP)).toBe(false);
    expect(descendantMatches.get(GROUP)).toBe(1);
  });

  it('hiding still beats the promotion for an endpoint', () => {
    const state = must(tagged(base), { type: 'set-hidden', id: UI, hidden: true });
    const { muted, suppressed } = boardEmphasis(state);
    expect(muted.has(UI)).toBe(true);
    expect(suppressed.has(AUTHORISE)).toBe(true);
  });

  it('a note tagged onto a connection reaches its endpoints too', () => {
    const state = must(
      base,
      { type: 'create-note', id: NOTE, text: 'checkout path', targets: [AUTHORISE], tags: { flow: ['checkout'] } },
      { type: 'set-filter', expression: 'flow=checkout' },
    );
    const { muted } = boardEmphasis(state);
    expect(muted).toEqual(new Set([LEDGER, POST]));
  });
});

describe('boardEmphasis: filter matches inside groups', () => {
  const OUTER = '99999999-9999-4999-8999-999999999999';

  /** Ledger sits inside GROUP, and GROUP inside OUTER; both stay collapsed. */
  function nested(): AppState {
    return must(
      base,
      entity(GROUP, 'Backoffice'),
      entity(OUTER, 'Platform'),
      { type: 'set-group', id: LEDGER, groupId: GROUP },
      { type: 'set-group', id: GROUP, groupId: OUTER },
    );
  }

  it('leaves a group readable when a member inside matches', () => {
    const state = must(
      base,
      entity(GROUP, 'Backoffice'),
      { type: 'set-group', id: LEDGER, groupId: GROUP },
      { type: 'set-filter', expression: 'team=payments' },
    );
    const { muted, descendantMatches } = boardEmphasis(state);
    expect(muted.has(GROUP)).toBe(false);
    expect(muted.has(UI)).toBe(true);
    expect(descendantMatches.get(GROUP)).toBe(1);
  });

  it('a match two levels down keeps every ancestor group readable', () => {
    const state = must(nested(), { type: 'set-filter', expression: 'team=payments' });
    const { muted, descendantMatches } = boardEmphasis(state);
    expect(muted.has(GROUP)).toBe(false);
    expect(muted.has(OUTER)).toBe(false);
    expect(descendantMatches.get(GROUP)).toBe(1);
    expect(descendantMatches.get(OUTER)).toBe(1);
  });

  it('mutes a group with no matching descendant', () => {
    const state = must(nested(), { type: 'set-filter', expression: 'team=web' });
    const { muted, descendantMatches } = boardEmphasis(state);
    expect(muted.has(GROUP)).toBe(true);
    expect(muted.has(OUTER)).toBe(true);
    expect(descendantMatches.size).toBe(0);
  });

  it('a hidden matching member does not unmute the group', () => {
    // Hiding beats filtering: a match the reader put away stays silent.
    const state = must(
      base,
      entity(GROUP, 'Backoffice'),
      { type: 'set-group', id: LEDGER, groupId: GROUP },
      { type: 'set-hidden', id: LEDGER, hidden: true },
      { type: 'set-filter', expression: 'team=payments' },
    );
    const { muted, descendantMatches } = boardEmphasis(state);
    expect(muted.has(GROUP)).toBe(true);
    expect(descendantMatches.has(GROUP)).toBe(false);
  });

  it('selecting a group with a filter active: members light, the rest stays muted', () => {
    // Rule 2 beats rule 3: the selected group speaks for its member (issue
    // #18), and the filter neither lifts a mute outside the neighbourhood
    // nor badges any group while the highlight decides emphasis.
    const state = must(
      base,
      entity(GROUP, 'Backoffice'),
      { type: 'set-group', id: LEDGER, groupId: GROUP },
      { type: 'set-filter', expression: 'team=web' },
      { type: 'set-selection', ids: [GROUP] },
    );
    const { muted, descendantMatches } = boardEmphasis(state);
    expect(muted.has(GROUP)).toBe(false);
    expect(muted.has(LEDGER)).toBe(false);
    // The UI matches team=web but sits outside the highlighted neighbourhood.
    expect(muted.has(UI)).toBe(true);
    expect(descendantMatches.size).toBe(0);
  });

  it('an active selection leaves no descendant matches to badge', () => {
    // The filter only decides emphasis when nothing is selected.
    const state = must(
      base,
      entity(GROUP, 'Backoffice'),
      { type: 'set-group', id: LEDGER, groupId: GROUP },
      { type: 'set-filter', expression: 'team=payments' },
      { type: 'set-selection', ids: [UI] },
    );
    expect(boardEmphasis(state).descendantMatches.size).toBe(0);
  });

  it('an inactive filter guides towards nothing', () => {
    const { descendantMatches } = boardEmphasis(nested());
    expect(descendantMatches.size).toBe(0);
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

  describe('in focus mode', () => {
    const focused = (state: AppState): AppState =>
      must(state, { type: 'set-focus-mode', enabled: true }, { type: 'set-filter', expression: 'team=payments' });

    it('leaves out relations to peers the filter removed', () => {
      expect(relationsOf(focused(base), GATEWAY)).toEqual([{ connectionId: POST, peerId: LEDGER }]);
    });

    it('lists everything again once focus mode turns off', () => {
      const state = must(focused(base), { type: 'set-focus-mode', enabled: false });
      expect(relationsOf(state, GATEWAY)).toEqual([
        { connectionId: AUTHORISE, peerId: UI },
        { connectionId: POST, peerId: LEDGER },
      ]);
    });

    it('returns nothing for an element focus mode removed', () => {
      expect(relationsOf(focused(base), UI)).toEqual([]);
    });

    it('keeps a peer whose collapsed group survives through a matching member', () => {
      // Committing the filter opens the group above the match (#79), so
      // collapse it again to exercise the group-as-anchor case.
      const state = must(
        focused(must(base, entity(GROUP, 'Backoffice'), { type: 'set-group', id: LEDGER, groupId: GROUP })),
        { type: 'set-expanded', id: GROUP, expanded: false },
      );
      expect(relationsOf(state, GATEWAY)).toEqual([{ connectionId: POST, peerId: GROUP }]);
    });
  });
});

describe('focusHiddenIds', () => {
  const focused = (state: AppState): AppState =>
    must(state, { type: 'set-focus-mode', enabled: true }, { type: 'set-filter', expression: 'team=payments' });

  it('is empty while focus mode is off', () => {
    const state = must(base, { type: 'set-filter', expression: 'team=payments' });
    expect(focusHiddenIds(state)).toEqual(new Set());
  });

  it('is empty while no filter runs', () => {
    const state = must(base, { type: 'set-focus-mode', enabled: true });
    expect(focusHiddenIds(state)).toEqual(new Set());
  });

  it('removes elements the filter does not match, and never connections', () => {
    expect(focusHiddenIds(focused(base))).toEqual(new Set([UI]));
  });

  it('keeps a selected non-match: the reader is pointing at it', () => {
    const state = must(focused(base), { type: 'set-selection', ids: [UI] });
    expect(focusHiddenIds(state)).toEqual(new Set());
  });

  it('keeps an explicitly hidden non-match under the hidden treatment', () => {
    const state = must(focused(base), { type: 'set-hidden', id: UI, hidden: true });
    expect(focusHiddenIds(state)).toEqual(new Set());
  });

  it('keeps a group above a match, so the collapsed badge still shows', () => {
    const state = focused(
      must(base, entity(GROUP, 'Backoffice'), { type: 'set-group', id: LEDGER, groupId: GROUP }),
    );
    expect(focusHiddenIds(state)).toEqual(new Set([UI]));
  });

  it('keeps the groups above a kept element, so it still has a place to render', () => {
    const state = must(
      focused(must(base, entity(GROUP, 'Web'), { type: 'set-group', id: UI, groupId: GROUP })),
      { type: 'set-expanded', id: GROUP, expanded: true },
      { type: 'set-selection', ids: [UI] },
    );
    expect(focusHiddenIds(state)).toEqual(new Set());
  });

  it('keeps the endpoints of a matching connection, so its line can draw (issue #92)', () => {
    const state = must(
      base,
      { type: 'set-tag', id: AUTHORISE, key: 'flow', values: ['checkout'] },
      { type: 'set-focus-mode', enabled: true },
      { type: 'set-filter', expression: 'flow=checkout' },
    );
    expect(focusHiddenIds(state)).toEqual(new Set([LEDGER]));
  });

  it('a selected comment stands for its targets', () => {
    const state = must(
      focused(base),
      { type: 'create-comment', id: REPORT, text: 'slow checkout', targets: [UI] },
      { type: 'set-selection', ids: [REPORT] },
    );
    expect(focusHiddenIds(state)).toEqual(new Set());
  });

  it('a comment follows its only target off the board (issue #102)', () => {
    const state = must(focused(base), {
      type: 'create-comment',
      id: REPORT,
      text: 'slow checkout',
      targets: [UI],
    });
    expect(focusHiddenIds(state)).toEqual(new Set([UI, REPORT]));
  });

  it('one standing target keeps a comment spanning several elements', () => {
    const state = must(focused(base), {
      type: 'create-comment',
      id: REPORT,
      text: 'checkout posts here',
      targets: [UI, LEDGER],
    });
    expect(focusHiddenIds(state)).toEqual(new Set([UI]));
  });

  it('a note follows its targets off the board like a comment', () => {
    const state = must(focused(base), {
      type: 'create-note',
      id: NOTE,
      text: 'refund context',
      targets: [UI],
    });
    expect(focusHiddenIds(state)).toEqual(new Set([UI, NOTE]));
  });

  it('an attachment without targets scopes to the document and never leaves', () => {
    const state = must(focused(base), {
      type: 'create-comment',
      id: REPORT,
      text: 'general remark',
      targets: [],
    });
    expect(focusHiddenIds(state)).toEqual(new Set([UI]));
  });

  it('a target inside a kept collapsed group counts as the group standing in', () => {
    const state = must(
      focused(
        must(
          base,
          entity(GROUP, 'Backoffice'),
          entity(INNER, 'Archive'),
          { type: 'set-tag', id: GROUP, key: 'team', values: ['payments'] },
          { type: 'set-group', id: INNER, groupId: GROUP },
        ),
      ),
      { type: 'create-comment', id: REPORT, text: 'inner detail', targets: [INNER] },
    );
    // The inner element is no filter match, but its group is on the board and
    // stands in for it, so the comment stays.
    expect(focusHiddenIds(state).has(REPORT)).toBe(false);
  });

  it('a comment on a connection goes when its line does', () => {
    const state = must(focused(base), {
      type: 'create-comment',
      id: REPORT,
      text: 'about the authorise call',
      targets: [AUTHORISE],
    });
    // The filter removes the UI, taking the authorise line with it.
    expect(focusHiddenIds(state)).toEqual(new Set([UI, REPORT]));
  });
});
