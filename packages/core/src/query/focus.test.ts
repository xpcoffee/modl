import { beforeEach, describe, expect, it } from 'vitest';
import { applyAll } from '../commands/apply.js';
import type { AppState, Command } from '../commands/types.js';
import { initialState } from '../state.js';
import { focusLayoutState, planFocusLayout } from './focus.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const UI = '11111111-1111-4111-8111-111111111111';
const GATEWAY = '22222222-2222-4222-8222-222222222222';
const LEDGER = '33333333-3333-4333-8333-333333333333';
const AUTHORISE = '44444444-4444-4444-8444-444444444444';
const GROUP = '66666666-6666-4666-8666-666666666666';
const INNER = '77777777-7777-4777-8777-777777777777';

function entity(id: string, title: string, x = 0, y = 0): Command {
  return { type: 'create-entity', id, entityType: 'component', title, position: { x, y } };
}

function must(state: AppState, ...commands: Command[]): AppState {
  const result = applyAll(state, commands);
  if (!result.ok) throw new Error(`unexpected rejection: ${JSON.stringify(result.error)}`);
  return result.state;
}

function at(state: AppState, id: string): { x: number; y: number } {
  const entry = state.document.layout[id];
  if (!entry || !('x' in entry)) throw new Error(`no position for ${id}`);
  return { x: entry.x, y: entry.y };
}

/** Three components spread far apart; two carry team=payments. */
let base: AppState;

beforeEach(() => {
  base = must(
    initialState(DOC),
    entity(UI, 'Checkout UI', 0, 0),
    entity(GATEWAY, 'Gateway', 1000, 0),
    entity(LEDGER, 'Ledger', 2000, 600),
    { type: 'create-connection', id: AUTHORISE, connectionType: 'interaction', from: [UI], to: [GATEWAY], title: '' },
    { type: 'set-tag', id: GATEWAY, key: 'team', values: ['payments'] },
    { type: 'set-tag', id: LEDGER, key: 'team', values: ['payments'] },
  );
});

const focused = (state: AppState): AppState =>
  must(
    state,
    { type: 'set-focus-mode', enabled: true },
    { type: 'set-filter', expression: 'team=payments' },
  );

describe('planFocusLayout', () => {
  it('plans nothing while focus mode is off', () => {
    const state = must(base, { type: 'set-filter', expression: 'team=payments' });
    expect(planFocusLayout(state)).toBeNull();
  });

  it('plans nothing while no filter runs', () => {
    const state = must(base, { type: 'set-focus-mode', enabled: true });
    expect(planFocusLayout(state)).toBeNull();
  });

  it('plans nothing when the filter matches everything', () => {
    const state = must(
      focused(base),
      { type: 'set-tag', id: UI, key: 'team', values: ['payments'] },
    );
    expect(planFocusLayout(state)).toBeNull();
  });

  it('moves the visible elements closer while the removed one holds still', () => {
    const plan = planFocusLayout(focused(base));
    expect(plan).not.toBeNull();
    expect(plan!.positions[UI]).toBeUndefined();

    const shown = focusLayoutState(focused(base));
    const gateway = at(shown, GATEWAY);
    const ledger = at(shown, LEDGER);
    const spreadBefore = Math.hypot(2000 - 1000, 600 - 0);
    const spreadAfter = Math.hypot(ledger.x - gateway.x, ledger.y - gateway.y);
    expect(spreadAfter).toBeLessThan(spreadBefore / 2);
  });

  it('keeps the visible elements in their reading order, anchored where they sat', () => {
    const shown = focusLayoutState(focused(base));
    const gateway = at(shown, GATEWAY);
    const ledger = at(shown, LEDGER);
    // The gateway read first before (above and left), and still reads first.
    expect(ledger.y > gateway.y || (ledger.y === gateway.y && ledger.x > gateway.x)).toBe(true);
    // The pack anchors at the visible elements' own corner, not the origin.
    expect(gateway).toEqual({ x: 1000, y: 0 });
  });

  it('refits a container around the members still showing', () => {
    const grouped = must(
      base,
      entity(GROUP, 'Backoffice', 3000, 0),
      entity(INNER, 'Reports', 4500, 0),
      { type: 'set-group', id: LEDGER, groupId: GROUP },
      { type: 'set-group', id: INNER, groupId: GROUP },
      { type: 'set-expanded', id: GROUP, expanded: true },
      { type: 'move-element', id: LEDGER, position: { x: 3020, y: 40 } },
      { type: 'move-element', id: INNER, position: { x: 4500, y: 40 } },
    );
    const plan = planFocusLayout(focused(grouped));
    expect(plan).not.toBeNull();
    // Reports does not match and leaves; the group closes around the ledger
    // instead of keeping the width the two members spanned.
    const size = plan!.expanded[GROUP];
    expect(size).toBeDefined();
    expect(size!.width).toBeLessThan(1000);
  });
});

describe('focusLayoutState', () => {
  it('returns the state itself when there is nothing to overlay', () => {
    const state = must(base, { type: 'set-filter', expression: 'team=payments' });
    expect(focusLayoutState(state)).toBe(state);
  });

  it('leaves the input state untouched', () => {
    const state = focused(base);
    const before = structuredClone(state.document);
    focusLayoutState(state);
    expect(state.document).toEqual(before);
  });

  it('clearing the filter drops the overlay entirely', () => {
    const state = must(focused(base), { type: 'set-filter', expression: '' });
    expect(focusLayoutState(state)).toBe(state);
    expect(at(state, LEDGER)).toEqual({ x: 2000, y: 600 });
  });
});
