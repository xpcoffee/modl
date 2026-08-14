import { describe, expect, it } from 'vitest';
import {
  CARD_SPAWN_MARGIN,
  cardInView,
  cardPinAt,
  clampCardIntoView,
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
});
