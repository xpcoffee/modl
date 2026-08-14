import type { Point } from '../model/types.js';

/**
 * Where a freshly created comment or note card opens (issue #93). A card
 * without a pin derives its place from its targets' centroid, and on an
 * element larger than the screen that centroid sits outside the viewport,
 * so the editor would open where the writer cannot see it. These decide
 * when a new card needs a pin and where the pin goes.
 */

/** A rectangle in flow coordinates: the viewport, or a card's box. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

/** Gap kept between a spawned card and the viewport's edge. */
export const CARD_SPAWN_MARGIN = 16;

/** Where a card pins for a pointer at `at`: centred, hanging just under it. */
export function cardPinAt(at: Point, size: Size): Point {
  return { x: at.x - size.width / 2, y: at.y - 12 };
}

/** Whether a card with its top-left corner at `at` sits wholly inside `view`. */
export function cardInView(at: Point, size: Size, view: Rect): boolean {
  return (
    at.x >= view.x &&
    at.y >= view.y &&
    at.x + size.width <= view.x + view.width &&
    at.y + size.height <= view.y + view.height
  );
}

/**
 * The nearest place inside `view` where the whole card fits, `margin` off the
 * edges. A view too small for the card anchors it top-left, keeping the
 * header and the start of the text readable.
 */
export function clampCardIntoView(
  at: Point,
  size: Size,
  view: Rect,
  margin = CARD_SPAWN_MARGIN,
): Point {
  const clamp = (value: number, low: number, high: number): number =>
    Math.min(Math.max(value, low), Math.max(low, high));
  return {
    x: clamp(at.x, view.x + margin, view.x + view.width - size.width - margin),
    y: clamp(at.y, view.y + margin, view.y + view.height - size.height - margin),
  };
}

/**
 * The pin a freshly created card needs so its editor opens on screen: null
 * when the derived place is already in view, keeping the card unpinned so it
 * follows its targets. Otherwise the card pins under the cursor when the
 * action came from a pointer, or at the derived place clamped into view; a
 * card with neither opens at the viewport's centre.
 */
export function spawnCardPin(
  derived: Point | null,
  size: Size,
  view: Rect,
  cursor?: Point,
): Point | null {
  if (derived !== null && cardInView(derived, size, view)) return null;
  const wanted =
    cursor !== undefined
      ? cardPinAt(cursor, size)
      : (derived ??
        cardPinAt({ x: view.x + view.width / 2, y: view.y + view.height / 2 }, size));
  return clampCardIntoView(wanted, size, view);
}
