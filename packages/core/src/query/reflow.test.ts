import { describe, expect, it } from 'vitest';
import { planReflow } from './reflow.js';
import { applyAll } from '../commands/apply.js';
import { initialState } from '../state.js';
import type { AppState, Command } from '../commands/types.js';
import type { EntityLayout } from '../model/types.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const LINK = '44444444-4444-4444-8444-444444444444';
const GROUP = '66666666-6666-4666-8666-666666666666';
const CARD = '77777777-7777-4777-8777-777777777777';

function must(state: AppState, ...commands: Command[]): AppState {
  const result = applyAll(state, commands);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.state;
}

function entity(id: string, x: number, y = 0): Command {
  return { type: 'create-entity', id, entityType: 'component', title: id, position: { x, y } };
}

function boxOf(state: AppState, id: string): EntityLayout {
  return state.document.layout[id] as EntityLayout;
}

describe('planReflow', () => {
  it('returns null for a board that already reads', () => {
    const state = must(initialState(DOC), entity(A, 0), entity(B, 400));
    expect(planReflow(state)).toBeNull();
  });

  it('returns null for an empty document', () => {
    expect(planReflow(initialState(DOC))).toBeNull();
  });

  it('pushes overlapping entities apart along their own axis, keeping their order', () => {
    const state = must(initialState(DOC), entity(A, 0), entity(B, 40, 10));
    const plan = planReflow(state);

    // The pair's offset is mostly horizontal, so it spreads sideways: A is
    // first in reading order and stays put, B ends one horizontal gap (64,
    // plus the pixel the solver overshoots for rounding) clear of A's right
    // edge (180).
    expect(plan?.positions).toEqual({ [B]: { x: 245, y: 10 } });
  });

  it('keeps the moved board anchored where it started', () => {
    const state = must(initialState(DOC), entity(A, 0), entity(B, 40, 10));
    const plan = planReflow(state);
    const applied = must(state, { type: 'reflow-layout', ...plan! });

    const before = boxOf(state, A);
    const after = boxOf(applied, A);
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
  });

  it('widens the gap between two elements to hold their connection label', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      entity(B, 260),
      {
        type: 'create-connection',
        id: LINK,
        connectionType: 'interaction',
        from: [A],
        to: [B],
        title: 'authorise payment',
      },
    );
    const plan = planReflow(state);

    // 17 characters at 7.2px, plus the pill's 28px, plus 24px of clearance.
    const b = plan?.positions[B];
    expect(b).toBeDefined();
    expect(b!.x - 180).toBeGreaterThanOrEqual(175);
    expect(plan?.positions[A]).toBeUndefined();
  });

  it('carries a collapsed group\'s members with it', () => {
    const state = must(
      initialState(DOC),
      entity(A, 10, 10),
      { type: 'group-elements', id: GROUP, title: 'G', memberIds: [A], position: { x: 0, y: 0 } },
      entity(B, 0, -80),
    );
    const plan = planReflow(state);
    expect(plan).not.toBeNull();

    const groupBefore = boxOf(state, GROUP);
    const memberBefore = boxOf(state, A);
    const groupAfter = plan!.positions[GROUP] ?? { x: groupBefore.x, y: groupBefore.y };
    const memberAfter = plan!.positions[A] ?? { x: memberBefore.x, y: memberBefore.y };

    expect(groupAfter).not.toEqual({ x: groupBefore.x, y: groupBefore.y });
    expect(memberAfter.x - memberBefore.x).toBe(groupAfter.x - groupBefore.x);
    expect(memberAfter.y - memberBefore.y).toBe(groupAfter.y - groupBefore.y);
  });

  it('spaces the members of an expanded group and grows the container around them', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      entity(B, 40, 10),
      {
        type: 'group-elements',
        id: GROUP,
        title: 'G',
        memberIds: [A, B],
        position: { x: 0, y: 0 },
      },
      { type: 'set-expanded', id: GROUP, expanded: true },
    );
    const plan = planReflow(state);
    expect(plan).not.toBeNull();

    // The members respace exactly as they would at the root.
    expect(plan!.positions[B]).toEqual({ x: 245, y: 10 });

    // The container grows to hold them, keeping its padding.
    const grown = plan!.expanded[GROUP];
    const groupBefore = boxOf(state, GROUP);
    const at = plan!.positions[GROUP] ?? { x: groupBefore.x, y: groupBefore.y };
    expect(grown).toBeDefined();
    expect(at.x).toBeLessThanOrEqual(0);
    expect(at.y).toBeLessThanOrEqual(0);
    expect(at.x + grown!.width).toBeGreaterThanOrEqual(245 + 180);
    expect(at.y + grown!.height).toBeGreaterThanOrEqual(10 + 72);
  });

  it('gives a pinned comment card the same clearance as a box', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      { type: 'create-comment', id: CARD, text: 'why?', targets: [A] },
      { type: 'move-comment', id: CARD, position: { x: 20, y: 20 } },
    );
    const plan = planReflow(state);

    const card = plan?.positions[CARD];
    expect(card).toBeDefined();
    expect(card!.x).toBeGreaterThanOrEqual(180 + 64);
  });

  it('translates a connection\'s bends by the average of its endpoint moves', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      entity(B, 40, 10),
      { type: 'create-connection', id: LINK, connectionType: 'interaction', from: [A], to: [B], title: '' },
      { type: 'set-waypoints', id: LINK, waypoints: [{ x: 100, y: 100 }] },
    );
    const plan = planReflow(state);

    // A stays, B moves right 205, so the bend rides half of that.
    expect(plan?.positions[B]).toEqual({ x: 245, y: 10 });
    expect(plan?.waypoints[LINK]).toEqual([{ x: 203, y: 100 }]);
  });

  it('is settled after one pass: reflowing the result changes nothing', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      entity(B, 40, 10),
      {
        type: 'create-connection',
        id: LINK,
        connectionType: 'interaction',
        from: [A],
        to: [B],
        title: 'authorise',
      },
    );
    const plan = planReflow(state);
    expect(plan).not.toBeNull();

    const applied = must(state, { type: 'reflow-layout', ...plan! });
    expect(planReflow(applied)).toBeNull();
  });

  it('settles a pile of thirty stacked elements in one pass', () => {
    // The board the feature targets: a producer dropping everything in one
    // spot. One press has to untangle it, so a second finds nothing.
    const ids = Array.from(
      { length: 30 },
      (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
    );
    const state = must(initialState(DOC), ...ids.map((id) => entity(id, 0, 0)));

    const plan = planReflow(state);
    expect(plan).not.toBeNull();
    const applied = must(state, { type: 'reflow-layout', ...plan! });
    expect(planReflow(applied)).toBeNull();
  });

  it('settles fractional coordinates in one pass', () => {
    // Dragging at a non-integer zoom leaves fractional positions; the
    // solver's one-pixel overshoot keeps the rounded result clear of the gap.
    const state = must(
      initialState(DOC),
      entity(A, 0.3, 0.7),
      entity(B, 40.6, 10.2),
      { type: 'create-connection', id: LINK, connectionType: 'interaction', from: [A], to: [B], title: 'authorise' },
    );
    const plan = planReflow(state);
    expect(plan).not.toBeNull();
    const applied = must(state, { type: 'reflow-layout', ...plan! });
    expect(planReflow(applied)).toBeNull();
  });

  it('gives a label room when its line crosses an expanded container boundary', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      { type: 'group-elements', id: GROUP, title: 'G', memberIds: [A], position: { x: 0, y: 0 } },
      { type: 'set-expanded', id: GROUP, expanded: true },
      entity(B, 320),
      {
        type: 'create-connection',
        id: LINK,
        connectionType: 'interaction',
        from: [A],
        to: [B],
        title: 'authorise payment',
      },
    );
    const plan = planReflow(state);
    expect(plan).not.toBeNull();

    const applied = must(state, { type: 'reflow-layout', ...plan! });
    const group = boxOf(applied, GROUP);
    const b = boxOf(applied, B);
    const containerRight = group.x + Math.max(group.expanded?.width ?? 0, 260);
    // 17 characters at 7.2px, plus the pill's 28px, plus 24px of clearance.
    expect(b.x - containerRight).toBeGreaterThanOrEqual(175);
  });

  it('keeps a card pinned inside an expanded container with its members', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      entity(B, 40, 10),
      { type: 'group-elements', id: GROUP, title: 'G', memberIds: [A, B], position: { x: 0, y: 0 } },
      { type: 'set-expanded', id: GROUP, expanded: true },
      { type: 'create-comment', id: CARD, text: 'why?', targets: [A] },
      { type: 'move-comment', id: CARD, position: { x: 10, y: 30 } },
    );
    const plan = planReflow(state);
    expect(plan).not.toBeNull();

    const applied = must(state, { type: 'reflow-layout', ...plan! });
    const group = boxOf(applied, GROUP);
    const card = boxOf(applied, CARD);
    const container = {
      right: group.x + (group.expanded?.width ?? 0),
      bottom: group.y + (group.expanded?.height ?? 0),
    };
    expect(card.x).toBeGreaterThanOrEqual(group.x);
    expect(card.y).toBeGreaterThanOrEqual(group.y);
    expect(card.x + card.width).toBeLessThanOrEqual(container.right);
    expect(card.y + card.height).toBeLessThanOrEqual(container.bottom);
  });
});
