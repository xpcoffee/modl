import { beforeEach, describe, expect, it } from 'vitest';
import { applyAll } from '../commands/apply.js';
import type { AppState, Command } from '../commands/types.js';
import { initialState } from '../state.js';
import { focusLayoutState } from './focus.js';
import { goToTarget } from './go-to.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const UI = '11111111-1111-4111-8111-111111111111';
const GATEWAY = '22222222-2222-4222-8222-222222222222';
const LEDGER = '33333333-3333-4333-8333-333333333333';
const AUTHORISE = '44444444-4444-4444-8444-444444444444';
const GROUP = '66666666-6666-4666-8666-666666666666';

function entity(id: string, title: string, x = 0, y = 0): Command {
  return { type: 'create-entity', id, entityType: 'component', title, position: { x, y } };
}

function must(state: AppState, ...commands: Command[]): AppState {
  const result = applyAll(state, commands);
  if (!result.ok) throw new Error(`unexpected rejection: ${JSON.stringify(result.error)}`);
  return result.state;
}

/** Two 180x72 components 1000 apart, with a line between them. */
let base: AppState;

beforeEach(() => {
  base = must(
    initialState(DOC),
    entity(UI, 'Checkout UI', 0, 0),
    entity(GATEWAY, 'Gateway', 1000, 0),
    {
      type: 'create-connection',
      id: AUTHORISE,
      connectionType: 'interaction',
      from: [UI],
      to: [GATEWAY],
      title: 'authorise',
    },
  );
});

describe('goToTarget', () => {
  it('centres an entity on its own box', () => {
    expect(goToTarget(base, GATEWAY)).toEqual({ centre: { x: 1090, y: 36 }, selectId: GATEWAY });
  });

  it('centres a connection between the endpoints its line runs between', () => {
    expect(goToTarget(base, AUTHORISE)).toEqual({ centre: { x: 590, y: 36 }, selectId: AUTHORISE });
  });

  it('a bent line pulls the centre onto the route', () => {
    const bent = must(base, {
      type: 'set-waypoints',
      id: AUTHORISE,
      waypoints: [{ x: 1500, y: 800 }],
    });
    expect(goToTarget(bent, AUTHORISE)?.centre).toEqual({ x: 795, y: 418 });
  });

  it('an element inside a collapsed group resolves to the group', () => {
    const grouped = must(
      base,
      entity(GROUP, 'Payments', 2000, 0),
      entity(LEDGER, 'Ledger', 2040, 40),
      { type: 'set-group', id: LEDGER, groupId: GROUP },
    );
    expect(goToTarget(grouped, LEDGER)).toEqual({ centre: { x: 2090, y: 36 }, selectId: GROUP });
  });

  it('a connection swallowed by one collapsed group resolves to that group', () => {
    const INNER = '77777777-7777-4777-8777-777777777777';
    const grouped = must(
      base,
      entity(GROUP, 'Payments', 2000, 0),
      entity(LEDGER, 'Ledger', 2040, 40),
      entity(INNER, 'Posting', 2040, 200),
      { type: 'set-group', id: LEDGER, groupId: GROUP },
      { type: 'set-group', id: INNER, groupId: GROUP },
      {
        type: 'create-connection',
        id: '55555555-5555-4555-8555-555555555555',
        connectionType: 'interaction',
        from: [LEDGER],
        to: [INNER],
        title: 'post',
      },
    );
    const target = goToTarget(grouped, '55555555-5555-4555-8555-555555555555');
    expect(target).toEqual({ centre: { x: 2090, y: 36 }, selectId: GROUP });
  });

  it('reads the layout it is handed, so focus mode centres what the board draws', () => {
    const spread = must(base, { type: 'move-element', id: GATEWAY, position: { x: 5000, y: 2000 } });
    const focused = focusLayoutState(must(spread, { type: 'set-focus-mode', enabled: true }));

    const saved = goToTarget(spread, AUTHORISE)?.centre;
    const drawn = goToTarget(focused, AUTHORISE)?.centre;
    expect(saved).toEqual({ x: 2590, y: 1036 });
    expect(drawn).not.toEqual(saved);
    // The compacted board is a few hundred pixels across.
    expect(Math.hypot(drawn?.x ?? 0, drawn?.y ?? 0)).toBeLessThan(1000);
  });

  it('has nowhere to go for an element that is not there', () => {
    expect(goToTarget(base, 'missing')).toBeNull();
  });
});
