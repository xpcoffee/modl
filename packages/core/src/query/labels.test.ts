import { beforeEach, describe, expect, it } from 'vitest';
import { applyAll } from '../commands/apply.js';
import type { AppState, Command } from '../commands/types.js';
import { initialState } from '../state.js';
import { labelsOfNode, labelsOnConnection } from './labels.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const UI = '11111111-1111-4111-8111-111111111111';
const PAID = '22222222-2222-4222-8222-222222222222';
const REFUSED = '33333333-3333-4333-8333-333333333333';
const FIRST = 'decision-1';
const SECOND = 'decision-2';
const IN = 'in-1';
const BETWEEN = 'between-1';
const YES = 'yes-1';
const NO = 'no-1';

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

/**
 * UI -> decision 1 -> decision 2, with decision 2 branching to paid and
 * refused. The line between the two decisions is the one both answer for.
 */
let base: AppState;

beforeEach(() => {
  base = must(
    initialState(DOC),
    entity(UI, 'Checkout UI'),
    entity(PAID, 'Paid', 560),
    entity(REFUSED, 'Refused', 560),
    { type: 'create-connection-node', id: FIRST, shape: 'diamond', title: 'card?', position: { x: 200, y: 0 } },
    { type: 'create-connection-node', id: SECOND, shape: 'diamond', title: 'funds?', position: { x: 380, y: 0 } },
    link(IN, [UI], [FIRST]),
    link(BETWEEN, [FIRST], [SECOND]),
    link(YES, [SECOND], [PAID]),
    link(NO, [SECOND], [REFUSED]),
  );
});

describe('labelsOfNode', () => {
  it('reads the answers a decision gives, sorted by connection', () => {
    const state = must(
      base,
      { type: 'set-connection-label', id: SECOND, connectionId: YES, label: 'funds held' },
      { type: 'set-connection-label', id: SECOND, connectionId: NO, label: 'declined' },
    );
    expect(labelsOfNode(state.document.model.elements, SECOND)).toEqual([
      { nodeId: SECOND, connectionId: NO, label: 'declined' },
      { nodeId: SECOND, connectionId: YES, label: 'funds held' },
    ]);
  });

  it('is empty for an element that is not a connection node', () => {
    expect(labelsOfNode(base.document.model.elements, UI)).toEqual([]);
    expect(labelsOfNode(base.document.model.elements, 'nothing')).toEqual([]);
  });

  it('leaves out a label whose connection no longer touches the node', () => {
    const state = must(base, {
      type: 'set-connection-label', id: SECOND, connectionId: YES, label: 'funds held',
    });
    // Written straight into the model, the way a hand-edited file arrives.
    const node = state.document.model.elements[SECOND];
    if (!node || node.kind !== 'connection-node') throw new Error('missing decision');
    const elements = {
      ...state.document.model.elements,
      [SECOND]: { ...node, labels: { ...node.labels, [IN]: 'stale', [UI]: 'not a connection' } },
    };
    expect(labelsOfNode(elements, SECOND)).toEqual([
      { nodeId: SECOND, connectionId: YES, label: 'funds held' },
    ]);
  });
});

describe('labelsOnConnection', () => {
  it('carries an answer from each decision the line touches', () => {
    const state = must(
      base,
      { type: 'set-connection-label', id: FIRST, connectionId: BETWEEN, label: 'card given' },
      { type: 'set-connection-label', id: SECOND, connectionId: BETWEEN, label: 'checking funds' },
    );
    expect(labelsOnConnection(state.document.model.elements, BETWEEN)).toEqual([
      { nodeId: FIRST, connectionId: BETWEEN, label: 'card given' },
      { nodeId: SECOND, connectionId: BETWEEN, label: 'checking funds' },
    ]);
  });

  it('is empty for a line no decision has answered for', () => {
    expect(labelsOnConnection(base.document.model.elements, YES)).toEqual([]);
    expect(labelsOnConnection(base.document.model.elements, UI)).toEqual([]);
  });
});
