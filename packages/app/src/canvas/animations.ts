import { useSyncExternalStore } from 'react';
import {
  boardEmphasis,
  isRendered,
  type AppState,
  type DomainEvent,
  type ElementStyle,
  type Id,
  type Point,
} from '@modl/core';
import { motionReduced, subscribeMotion } from '../preferences/motion.js';
import { store } from '../store/store.js';

/**
 * Gravity-wave animation state. Purely presentational, so it lives in the app
 * beside the canvas rather than in the document or the trace: replaying a
 * trace re-triggers the same animations from the same events.
 *
 * The visual language and timing rules are recorded in
 * docs/decisions/010-gravity-wave-art-direction.md.
 */

/**
 * Warp durations. Each pairs with a keyframe of the same length in
 * styles.css (warp-in, warp-out): these timers decide when the ripple starts
 * and when a ghost leaves, the keyframes draw the warp itself.
 */
export const WARP_IN_MS = 300;
export const WARP_OUT_MS = 200;
/** Ripple duration. The wave still starts only once the warp has finished. */
export const RIPPLE_MS = 300;
/** How long a reflow glide takes, matching the camera's own settles. */
export const GLIDE_MS = 300;

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
  /** The element's fill and stroke, so the exit keeps its colours. */
  style?: ElementStyle;
  /** True when the element drew muted, so the exit keeps that opacity too. */
  dimmed: boolean;
}

let warping: ReadonlySet<Id> = new Set();
let ghosts: readonly Ghost[] = [];
const ripples: Ripple[] = [];
/** Monotonic count of waves ever started, the observable the tests assert on. */
let started = 0;
/**
 * A glide waiting for the canvas. A reflow teleports elements, and a glide
 * from the old positions to the new is what lets the eye keep track of which
 * box went where; an ordinary move already ends where the pointer is, so
 * only `layout-reflowed` raises this. The canvas owns the node positions
 * React Flow draws, so it claims the flag as it syncs to fresh geometry.
 */
let glidePending = false;
/** Monotonic count of glides ever started, stamped on the canvas for tests. */
let glidesStarted = 0;

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

export function useGlidesStarted(): number {
  return useSyncExternalStore(
    subscribeAnimations,
    () => glidesStarted,
    () => glidesStarted,
  );
}

/** Claims the pending glide. True means the sync it precedes should animate. */
export function takeGlide(): boolean {
  const take = glidePending;
  glidePending = false;
  return take;
}

interface WaveShape {
  amplitude: number;
  reach: number;
  intensity: number;
}

/** A tap on the field: smaller, shorter-reaching, and dimmer than a mass. */
const PRESS_WAVE: WaveShape = { amplitude: 4, reach: 120, intensity: 0.7 };
/** A mass arriving: local, reaching about one element-width past its edge. */
const CREATION_WAVE: WaveShape = { amplitude: 12, reach: 180, intensity: 1 };

/** A mass leaving: the wave starts on the shape's boundary and collapses inward. */
function deletionWave(rect: Rect): WaveShape {
  return {
    amplitude: 12,
    // The half-diagonal puts the starting wavefront on the rectangle's edge;
    // the floor keeps the wave wider than one wavefront for the smallest nodes.
    reach: Math.max(60, Math.hypot(rect.width, rect.height) / 2),
    intensity: 1,
  };
}

function startRipple(centre: Point, kind: RippleKind, wave: WaveShape): void {
  if (motionReduced()) return;
  activeRipples(performance.now());
  if (ripples.length >= MAX_ACTIVE_RIPPLES) return;
  ripples.push({ centre, kind, start: performance.now(), ...wave });
  started += 1;
  emit();
}

/** A small wave under a lone canvas click: the spot is live, click again to create. */
export function pressRipple(centre: Point): void {
  startRipple(centre, 'outward', PRESS_WAVE);
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
    // The wave leaves the element only once it has finished arriving, and
    // only for a solid element: an expanded container is an outline around
    // its members, not a mass. The toolbar expands a new group in the
    // dispatch after creating it, so eligibility is read here rather than at
    // creation time.
    const state = store.getState();
    if (state.document.model.elements[id] && !state.expanded.includes(id)) {
      startRipple(
        { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        'outward',
        CREATION_WAVE,
      );
    }
    emit();
  }, WARP_IN_MS);
}

function warpOut(id: Id, before: AppState): void {
  // A cascade can delete members hidden inside a collapsed group; ghosting
  // those would flash boxes that were never on screen.
  if (!isRendered(before.document.model.elements, id, new Set(before.expanded))) return;
  // An expanded container is an outline around its members, not a mass: no
  // ghost (a solid box where an outline stood) and no wave. Its members are
  // re-parented rather than deleted, so nothing else animates either.
  if (before.expanded.includes(id)) return;
  const rect = rectOf(before, id);
  if (!rect) return;

  const style = before.document.model.elements[id]?.style;
  const dimmed = boardEmphasis(before).muted.has(id);
  ghosts = [...ghosts, { id, rect, dimmed, ...(style === undefined ? {} : { style }) }];
  emit();

  window.setTimeout(() => {
    ghosts = ghosts.filter((ghost) => ghost.id !== id);
    // Inward, starting on the shape's own edge: the field closes over the gap.
    startRipple(
      { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      'inward',
      deletionWave(rect),
    );
    emit();
  }, WARP_OUT_MS);
}

function onDomainEvents(events: DomainEvent[], before: AppState, after: AppState): void {
  if (motionReduced()) return;
  // A whole document arriving is a scene change, not an edit to react to.
  if (events.some((event) => event.type === 'document-loaded')) return;

  for (const event of events) {
    if (event.type === 'element-created') warpIn(event.id, after);
    if (event.type === 'element-deleted') warpOut(event.id, before);
  }

  // The focus overlay repositions the visible elements the way a reflow
  // does, so the same glide carries them: on the mode's toggle, and on a
  // filter change while the mode runs.
  const focusMoved =
    events.some((event) => event.type === 'focus-mode-changed') ||
    (after.focusMode && events.some((event) => event.type === 'filter-changed'));
  if (events.some((event) => event.type === 'layout-reflowed') || focusMoved) {
    glidePending = true;
    glidesStarted += 1;
    emit();
  }
}

/**
 * Turning motion off mid-wave stops it there rather than letting the last
 * one play out: the reader asked for stillness now, not shortly.
 */
function onMotionChanged(): void {
  if (!motionReduced()) return;
  ripples.length = 0;
  warping = new Set();
  ghosts = [];
  glidePending = false;
  emit();
}

let installed = false;

/** Connects animation triggers to the command bus. Idempotent. */
export function installAnimations(): void {
  if (installed) return;
  installed = true;
  store.subscribeEvents(onDomainEvents);
  subscribeMotion(onMotionChanged);
}
