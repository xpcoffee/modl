import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { isConnection, isRendered, type AppState, type Id } from '@modl/core';
import { matchesKey } from '../preferences/keybindings.js';
import { store } from '../store/store.js';

/**
 * Keyboard focus for the board and the selection menus (issue #68,
 * docs/decisions/025-menu-focus.md).
 *
 * Tab moves real DOM focus rather than a synthetic cursor, so the browser's
 * focus ring and a screen reader's own cursor follow along. While something
 * is selected, Tab cycles a ring over the selection's top-level menus; Enter
 * enters the focused menu and the cancel binding steps back out. With
 * nothing selected, Tab walks the board's elements as a soft focus, and
 * Enter dispatches the selection. Focus is presentation state: nothing here
 * reaches the document or the trace.
 */

export type RingSlot = 'expansion' | 'panel' | 'relations';

/** Left roller, bottom panel, right roller: the order they sit around the selection. */
const RING_ORDER: RingSlot[] = ['expansion', 'panel', 'relations'];

interface Stop {
  /** The menu's whole box, for judging whether focus already sits in it. */
  frame: HTMLElement;
  /** What the ring focuses when it lands on this menu. */
  target: HTMLElement;
}

const stops = new Map<RingSlot, Stop>();

function registerStop(slot: RingSlot, stop: Stop): () => void {
  stops.set(slot, stop);
  return () => {
    if (stops.get(slot) === stop) stops.delete(slot);
  };
}

/** Holds a menu's box and focus target in a ring slot while it is mounted. */
export function useRingStop(
  slot: RingSlot | undefined,
  frame: { current: HTMLElement | null },
  target: { current: HTMLElement | null },
  mounted: boolean,
): void {
  useEffect(() => {
    if (slot === undefined || !mounted) return;
    const frameEl = frame.current;
    const targetEl = target.current ?? frameEl;
    if (frameEl === null || targetEl === null) return;
    return registerStop(slot, { frame: frameEl, target: targetEl });
  }, [slot, mounted, frame, target]);
}

/**
 * The selection panel as a ring stop. The wrapper is focusable so the ring
 * can land on it, Enter (handled by the cycle below) moves inside, and the
 * cancel binding steps focus back out one level per press. Spread onto the
 * panel's root element.
 */
export function usePanelStop(): {
  ref: (el: HTMLElement | null) => void;
  tabIndex: number;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
} {
  const frame = useRef<HTMLElement | null>(null);
  const unregister = useRef<(() => void) | null>(null);

  const ref = useCallback((el: HTMLElement | null) => {
    unregister.current?.();
    unregister.current = null;
    frame.current = el;
    if (el !== null) unregister.current = registerStop('panel', { frame: el, target: el });
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (matchesKey('cancel', event)) {
      // At the top level the press bubbles on to the cancel handler that
      // deselects (Canvas); anywhere deeper it steps focus back to the panel.
      if (event.target === frame.current) return;
      event.stopPropagation();
      // A control that already spent this press (a tag draft abandoning
      // itself) keeps its own level; the next press leaves the panel.
      if (event.defaultPrevented) return;
      event.preventDefault();
      frame.current?.focus({ preventScroll: true });
      return;
    }
    // Other keys stop here so Delete edits text rather than removing the element.
    event.stopPropagation();
  }, []);

  return { ref, tabIndex: -1, onKeyDown };
}

function orderedStops(): Stop[] {
  return RING_ORDER.flatMap((slot) => {
    const stop = stops.get(slot);
    return stop !== undefined && stop.frame.isConnected ? [stop] : [];
  });
}

function cycleRing(active: Element | null, backwards: boolean): boolean {
  const ring = orderedStops();
  if (ring.length === 0) return false;
  const at = ring.findIndex((stop) => active !== null && stop.frame.contains(active));
  const next =
    at === -1
      ? backwards
        ? ring.length - 1
        : 0
      : (at + (backwards ? -1 : 1) + ring.length) % ring.length;
  ring[next]!.target.focus({ preventScroll: true });
  return true;
}

/**
 * The soft-focus cycle order: every rendered non-connection element, top to
 * bottom then left to right by layout origin (reading order), with ids
 * breaking ties so the walk is stable.
 */
function boardOrder(state: AppState): Id[] {
  const elements = state.document.model.elements;
  const expanded = new Set(state.expanded);
  const at = (id: Id): { x: number; y: number } => {
    const entry = state.document.layout[id];
    return entry !== undefined && 'x' in entry ? entry : { x: 0, y: 0 };
  };
  return Object.values(elements)
    .filter((element) => !isConnection(element) && isRendered(elements, element.id, expanded))
    .map((element) => element.id)
    .sort((a, b) => at(a).y - at(b).y || at(a).x - at(b).x || a.localeCompare(b));
}

function nodeElement(id: Id): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
}

function cycleSoftFocus(active: Element | null, backwards: boolean): boolean {
  const order = boardOrder(store.getState());
  if (order.length === 0) return false;
  const current = active?.closest<HTMLElement>('.react-flow__node')?.dataset['id'];
  const at = current === undefined ? -1 : order.indexOf(current);
  const next =
    at === -1
      ? backwards
        ? order.length - 1
        : 0
      : (at + (backwards ? -1 : 1) + order.length) % order.length;
  nodeElement(order[next]!)?.focus({ preventScroll: true });
  return true;
}

/**
 * Whether Tab may be taken over: focus rests on the board itself (the body,
 * the canvas, the pane, an element) or in one of the selection menus. Focus
 * anywhere else (the toolbar, the search menu, a text field) keeps the
 * browser's own tab order.
 */
function onBoard(active: Element | null): boolean {
  if (active === null || active === document.body) return true;
  if (active.closest('input, textarea, [contenteditable]') !== null) return false;
  if (active.closest('.react-flow__node') !== null) return true;
  if (active.classList.contains('canvas') || active.classList.contains('react-flow__pane')) {
    return true;
  }
  return [...stops.values()].some((stop) => stop.frame.contains(active));
}

/** The panel's reachable controls, in DOM order. */
function controlsOf(frame: HTMLElement): HTMLElement[] {
  return [...frame.querySelectorAll<HTMLElement>('button, input, textarea, select')].filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
  );
}

/**
 * Installs the Tab and Enter handling, on capture so a menu's own blanket
 * stopPropagation (the panel keeps Delete for its text) cannot starve it.
 * The cancel binding is deliberately absent here: each level answers it
 * itself (the roller closes, the panel steps out, Canvas deselects), so
 * Escape composes one level per press without a second escape path.
 */
export function installFocusCycle(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    // The overlay reads and discusses; its own focus flows stay untouched.
    if (store.getState().commentOverlay) return;
    const active = document.activeElement;
    if (active?.closest('dialog')) return;

    if (event.key === 'Tab') {
      // Inside an entered panel, Tab cycles the panel's own controls.
      const panel = stops.get('panel');
      if (panel !== undefined && active !== null && active !== panel.frame && panel.frame.contains(active)) {
        const controls = controlsOf(panel.frame);
        if (controls.length === 0) return;
        const at = controls.indexOf(active as HTMLElement);
        const next = (at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        controls[next]!.focus({ preventScroll: true });
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (!onBoard(active)) return;
      const moved =
        store.getState().selection.length > 0
          ? cycleRing(active, event.shiftKey)
          : cycleSoftFocus(active, event.shiftKey);
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    // A focused field keeps Enter for its own text.
    if (active?.closest('input, textarea, [contenteditable]')) return;

    if (store.getState().selection.length === 0) {
      // Enter on a soft-focused element selects it, through the bus like a click.
      const id = active?.closest<HTMLElement>('.react-flow__node')?.dataset['id'];
      if (id !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        store.dispatch({ type: 'set-selection', ids: [id] });
      }
      return;
    }

    // Enter on the focused panel moves inside it. The rollers need nothing
    // here: their entrances are buttons, so Enter enters them as a click.
    const panel = stops.get('panel');
    if (panel !== undefined && active === panel.frame) {
      const first = controlsOf(panel.frame)[0];
      if (first !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        first.focus({ preventScroll: true });
      }
    }
  };

  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}
