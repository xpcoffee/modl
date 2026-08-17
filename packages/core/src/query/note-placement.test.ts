import { beforeEach, describe, expect, it } from 'vitest';
import { applyAll } from '../commands/apply.js';
import type { AppState, Command } from '../commands/types.js';
import { NOTE_CARD_SIZE, isEntityLayout } from '../model/types.js';
import { initialState } from '../state.js';
import { focusHiddenIds } from './view.js';
import { focusLayoutState } from './focus.js';
import { noteCardPlacements } from './note-placement.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const UI = '11111111-1111-4111-8111-111111111111';
const GATEWAY = '22222222-2222-4222-8222-222222222222';
const LEDGER = '33333333-3333-4333-8333-333333333333';
const NOTE = '55555555-5555-4555-8555-555555555555';
const NOTE2 = '66666666-6666-4666-8666-666666666666';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function entity(id: string, title: string, x = 0, y = 0): Command {
  return { type: 'create-entity', id, entityType: 'component', title, position: { x, y } };
}

function note(id: string, targets: string[]): Command {
  return { type: 'create-note', id, text: 'context', targets };
}

function must(state: AppState, ...commands: Command[]): AppState {
  const result = applyAll(state, commands);
  if (!result.ok) throw new Error(`unexpected rejection: ${JSON.stringify(result.error)}`);
  return result.state;
}

/** The boxes the board draws for a state's elements, as placement sees them. */
function elementBoxes(state: AppState): Rect[] {
  return Object.entries(state.document.layout)
    .filter(([id]) => state.document.model.elements[id])
    .map(([, entry]) => entry)
    .filter(isEntityLayout)
    .map((entry) => ({ x: entry.x, y: entry.y, width: entry.width, height: entry.height }));
}

/** Three components spread far apart; two carry team=payments. */
let base: AppState;

beforeEach(() => {
  base = must(
    initialState(DOC),
    entity(UI, 'Checkout UI', 0, 0),
    entity(GATEWAY, 'Gateway', 1000, 0),
    entity(LEDGER, 'Ledger', 2000, 600),
    { type: 'set-tag', id: GATEWAY, key: 'team', values: ['payments'] },
    { type: 'set-tag', id: LEDGER, key: 'team', values: ['payments'] },
  );
});

describe('noteCardPlacements', () => {
  it('hangs an unpinned card above its target, centred on it', () => {
    const state = must(base, note(NOTE, [UI]));
    // The UI's 180x72 box centres at (90, 36); the card hangs 48 above it.
    expect(noteCardPlacements(state).get(NOTE)).toEqual({ x: -30, y: -100 });
  });

  it('derives a multi-target card from its targets\' centroid', () => {
    const state = must(base, note(NOTE, [UI, GATEWAY]));
    // Centres (90, 36) and (1090, 36) give the centroid (590, 36).
    expect(noteCardPlacements(state).get(NOTE)).toEqual({ x: 470, y: -100 });
  });

  it('keeps a pin while the board draws its saved geometry', () => {
    const state = must(
      base,
      note(NOTE, [UI]),
      { type: 'move-note', id: NOTE, position: { x: 400, y: 300 } },
    );
    expect(noteCardPlacements(state).get(NOTE)).toEqual({ x: 400, y: 300 });
  });

  it('rises a card clear of the element standing where it wants to hang', () => {
    const state = must(
      initialState(DOC),
      entity(UI, 'Checkout UI', 0, 200),
      entity(GATEWAY, 'Gateway', 0, 60),
      note(NOTE, [UI]),
    );
    const at = noteCardPlacements(state).get(NOTE)!;
    // The spot above the UI sits on the Gateway, so the card rises past it.
    expect(at).toEqual({ x: -30, y: -44 });
    for (const box of elementBoxes(state)) {
      expect(overlap({ ...at, ...NOTE_CARD_SIZE }, box)).toBe(false);
    }
  });

  it('rises two cards on one element apart from each other', () => {
    const state = must(base, note(NOTE, [UI]), note(NOTE2, [UI]));
    const placements = noteCardPlacements(state);
    const first = { ...placements.get(NOTE)!, ...NOTE_CARD_SIZE };
    const second = { ...placements.get(NOTE2)!, ...NOTE_CARD_SIZE };
    expect(overlap(first, second)).toBe(false);
  });

  it('stacks a document-level card above the content', () => {
    const state = must(base, note(NOTE, []));
    // Above the board's top-left corner, apart from the elements.
    expect(noteCardPlacements(state).get(NOTE)).toEqual({ x: 0, y: -148 });
  });

  it('re-derives every card clear of the packed board under the focus overlay', () => {
    const state = must(
      base,
      note(NOTE, [LEDGER]),
      // Pinned where the pack is about to put the matching elements.
      { type: 'move-note', id: NOTE, position: { x: 1050, y: 60 } },
      { type: 'set-focus-mode', enabled: true },
      { type: 'set-filter', expression: 'team=payments' },
    );
    const shown = focusLayoutState(state);
    expect(shown).not.toBe(state);

    const placements = noteCardPlacements(state);
    const at = placements.get(NOTE)!;
    // The pin no longer describes the board, so the card leaves it.
    expect(at).not.toEqual({ x: 1050, y: 60 });

    const removed = focusHiddenIds(state);
    const packed = Object.entries(shown.document.layout)
      .filter(([id]) => shown.document.model.elements[id] && !removed.has(id))
      .map(([, entry]) => entry)
      .filter(isEntityLayout)
      .map((entry) => ({ x: entry.x, y: entry.y, width: entry.width, height: entry.height }));
    expect(packed.length).toBeGreaterThan(0);
    for (const box of packed) {
      expect(overlap({ ...at, ...NOTE_CARD_SIZE }, box)).toBe(false);
    }
    // A transient view: the saved pin is untouched.
    expect(state.document.layout[NOTE]).toMatchObject({ x: 1050, y: 60 });
  });

  it('gives a card focus mode removed no placement at all', () => {
    const state = must(
      base,
      note(NOTE, [UI]),
      { type: 'set-focus-mode', enabled: true },
      { type: 'set-filter', expression: 'team=payments' },
    );
    expect(noteCardPlacements(state).has(NOTE)).toBe(false);
  });
});
