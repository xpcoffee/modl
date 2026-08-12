import { useEffect, useSyncExternalStore } from 'react';
import { useStore as useFlowStore, type Node } from '@xyflow/react';
import type { Id } from '@modl/core';
import { motionReduced } from '../preferences/motion.js';
import type { BoardNodeData } from './derive.js';

/**
 * Whether the selection menus sit on their anchors or at the dock, decided
 * once for all of them (docs/decisions/024-menu-docking.md).
 *
 * The menus anchor to the selection's corners and bottom edge, which stops
 * working when there is no one sensible anchor (a multi-selection) or when
 * the anchor is out of reach (the element panned away, or bigger than the
 * viewport). Then they dock at the bottom centre of the screen instead.
 *
 * One predicate, published from one component (`DockSentinel`), so the three
 * menus can never disagree about where they live. Presentation only: nothing
 * here reaches the document or the trace.
 */
export interface DockState {
  /** True while the selection menus sit at the bottom-centre dock. */
  docked: boolean;
  /** True while the menus are still travelling after the last flip, so the
      CSS transition plays out before anything re-homes its DOM. */
  travelling: boolean;
}

/** How long a menu travels between anchor and dock. Matches the CSS transition. */
export const DOCK_TRAVEL_MS = 300;

/**
 * How far inside the viewport the selection must sit, in screen pixels,
 * before docked menus re-attach. Docking triggers the moment any edge of the
 * selection leaves the screen, so without this gap a selection resting
 * exactly on the edge would flap between the two states mid-pan.
 */
const REATTACH_MARGIN = 24;

/**
 * Where each menu docks, as a screen offset from the bottom centre of the
 * pane plus the self-alignment that puts the right edge of its box on that
 * point. The panel hangs upward from near the bottom edge; the rollers sit
 * beside its middle, high enough that an opened list and its step zones stay
 * on screen.
 */
const DOCK_SLOTS = {
  /** The edit or style panel: bottom-centre, hanging upward. */
  panel: { x: 0, y: -16, shift: '-50%, -100%' },
  /** The expansion roller, left of the panel. */
  expansion: { x: -132, y: -120, shift: '-100%, -50%' },
  /** The relations roller, right of the panel. */
  relations: { x: 132, y: -120, shift: '0, -50%' },
} as const;

export type DockSlot = keyof typeof DOCK_SLOTS;

let state: DockState = { docked: false, travelling: false };
const listeners = new Set<() => void>();
let travelTimer: number | undefined;

function publish(next: DockState): void {
  state = next;
  for (const listener of listeners) listener();
}

function setDocked(docked: boolean): void {
  if (docked === state.docked) return;
  window.clearTimeout(travelTimer);
  // With motion reduced there is no travel to wait out: the swap is instant.
  const travelling = !motionReduced();
  publish({ docked, travelling });
  if (travelling) {
    travelTimer = window.setTimeout(
      () => publish({ ...state, travelling: false }),
      DOCK_TRAVEL_MS + 50,
    );
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDock(): DockState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** The union of the selected nodes' absolute boxes, in flow coordinates. */
function selectionBounds(
  nodes: Node<BoardNodeData>[],
  selection: ReadonlySet<Id>,
): { left: number; top: number; right: number; bottom: number } | null {
  let bounds: { left: number; top: number; right: number; bottom: number } | null = null;
  for (const node of nodes) {
    if (!selection.has(node.id)) continue;
    const origin = node.data.parentOrigin ?? { x: 0, y: 0 };
    const left = node.position.x + origin.x;
    const top = node.position.y + origin.y;
    const right = left + (node.measured?.width ?? Number(node.style?.width ?? 0));
    const bottom = top + (node.measured?.height ?? Number(node.style?.height ?? 0));
    bounds = bounds
      ? {
          left: Math.min(bounds.left, left),
          top: Math.min(bounds.top, top),
          right: Math.max(bounds.right, right),
          bottom: Math.max(bounds.bottom, bottom),
        }
      : { left, top, right, bottom };
  }
  return bounds;
}

/**
 * The docking predicate: a multi-selection always docks, and a single
 * selection docks while its box does not sit fully inside the viewport. Fully
 * inside, because each menu anchors to a different edge of the box: a corner
 * offscreen is a menu offscreen. A selected connection has no box of its own
 * and its editor stays on the line.
 */
function shouldDock(
  nodes: Node<BoardNodeData>[],
  selection: readonly Id[],
  transform: readonly [number, number, number],
  width: number,
  height: number,
): boolean {
  if (selection.length > 1) return true;
  if (selection.length !== 1) return false;
  // Before React Flow has measured the pane, nothing is knowably offscreen.
  if (width === 0 || height === 0) return state.docked;

  const bounds = selectionBounds(nodes, new Set(selection));
  if (!bounds) return false;

  const [tx, ty, zoom] = transform;
  const margin = (state.docked ? REATTACH_MARGIN : 0) / zoom;
  const view = {
    left: -tx / zoom + margin,
    top: -ty / zoom + margin,
    right: (width - tx) / zoom - margin,
    bottom: (height - ty) / zoom - margin,
  };
  return !(
    bounds.left >= view.left &&
    bounds.top >= view.top &&
    bounds.right <= view.right &&
    bounds.bottom <= view.bottom
  );
}

/**
 * Watches the selection against the viewport and publishes the dock state.
 * Rendered once inside the flow, so the per-pan-frame re-render this
 * subscription costs stays out of the Canvas component itself.
 */
export function DockSentinel({
  nodes,
  selection,
}: {
  nodes: Node<BoardNodeData>[];
  selection: readonly Id[];
}): null {
  const transform = useFlowStore((flow) => flow.transform);
  const width = useFlowStore((flow) => flow.width);
  const height = useFlowStore((flow) => flow.height);

  const docked = shouldDock(nodes, selection, transform, width, height);
  useEffect(() => setDocked(docked), [docked]);
  return null;
}

/**
 * The CSS transform that pins a menu to its dock slot. The menus render
 * inside the viewport portal, so the slot's screen point is converted to flow
 * coordinates and the viewport's zoom is countered: a docked menu holds its
 * place and its size on screen however the camera moves.
 *
 * `active` gates the subscription: while a menu sits on its anchor the
 * viewport transform is not read, so panning does not re-render it.
 */
export function useDockedTransform(slot: DockSlot, active: boolean): string | undefined {
  const transform = useFlowStore((flow) => {
    if (!active) return undefined;
    const [tx, ty, zoom] = flow.transform;
    const at = DOCK_SLOTS[slot];
    const flowX = (flow.width / 2 + at.x - tx) / zoom;
    const flowY = (flow.height + at.y - ty) / zoom;
    return `translate(${flowX}px, ${flowY}px) scale(${1 / zoom}) translate(${at.shift})`;
  });
  return transform;
}
