import { useSyncExternalStore } from 'react';
import { isRendered, type AppState, type DomainEvent, type Id, type Point } from '@modl/core';
import { store } from '../store/store.js';

/**
 * Gravity-wave animation state. Purely presentational, so it lives in the app
 * beside the canvas rather than in the document or the trace: replaying a
 * trace re-triggers the same animations from the same events.
 *
 * The visual language and timing rules are recorded in
 * docs/decisions/010-gravity-wave-art-direction.md.
 */

/** Warp in/out duration. */
export const WARP_MS = 300;
/** Ripple duration, longer than the warp so the wave outlives the element. */
export const RIPPLE_MS = 500;

/** A bulk merge stops adding waves once a burst is already in flight. */
const MAX_ACTIVE_RIPPLES = 8;

export type RippleKind = 'outward' | 'inward';

export interface Ripple {
  /** Flow coordinates. */
  centre: Point;
  kind: RippleKind;
  /** performance.now() when the wave started. */
  start: number;
  /** Peak dot displacement, in flow pixels. */
  amplitude: number;
  /** How far from the centre the wave travels, in flow pixels. */
  reach: number;
  /** Peak strength of the light pulse riding the wavefront, 0..1. */
  intensity: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A deleted element kept on screen for the length of its warp-out. */
export interface Ghost {
  id: Id;
  rect: Rect;
}

let warping: ReadonlySet<Id> = new Set();
let ghosts: readonly Ghost[] = [];
const ripples: Ripple[] = [];
/** Monotonic count of waves ever started, the observable the tests assert on. */
let started = 0;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeAnimations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWarpingIds(): ReadonlySet<Id> {
  return useSyncExternalStore(subscribeAnimations, () => warping, () => warping);
}

export function useGhosts(): readonly Ghost[] {
  return useSyncExternalStore(subscribeAnimations, () => ghosts, () => ghosts);
}

export function motionReduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Drops finished waves, then returns what is still travelling. */
export function activeRipples(now: number): readonly Ripple[] {
  for (let i = ripples.length - 1; i >= 0; i -= 1) {
    if (now - ripples[i]!.start >= RIPPLE_MS) ripples.splice(i, 1);
  }
  return ripples;
}

export function ripplesStarted(): number {
  return started;
}

function startRipple(centre: Point, kind: RippleKind, size: 'press' | 'element'): void {
  if (motionReduced()) return;
  activeRipples(performance.now());
  if (ripples.length >= MAX_ACTIVE_RIPPLES) return;
  // A press is a tap on the field, an element is a mass arriving or leaving,
  // so the press wave is smaller, shorter-reaching, and dimmer.
  ripples.push({
    centre,
    kind,
    start: performance.now(),
    amplitude: size === 'press' ? 4 : 12,
    reach: size === 'press' ? 120 : 340,
    intensity: size === 'press' ? 0.7 : 1,
  });
  started += 1;
  emit();
}

/** A small wave under a lone canvas click: the spot is live, click again to create. */
export function pressRipple(centre: Point): void {
  startRipple(centre, 'outward', 'press');
}

/** The drawn box for an element, preferring the container box when expanded. */
function rectOf(state: AppState, id: Id): Rect | null {
  const layout = state.document.layout[id];
  if (!layout || !('x' in layout)) return null;
  if (state.expanded.includes(id) && layout.expanded) {
    return { x: layout.x, y: layout.y, width: layout.expanded.width, height: layout.expanded.height };
  }
  return { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
}

function warpIn(id: Id, after: AppState): void {
  const rect = rectOf(after, id);
  // A connection has no box of its own to warp.
  if (!rect) return;

  const next = new Set(warping);
  next.add(id);
  warping = next;
  emit();

  window.setTimeout(() => {
    const settled = new Set(warping);
    settled.delete(id);
    warping = settled;
    // The wave leaves the element only once the element has finished arriving.
    startRipple({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, 'outward', 'element');
    emit();
  }, WARP_MS);
}

function warpOut(id: Id, before: AppState): void {
  // A cascade can delete members hidden inside a collapsed group; ghosting
  // those would flash boxes that were never on screen.
  if (!isRendered(before.document.model.elements, id, new Set(before.expanded))) return;
  const rect = rectOf(before, id);
  if (!rect) return;

  ghosts = [...ghosts, { id, rect }];
  emit();

  window.setTimeout(() => {
    ghosts = ghosts.filter((ghost) => ghost.id !== id);
    // Inward: the field closes over the gap the element left.
    startRipple({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, 'inward', 'element');
    emit();
  }, WARP_MS);
}

function onDomainEvents(events: DomainEvent[], before: AppState, after: AppState): void {
  if (motionReduced()) return;
  // A whole document arriving is a scene change, not an edit to react to.
  if (events.some((event) => event.type === 'document-loaded')) return;

  for (const event of events) {
    if (event.type === 'element-created') warpIn(event.id, after);
    if (event.type === 'element-deleted') warpOut(event.id, before);
  }
}

let installed = false;

/** Connects animation triggers to the command bus. Idempotent. */
export function installAnimations(): void {
  if (installed) return;
  installed = true;
  store.subscribeEvents(onDomainEvents);
}
