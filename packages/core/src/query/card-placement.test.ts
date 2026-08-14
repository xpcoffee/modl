import { describe, expect, it } from 'vitest';
import { applyAll, MIN_GROUP_SIZE } from '../commands/apply.js';
import type { AppState, Command } from '../commands/types.js';
import { initialState } from '../state.js';
import {
  CARD_SPAWN_MARGIN,
  cardInView,
  cardPinAt,
  clampCardIntoView,
  renderedCentre,
  spawnCardPin,
} from './card-placement.js';

const SIZE = { width: 240, height: 88 };
const VIEW = { x: 0, y: 0, width: 1280, height: 720 };

describe('cardInView', () => {
  it('accepts a card wholly inside the view', () => {
    expect(cardInView({ x: 100, y: 100 }, SIZE, VIEW)).toBe(true);
  });

  it('rejects a card poking past any edge', () => {
    expect(cardInView({ x: -1, y: 100 }, SIZE, VIEW)).toBe(false);
    expect(cardInView({ x: 100, y: -1 }, SIZE, VIEW)).toBe(false);
    expect(cardInView({ x: 1280 - SIZE.width + 1, y: 100 }, SIZE, VIEW)).toBe(false);
    expect(cardInView({ x: 100, y: 720 - SIZE.height + 1 }, SIZE, VIEW)).toBe(false);
  });

  it('judges against the view offset, not the origin', () => {
    const panned = { x: 2000, y: 500, width: 1280, height: 720 };
    expect(cardInView({ x: 100, y: 100 }, SIZE, panned)).toBe(false);
    expect(cardInView({ x: 2100, y: 600 }, SIZE, panned)).toBe(true);
  });
});

describe('clampCardIntoView', () => {
  it('leaves a card already inside the margins alone', () => {
    expect(clampCardIntoView({ x: 100, y: 100 }, SIZE, VIEW)).toEqual({ x: 100, y: 100 });
  });

  it('pulls an off-view card to the nearest edge, margin off it', () => {
    expect(clampCardIntoView({ x: 5000, y: -300 }, SIZE, VIEW)).toEqual({
      x: 1280 - SIZE.width - CARD_SPAWN_MARGIN,
      y: CARD_SPAWN_MARGIN,
    });
  });

  it('anchors top-left when the view is smaller than the card', () => {
    const tiny = { x: 40, y: 40, width: 100, height: 50 };
    expect(clampCardIntoView({ x: 900, y: 900 }, SIZE, tiny)).toEqual({
      x: 40 + CARD_SPAWN_MARGIN,
      y: 40 + CARD_SPAWN_MARGIN,
    });
  });
});

describe('spawnCardPin', () => {
  it('returns null when the derived place is in view, so the card stays unpinned', () => {
    expect(spawnCardPin({ x: 400, y: 300 }, SIZE, VIEW)).toBeNull();
  });

  it('pins under the cursor when the derived place is off view', () => {
    const pin = spawnCardPin({ x: 5000, y: 300 }, SIZE, VIEW, { x: 600, y: 200 });
    expect(pin).toEqual(cardPinAt({ x: 600, y: 200 }, SIZE));
  });

  it('clamps a cursor pin so the card still fits the view', () => {
    const pin = spawnCardPin({ x: 5000, y: 300 }, SIZE, VIEW, { x: 1270, y: 710 });
    expect(pin).toEqual({
      x: 1280 - SIZE.width - CARD_SPAWN_MARGIN,
      y: 720 - SIZE.height - CARD_SPAWN_MARGIN,
    });
  });

  it('clamps the derived place into view when there is no cursor', () => {
    const pin = spawnCardPin({ x: 5000, y: 300 }, SIZE, VIEW);
    expect(pin).toEqual({ x: 1280 - SIZE.width - CARD_SPAWN_MARGIN, y: 300 });
  });

  it('opens at the view centre with neither a derived place nor a cursor', () => {
    const pin = spawnCardPin(null, SIZE, VIEW);
    expect(pin).toEqual(cardPinAt({ x: 640, y: 360 }, SIZE));
  });

  it('pins when the anchor is in view but the card below it is not', () => {
    // The anchor centre sits just above the bottom edge; the card, hanging
    // 48 below it, does not fit, so the whole card rect is what decides.
    const centroid = { x: 640, y: 700 };
    const derived = { x: centroid.x - SIZE.width / 2, y: centroid.y + 48 };
    expect(spawnCardPin(derived, SIZE, VIEW)).not.toBeNull();
  });
});

describe('renderedCentre', () => {
  const DOC = '00000000-0000-4000-8000-000000000000';
  const NEAR = '11111111-1111-4111-8111-111111111111';
  const FAR = '22222222-2222-4222-8222-222222222222';
  const GROUP = '33333333-3333-4333-8333-333333333333';
  const LINK = '44444444-4444-4444-8444-444444444444';

  function must(state: AppState, ...commands: Command[]): AppState {
    const result = applyAll(state, commands);
    if (!result.ok) throw new Error(`unexpected rejection: ${JSON.stringify(result.error)}`);
    return result.state;
  }

  /** Two members far apart inside one group, so the group's drawn box is large. */
  function grouped(): AppState {
    return must(
      initialState(DOC),
      { type: 'create-entity', id: NEAR, entityType: 'component', title: 'Near', position: { x: 300, y: 200 } },
      { type: 'create-entity', id: FAR, entityType: 'component', title: 'Far', position: { x: 2800, y: 1700 } },
      { type: 'group-elements', id: GROUP, title: 'Sprawl', memberIds: [NEAR, FAR], position: { x: 300, y: 200 } },
    );
  }

  it('uses an entity layout box as it stands', () => {
    const state = grouped();
    const entry = state.document.layout[NEAR] as { x: number; y: number; width: number; height: number };
    expect(renderedCentre(state, NEAR)).toEqual({
      x: entry.x + entry.width / 2,
      y: entry.y + entry.height / 2,
    });
  });

  it('uses the collapsed box for a group that is not expanded', () => {
    const state = grouped();
    const entry = state.document.layout[GROUP] as { x: number; y: number; width: number; height: number };
    expect(renderedCentre(state, GROUP)).toEqual({
      x: entry.x + entry.width / 2,
      y: entry.y + entry.height / 2,
    });
  });

  it('uses the expanded box for an expanded group (issue #93 review)', () => {
    const state = must(grouped(), { type: 'set-expanded', id: GROUP, expanded: true });
    const entry = state.document.layout[GROUP] as {
      x: number;
      y: number;
      expanded: { width: number; height: number };
    };
    const centre = renderedCentre(state, GROUP)!;
    expect(centre).toEqual({
      x: entry.x + entry.expanded.width / 2,
      y: entry.y + entry.expanded.height / 2,
    });
    // The drawn centre is far from the collapsed box's, which is the gap
    // that put a fresh card off screen.
    expect(centre.y).toBeGreaterThan(500);
  });

  it('falls back to the minimum group size for an expanded entry without one', () => {
    const state = must(grouped(), { type: 'set-expanded', id: NEAR, expanded: true });
    const entry = state.document.layout[NEAR] as { x: number; y: number };
    expect(renderedCentre(state, NEAR)).toEqual({
      x: entry.x + MIN_GROUP_SIZE.width / 2,
      y: entry.y + MIN_GROUP_SIZE.height / 2,
    });
  });

  it('stands a connection in at the midpoint of its endpoint centres', () => {
    const state = must(
      grouped(),
      { type: 'create-connection', id: LINK, connectionType: 'interaction', from: [NEAR], to: [FAR], title: '' },
    );
    const near = renderedCentre(state, NEAR)!;
    const far = renderedCentre(state, FAR)!;
    expect(renderedCentre(state, LINK)).toEqual({
      x: (near.x + far.x) / 2,
      y: (near.y + far.y) / 2,
    });
  });

  it('prefers what the renderer says it is drawing', () => {
    const state = grouped();
    const drawn = (id: string) => (id === NEAR ? { x: 9, y: 9 } : undefined);
    expect(renderedCentre(state, NEAR, drawn)).toEqual({ x: 9, y: 9 });
  });
});
