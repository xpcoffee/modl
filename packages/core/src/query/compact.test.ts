import { describe, expect, it } from 'vitest';
import { planCompact } from './compact.js';
import { applyAll } from '../commands/apply.js';
import { initialState } from '../state.js';
import type { AppState, Command } from '../commands/types.js';
import type { EntityLayout } from '../model/types.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const LINK = '44444444-4444-4444-8444-444444444444';
const GROUP = '66666666-6666-4666-8666-666666666666';
const CARD = '77777777-7777-4777-8777-777777777777';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

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

function ids(count: number, stamp: string): string[] {
  return Array.from(
    { length: count },
    (_, i) => `${String(i).padStart(8, '0')}-${stamp}-4${stamp.slice(1)}-8${stamp.slice(1)}-${stamp.repeat(3)}`,
  );
}

describe('planCompact', () => {
  it('returns null for an empty document', () => {
    expect(planCompact(initialState(DOC))).toBeNull();
  });

  it('returns null for a single placed entity', () => {
    const state = must(initialState(DOC), entity(A, 120, 80));
    expect(planCompact(state)).toBeNull();
  });

  it('packs a pile into rows with reflow\'s gaps and no overlaps', () => {
    const pile = ids(9, '1111');
    const state = must(initialState(DOC), ...pile.map((id) => entity(id, 0, 0)));
    const plan = planCompact(state);
    expect(plan).not.toBeNull();

    const applied = must(state, { type: 'reflow-layout', ...plan! });
    const boxes = pile.map((id) => boxOf(applied, id));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(overlap(boxes[i]!, boxes[j]!)).toBe(false);
      }
    }
    // Nine 180x72 boxes wrap into rows rather than one strip: the block stays
    // narrower than four boxes and their gaps laid end to end.
    const width =
      Math.max(...boxes.map((box) => box.x + box.width)) - Math.min(...boxes.map((box) => box.x));
    const height =
      Math.max(...boxes.map((box) => box.y + box.height)) - Math.min(...boxes.map((box) => box.y));
    expect(width).toBeLessThan(4 * (180 + 64));
    expect(height).toBeGreaterThan(72);
  });

  it('ignores label width: connected boxes pack one gap apart', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      entity(B, 0, 0),
      {
        type: 'create-connection',
        id: LINK,
        connectionType: 'interaction',
        from: [A],
        to: [B],
        title: 'a very long connection title that reflow would demand a huge gap for',
      },
    );
    const plan = planCompact(state);
    expect(plan).not.toBeNull();

    // Two 180x72 boxes pack into a two-row block (the width bound keeps the
    // block near screen shape), one plain vertical gap apart: the label that
    // would force reflow to hold them ~500px apart plays no part.
    const applied = must(state, { type: 'reflow-layout', ...plan! });
    const a = boxOf(applied, A);
    const b = boxOf(applied, B);
    expect(b.x).toBe(a.x);
    expect(b.y - (a.y + a.height)).toBe(48);
  });

  it('keeps the packed block anchored where the content started', () => {
    const state = must(initialState(DOC), entity(A, 100, 50), entity(B, 100, 50));
    const plan = planCompact(state);
    expect(plan).not.toBeNull();

    const applied = must(state, { type: 'reflow-layout', ...plan! });
    const boxes = [boxOf(applied, A), boxOf(applied, B)];
    expect(Math.min(...boxes.map((box) => box.x))).toBe(100);
    expect(Math.min(...boxes.map((box) => box.y))).toBe(50);
  });

  it('packs members inside their container and shrinks it to fit', () => {
    // Two members flung far apart in a container sized around them: reflow
    // would leave the oversized box alone, compact reclaims the room.
    const state = must(
      initialState(DOC),
      entity(A, 0),
      entity(B, 1600, 900),
      {
        type: 'group-elements',
        id: GROUP,
        title: 'G',
        memberIds: [A, B],
        position: { x: 0, y: 0 },
      },
      { type: 'set-expanded', id: GROUP, expanded: true },
    );
    const before = boxOf(state, GROUP).expanded!;
    const plan = planCompact(state);
    expect(plan).not.toBeNull();

    const applied = must(state, { type: 'reflow-layout', ...plan! });
    const group = boxOf(applied, GROUP);
    const grown = group.expanded!;
    expect(grown.width * grown.height).toBeLessThan(before.width * before.height);
    for (const id of [A, B]) {
      const member = boxOf(applied, id);
      expect(member.x).toBeGreaterThanOrEqual(group.x);
      expect(member.y).toBeGreaterThanOrEqual(group.y);
      expect(member.x + member.width).toBeLessThanOrEqual(group.x + grown.width);
      expect(member.y + member.height).toBeLessThanOrEqual(group.y + grown.height);
    }
  });

  it('packs an expanded container as one box in the scope above', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      entity(B, 200),
      {
        type: 'group-elements',
        id: GROUP,
        title: 'G',
        memberIds: [A, B],
        position: { x: 0, y: 0 },
      },
      { type: 'set-expanded', id: GROUP, expanded: true },
      entity(C, 0, 0),
    );
    const plan = planCompact(state);
    expect(plan).not.toBeNull();

    const applied = must(state, { type: 'reflow-layout', ...plan! });
    const group = boxOf(applied, GROUP);
    const container = { ...group, width: group.expanded!.width, height: group.expanded!.height };
    expect(overlap(container, boxOf(applied, C))).toBe(false);
  });

  it('carries a collapsed group\'s members with it', () => {
    const state = must(
      initialState(DOC),
      entity(A, 10, 10),
      { type: 'group-elements', id: GROUP, title: 'G', memberIds: [A], position: { x: 0, y: 0 } },
      entity(B, 0, 0),
    );
    const plan = planCompact(state);
    expect(plan).not.toBeNull();

    const applied = must(state, { type: 'reflow-layout', ...plan! });
    const groupDelta = {
      x: boxOf(applied, GROUP).x - boxOf(state, GROUP).x,
      y: boxOf(applied, GROUP).y - boxOf(state, GROUP).y,
    };
    expect(boxOf(applied, A).x - boxOf(state, A).x).toBe(groupDelta.x);
    expect(boxOf(applied, A).y - boxOf(state, A).y).toBe(groupDelta.y);
  });

  it('packs a pinned card with the scope that holds it', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      entity(B, 40, 10),
      { type: 'group-elements', id: GROUP, title: 'G', memberIds: [A, B], position: { x: 0, y: 0 } },
      { type: 'set-expanded', id: GROUP, expanded: true },
      { type: 'create-comment', id: CARD, text: 'why?', targets: [A] },
      { type: 'move-comment', id: CARD, position: { x: 10, y: 30 } },
    );
    const plan = planCompact(state);
    expect(plan).not.toBeNull();

    const applied = must(state, { type: 'reflow-layout', ...plan! });
    const group = boxOf(applied, GROUP);
    const card = boxOf(applied, CARD);
    expect(card.x).toBeGreaterThanOrEqual(group.x);
    expect(card.y).toBeGreaterThanOrEqual(group.y);
    expect(card.x + card.width).toBeLessThanOrEqual(group.x + group.expanded!.width);
    expect(card.y + card.height).toBeLessThanOrEqual(group.y + group.expanded!.height);
  });

  it('translates a connection\'s bends by the average of its endpoint moves', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      entity(B, 0, 200),
      { type: 'create-connection', id: LINK, connectionType: 'interaction', from: [A], to: [B], title: '' },
      { type: 'set-waypoints', id: LINK, waypoints: [{ x: 100, y: 100 }] },
    );
    const plan = planCompact(state);
    expect(plan).not.toBeNull();

    const applied = must(state, { type: 'reflow-layout', ...plan! });
    const deltas = [A, B].map((id) => ({
      x: boxOf(applied, id).x - boxOf(state, id).x,
      y: boxOf(applied, id).y - boxOf(state, id).y,
    }));
    const average = {
      x: Math.round((deltas[0]!.x + deltas[1]!.x) / 2),
      y: Math.round((deltas[0]!.y + deltas[1]!.y) / 2),
    };
    expect(plan!.waypoints[LINK]).toEqual([{ x: 100 + average.x, y: 100 + average.y }]);
  });

  it('is a fixed point: compacting the result changes nothing', () => {
    const pile = ids(12, '3333');
    const state = must(
      initialState(DOC),
      ...pile.map((id, i) => entity(id, (i % 5) * 30, Math.floor(i / 5) * 20)),
      { type: 'group-elements', id: GROUP, title: 'G', memberIds: pile.slice(0, 4), position: { x: 0, y: 0 } },
      { type: 'set-expanded', id: GROUP, expanded: true },
    );
    const plan = planCompact(state);
    expect(plan).not.toBeNull();

    const applied = must(state, { type: 'reflow-layout', ...plan! });
    expect(planCompact(applied)).toBeNull();
  });
});
