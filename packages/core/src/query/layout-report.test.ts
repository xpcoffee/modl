import { describe, expect, it } from 'vitest';
import { autoLayout, inspectLayout } from './layout-report.js';
import { apply, applyAll } from '../commands/apply.js';
import { initialState } from '../state.js';
import type { AppState, Command } from '../commands/types.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const LINK = '44444444-4444-4444-8444-444444444444';
const GROUP = '66666666-6666-4666-8666-666666666666';

function must(state: AppState, ...commands: Command[]): AppState {
  const result = applyAll(state, commands);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.state;
}

function entity(id: string, x: number, y = 0): Command {
  return { type: 'create-entity', id, entityType: 'component', title: id, position: { x, y } };
}

function codes(report: ReturnType<typeof inspectLayout>): string[] {
  return report.issues.map((issue) => issue.code);
}

describe('inspectLayout', () => {
  it('reports nothing for a tidy board', () => {
    const state = must(initialState(DOC), entity(A, 0), entity(B, 400));
    const report = inspectLayout(state.document);
    expect(report.issues).toEqual([]);
    expect(report.entityCount).toBe(2);
  });

  it('reports overlapping entities', () => {
    const state = must(initialState(DOC), entity(A, 0), entity(B, 40));
    expect(codes(inspectLayout(state.document))).toContain('overlapping-entities');
  });

  it('ignores a container overlapping what it holds', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      { type: 'group-elements', id: GROUP, title: 'G', memberIds: [A], position: { x: 0, y: 0 } },
    );
    expect(codes(inspectLayout(state.document))).not.toContain('overlapping-entities');
  });

  it('reports a member drawn outside its container', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      { type: 'group-elements', id: GROUP, title: 'G', memberIds: [A], position: { x: 0, y: 0 } },
      { type: 'move-element', id: A, position: { x: 3000, y: 3000 } },
    );
    expect(codes(inspectLayout(state.document))).toContain('member-outside-container');
  });

  it('reports an entity stranded far from the rest', () => {
    const state = must(initialState(DOC), entity(A, 0), entity(B, 9000));
    expect(codes(inspectLayout(state.document))).toContain('stranded-entity');
  });

  it('reports a connection with both ends in one place', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      entity(B, 400),
      { type: 'create-connection', id: LINK, connectionType: 'interaction', from: [A], to: [B], title: '' },
      { type: 'move-element', id: B, position: { x: 0, y: 0 } },
    );
    expect(codes(inspectLayout(state.document))).toContain('zero-length-connection');
  });

  it('reports the bounding box of what is placed', () => {
    const state = must(initialState(DOC), entity(A, 0), entity(B, 400));
    expect(inspectLayout(state.document).bounds).toEqual({ x: 0, y: 0, width: 580, height: 72 });
  });

  it('returns no bounds for an empty document', () => {
    expect(inspectLayout(initialState(DOC).document).bounds).toBeNull();
  });

  it('reports an entity with no position', () => {
    const state = must(initialState(DOC), entity(A, 0));
    const stripped = { ...state.document, layout: {} };
    expect(codes(inspectLayout(stripped))).toContain('missing-position');
  });
});

describe('autoLayout', () => {
  it('places entities that have no position', () => {
    const state = must(initialState(DOC), entity(A, 0), entity(B, 400));
    const stripped = { ...state.document, layout: {} };
    const placed = autoLayout(stripped);

    expect(placed.layout[A]).toMatchObject({ x: 0, y: 0 });
    expect(placed.layout[B]).toMatchObject({ x: 280, y: 0 });
    expect(inspectLayout(placed).issues).toEqual([]);
  });

  it('leaves an existing position alone', () => {
    const state = must(initialState(DOC), entity(A, 700, 500), entity(B, 1400));
    const placed = autoLayout(state.document);
    expect(placed.layout[A]).toMatchObject({ x: 700, y: 500 });
  });

  it('places members inside their container', () => {
    const state = must(
      initialState(DOC),
      entity(A, 0),
      { type: 'group-elements', id: GROUP, title: 'G', memberIds: [A], position: { x: 0, y: 0 } },
    );
    const stripped = { ...state.document, layout: { [GROUP]: state.document.layout[GROUP]! } };
    const placed = autoLayout(stripped);
    const parent = placed.layout[GROUP] as { x: number; y: number };
    const child = placed.layout[A] as { x: number; y: number };

    expect(child.x).toBeGreaterThan(parent.x);
    expect(child.y).toBeGreaterThan(parent.y);
  });
});
