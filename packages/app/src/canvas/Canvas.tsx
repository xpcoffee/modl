import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Controls,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  useStoreApi,
  ViewportPortal,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  COMMENT_CARD_SIZE,
  DEFAULT_ENTITY_SIZE,
  connectionTypeFor,
  descendantsOf,
  isConnection,
  isEntity,
  isEntityLayout,
  selectIds,
  selectionSpanOf,
  type Id,
  type Point,
  type Side,
} from '@modl/core';
import {
  beginEndMouseTrigger,
  boxSelectGesture,
  deleteKeyCodes,
  keyGestureTrigger,
  matchesKey,
  matchesMouse,
  normalizeKey,
  panButtons,
  selectionKeyCodes,
  selectionOnDragEnabled,
  useKeybindingsVersion,
  type BoxCombine,
} from '../preferences/keybindings.js';
import { store } from '../store/store.js';
import { useAppState, useLoadCount } from '../store/useStore.js';
import {
  connectionIdFromEdge,
  containerAt,
  deriveEdges,
  deriveNodes,
  type BoardNodeData,
  type EntityNodeData,
} from './derive.js';
import { EntityNode } from './EntityNode.js';
import { ConnectionNodeView } from './ConnectionNodeView.js';
import { GroupNode } from './GroupNode.js';
import { ConnectionEdge } from './ConnectionEdge.js';
import { ArrowMarkers } from './ArrowMarkers.js';
import { MINIMAP_BG, miniMapElementOf, miniMapFill, miniMapStroke } from './minimap.js';
import { BoxSelectPreview } from './BoxSelectPreview.js';
import { PlacementPreview } from './PlacementPreview.js';
import { DuplicatePreview } from './DuplicatePreview.js';
import {
  boundsOf,
  copyRects,
  copyToClipboard,
  duplicateElements,
  pasteableIds,
  type CopyRect,
} from './duplication.js';
import { arm, disarm, getPending, usePending } from './placement.js';
import { BoardSettings } from './BoardSettings.js';
import { HistoryControls } from './HistoryControls.js';
import { ReflowControl } from './ReflowControl.js';
import { motionReduced } from '../preferences/motion.js';
import { SearchMenu } from '../panels/SearchMenu.js';
import { HiddenStrip } from '../panels/HiddenStrip.js';
import { useSearchPreview } from './searchPreview.js';
import { ExpansionMenu } from './ExpansionMenu.js';
import { RelationsMenu } from './RelationsMenu.js';
import { SelectionActions } from './SelectionActions.js';
import { DockedEditor } from './DockedEditor.js';
import { DockSentinel, useDock } from './docking.js';
import {
  addCommentTargets,
  CommentOverlay,
  openElementComment,
  OverlayToggle,
  quickAddComment,
  toggleCommentTarget,
} from './CommentOverlay.js';
import { getCommentEdit } from './commentEditing.js';
import { startEditing, stopEditing, useEditingId } from './editing.js';
import { installFocusCycle } from './focusRing.js';
import { useHighlightId } from './highlight.js';
import { lastConnectionStyle, lastEntityStyle } from './styleMemory.js';
import { GLIDE_MS, pressRipple, takeGlide, useGlidesStarted, useWarpingIds } from './animations.js';
import { GravityGrid } from './GravityGrid.js';
import { WarpGhosts } from './WarpGhosts.js';

const NODE_TYPES = { entity: EntityNode, group: GroupNode, 'connection-node': ConnectionNodeView };
const EDGE_TYPES = { connection: ConnectionEdge };

/** How far past the control cluster the click guard reaches, in pixels. */
const CONTROLS_GUARD_MARGIN = 16;

/**
 * Whether a point sits on or near the board control cluster (zoom, fit,
 * undo, redo). Clicks aimed at a control miss by a few pixels when someone
 * clicks fast, and a miss that reaches the pane creates a component under
 * the buttons, so creation is refused in this zone rather than only on the
 * buttons themselves.
 */
function nearBoardControls(clientX: number, clientY: number): boolean {
  const controls = document.querySelector('.react-flow__controls');
  if (!controls) return false;
  const rect = controls.getBoundingClientRect();
  return (
    clientX >= rect.left - CONTROLS_GUARD_MARGIN &&
    clientX <= rect.right + CONTROLS_GUARD_MARGIN &&
    clientY >= rect.top - CONTROLS_GUARD_MARGIN &&
    clientY <= rect.bottom + CONTROLS_GUARD_MARGIN
  );
}

/** How far an alt+drag must travel before it copies anything, in flow pixels. */
const COPY_DRAG_MINIMUM = 4;
/** Where a paste lands when its copy draws no box to centre on the pointer. */
const PASTE_NUDGE = { x: 32, y: 32 } as const;

/**
 * The node the duplicate binding (alt+drag out of the box) would copy, or
 * null when the press is something else. Read from the event rather than from
 * state because two handlers have to agree on it: the pointerdown that opens
 * the gesture, and the mousedown that would otherwise start React Flow's
 * node drag before the gesture is drawn.
 */
function duplicateTarget(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  button: number;
  target: EventTarget | null;
}): Id | null {
  if (!matchesMouse('duplicate', event) || getPending() !== null) return null;
  const node = (event.target as HTMLElement | null)?.closest<HTMLElement>('.react-flow__node');
  return node?.dataset['id'] ?? null;
}

/** Ease-in-out cubic, matching the camera's own 300ms settles. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** The middle of the board in screen coordinates. */
function centreOf(element: HTMLElement | null): { x: number; y: number } {
  const rect = element?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** The subset of a React Flow change this app acts on. */
interface CanvasChange {
  type: string;
  id?: string;
  selected?: boolean;
}

/**
 * A selection box in flight. React Flow's box always replaces the selection
 * and reports it change by change, so the gesture is settled here instead:
 * dispatches pause while the box is open, and on release the boxed elements
 * are computed from geometry and combined with the selection the gesture
 * started with, in one dispatch.
 */
interface BoxGesture {
  /** The selection when the box opened. */
  prior: ReadonlySet<Id>;
  /** How the boxed elements join `prior`, read from the opening press. */
  combine: BoxCombine;
  /** Where the box opened, in flow coordinates. Converted at press time so
      auto-panning mid-drag cannot shift it. */
  start: Point;
  /** The comment whose card was open when the box started: the boxed
      elements join its targets instead of the selection. */
  forComment: Id | null;
}

/**
 * A duplicate gesture in flight. The copies are ghosts until the gesture
 * settles, so nothing on the board moves and it lands as one
 * `duplicate-elements`. See docs/decisions/013-duplication.md.
 */
interface CopyDrag {
  /** What is being copied: the selection when it holds the pressed element, else that element alone. */
  ids: Id[];
  /** Boxes the copy would draw, before the drag moved it. */
  rects: CopyRect[];
  /** Where the press landed, in flow coordinates. */
  from: Point;
  /** How far the pointer has travelled since. */
  offset: Point;
  /** True when the pointer's release does not settle it: a begin+end run or a held key. */
  untilEnd?: boolean;
  /** For a held key: the run settles when this key is released. */
  endKey?: string;
}

/**
 * A box selection running free of the pointer: begun by the box-select
 * binding, grown by pointer movement, settled by the binding's release (a
 * held key) or its next press (begin+end), and abandoned by the cancel
 * binding.
 */
interface BoxRun {
  /** Where the run began, in flow coordinates. */
  start: Point;
  /** Where the pointer is now, in flow coordinates. */
  to: Point;
  /** The selection when the run began. */
  prior: ReadonlySet<Id>;
  /** How the boxed elements join `prior`, read from the beginning press. */
  combine: BoxCombine;
  /** For a held key: the run settles when this key is released. */
  endKey?: string;
}

/** The rectangle two corners span. */
function rectFrom(a: Point, b: Point): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function Canvas() {
  const state = useAppState();
  const editingId = useEditingId();
  const highlightId = useHighlightId();
  const loadCount = useLoadCount();
  const { screenToFlowPosition, fitView, setViewport, setCenter, getViewport } = useReactFlow();
  const flowStore = useStoreApi();

  // A selection box in flight keeps element editors shut.
  const [boxSelecting, setBoxSelecting] = useState(false);
  const boxGesture = useRef<BoxGesture | null>(null);
  // Whether the last press held ctrl or cmd, read when React Flow reports the
  // resulting selection change: a toggle also speaks for a group's members.
  const pressToggles = useRef(false);
  // A duplicate gesture in flight, drawn as ghosts where the copies would land.
  const [copyDrag, setCopyDrag] = useState<CopyDrag | null>(null);
  // A begin+end box selection in flight, drawn as its own rectangle.
  const [boxRun, setBoxRun] = useState<BoxRun | null>(null);
  // Last pointer position over the board, so a paste knows where to centre.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /**
   * Whether the click closing the current gesture should be swallowed. A
   * press on a node released over the pane produces a click on the pane, and
   * React Flow answers that by clearing the selection, which would throw away
   * the copies an alt+drag just made.
   */
  const swallowClick = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pending = usePending();
  // Rebinding an input takes effect immediately: the React Flow props below
  // are derived from the bindings on every render, and this re-renders.
  useKeybindingsVersion();
  const warping = useWarpingIds();
  const [draft, setDraft] = useState<{ from: Point; to: Point | null } | null>(null);
  // The dock keeps the editor away from the element while the menus are
  // there or still travelling back, so it never renders in two homes at once.
  const { docked, travelling } = useDock();
  const dockedEditor = docked || travelling;
  const options = useMemo(
    () => ({ editingId, boxSelecting, highlightId, dockedEditor }),
    [editingId, boxSelecting, highlightId, dockedEditor],
  );
  /**
   * What the board draws while someone types in the search menu: the same
   * session, filtered by the expression they are trying out. The selection
   * highlight stands down for the duration, because it otherwise outranks the
   * filter (decision 009) and the preview would show nothing while anything
   * was selected, which is most of the time someone reaches for search. The
   * selection itself is untouched, so what is chosen stays chosen.
   */
  const preview = useSearchPreview();
  const overlay = state.commentOverlay;
  // The discussion overlay suspends the selection highlight too: muting
  // there follows the filter alone, which is also what gates interaction.
  const shown = useMemo(() => {
    if (preview !== null) return { ...state, filter: preview, selectionHighlight: false };
    if (overlay) return { ...state, selectionHighlight: false };
    return state;
  }, [state, preview, overlay]);

  /** What the filter lets the overlay touch. Everything, with no filter. */
  const interactable = useMemo(
    () =>
      selectIds(state.document.model.elements, state.filter, state.document.comments),
    [state.document.model.elements, state.filter, state.document.comments],
  );

  const derived = useMemo(
    () =>
      deriveNodes(shown, options).map((node) =>
        warping.has(node.id) ? { ...node, className: 'is-warping-in' } : node,
      ),
    [shown, options, warping],
  );
  const edges = useMemo(() => deriveEdges(shown, options), [shown, options]);

  /**
   * React Flow owns node positions while a drag is in flight, so the node
   * follows the pointer. The command fires once on drop, which keeps the
   * trace holding the position the user meant rather than every pixel.
   */
  const [nodes, setNodes] = useState(derived);
  // The positions drawn right now, for a glide to start from.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  /**
   * A glide in flight: where each node started, and when. Targets live in
   * their own ref and refresh on every sync, so a mid-glide state change (a
   * click selecting a node, a filter preview) re-aims the glide instead of
   * snapping everything to its end position.
   */
  const glide = useRef<{ starts: Map<string, Point>; startedAt: number } | null>(null);
  const glideTargets = useRef(new Map<string, Point>());
  const glideFrame = useRef(0);

  useEffect(() => () => window.cancelAnimationFrame(glideFrame.current), []);

  // Tab and Enter drive keyboard focus over the board and the selection
  // menus (decision 025).
  useEffect(() => installFocusCycle(), []);

  useEffect(() => {
    glideTargets.current = new Map(derived.map((node) => [node.id, node.position]));
    // A reflow glides each element from where it was drawn to where the
    // command put it, so the eye can track which box went where. Everything
    // else lands at once.
    const fresh = takeGlide();
    if (fresh) {
      glide.current = {
        starts: new Map(nodesRef.current.map((node) => [node.id, node.position])),
        startedAt: performance.now(),
      };
    }
    const active = glide.current;

    // Carry each node's measured size forward. Handing React Flow a fresh
    // unmeasured object on every state change makes it hide the node until it
    // re-measures, which drops it out of hit-testing mid-interaction.
    setNodes((current) => {
      const previous = new Map(current.map((node) => [node.id, node]));
      return derived.map((node) => {
        const before = previous.get(node.id);
        const kept = before?.measured ? { ...node, measured: before.measured } : node;
        // A node mid-glide keeps its drawn position; the frames advance it.
        if (active && before && !before.dragging && active.starts.has(node.id)) {
          return { ...kept, position: before.position };
        }
        return kept;
      });
    });

    if (!fresh) return;
    window.cancelAnimationFrame(glideFrame.current);
    const step = () => {
      const running = glide.current;
      if (!running) return;
      const t = Math.min(1, (performance.now() - running.startedAt) / GLIDE_MS);
      // Stillness asked for mid-glide takes effect now: the frame snaps to the end.
      const progress = motionReduced() ? 1 : easeInOut(t);
      setNodes((current) =>
        current.map((node) => {
          // A node the pointer is holding belongs to the drag, and a glide
          // frame writing over it would put a glide-path position into the
          // command the drop dispatches.
          if (node.dragging) return node;
          const from = running.starts.get(node.id);
          const to = glideTargets.current.get(node.id);
          if (!from || !to || (from.x === to.x && from.y === to.y)) return node;
          return {
            ...node,
            position: {
              x: from.x + (to.x - from.x) * progress,
              y: from.y + (to.y - from.y) * progress,
            },
          };
        }),
      );
      if (progress < 1) glideFrame.current = window.requestAnimationFrame(step);
      else glide.current = null;
    };
    glideFrame.current = window.requestAnimationFrame(step);
  }, [derived]);

  /**
   * Frames the board when a document arrives, so a file whose elements sit
   * outside the current camera is not invisible on open. Creating an element
   * leaves the camera alone, which is the difference from `fitView` on the
   * component: that fired the first time any node appeared.
   */
  useEffect(() => {
    if (loadCount === 0) return;
    // A frame later, once React Flow has measured the nodes it was handed.
    const timer = window.setTimeout(() => void fitView({ padding: 0.15 }), 0);
    return () => window.clearTimeout(timer);
  }, [loadCount, fitView]);

  /**
   * The camera follows set-view commands, so a pan issued through the bus (the
   * relations menu, an agent, a replay) actually moves the board.
   * Hand-panning never dispatches set-view, so nothing fights the pointer, and
   * a document load is left to the fitView above.
   */
  const seenView = useRef({ view: state.document.view, loads: loadCount });
  useEffect(() => {
    const prior = seenView.current;
    seenView.current = { view: state.document.view, loads: loadCount };
    if (state.document.view === prior.view || loadCount !== prior.loads) return;
    // The view also carries the first-open hint; an edit that leaves the
    // camera numbers alone must not snap a hand-panned board back to them.
    const { pan, zoom } = state.document.view;
    if (pan.x === prior.view.pan.x && pan.y === prior.view.pan.y && zoom === prior.view.zoom) {
      return;
    }
    void setViewport(
      { x: state.document.view.pan.x, y: state.document.view.pan.y, zoom: state.document.view.zoom },
      { duration: 300 },
    );
  }, [state.document.view, loadCount, setViewport]);

  const onNodeDragStop = useCallback(
    (_: unknown, __: Node, dragged: Node<BoardNodeData>[]) => {
      const state = store.getState();
      const elements = state.document.model.elements;

      for (const node of dragged) {
        // A node inside a container reports a position relative to it, and the
        // document stores absolute coordinates.
        const parent = node.data.parentOrigin ?? { x: 0, y: 0 };
        const to = { x: node.position.x + parent.x, y: node.position.y + parent.y };
        const from = node.data.origin ?? to;
        const delta = { x: to.x - from.x, y: to.y - from.y };

        store.dispatch({ type: 'move-element', id: node.id, position: to });

        // A group carries its members whether it is open or shut. Moving it
        // while collapsed and leaving them behind would scatter them back to
        // their old positions the moment it is expanded. A node holds nothing.
        const carriesMembers =
          node.data.isContainer === true || (node.data.memberCount as number | undefined) !== undefined
            ? node.data.isContainer === true || ((node.data.memberCount as number) ?? 0) > 0
            : false;
        if (carriesMembers && (delta.x !== 0 || delta.y !== 0)) {
          for (const memberId of descendantsOf(elements, node.id)) {
            const layout = state.document.layout[memberId];
            if (!layout || !('x' in layout)) continue;
            store.dispatch({
              type: 'move-element',
              id: memberId,
              position: { x: layout.x + delta.x, y: layout.y + delta.y },
            });
          }
        }
      }

      // Where a node was dropped decides which container it belongs to, which
      // is how an element joins or leaves a group.
      for (const node of dragged) {
        const parent = node.data.parentOrigin ?? { x: 0, y: 0 };
        const centre = {
          x: node.position.x + parent.x + (node.measured?.width ?? 0) / 2,
          y: node.position.y + parent.y + (node.measured?.height ?? 0) / 2,
        };
        const own = new Set([node.id, ...descendantsOf(elements, node.id)]);
        const container = containerAt(store.getState(), centre, own);
        const current = elements[node.id]?.groupId ?? null;
        if (container !== current) {
          store.dispatch({ type: 'set-group', id: node.id, groupId: container });
        }
      }
    },
    [],
  );

  const onResizeEnd = useCallback((id: string, width: number, height: number) => {
    store.dispatch({ type: 'resize-element', id, width, height });
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const elements = store.getState().document.model.elements;
    const target = elements[connection.target];
    const source = elements[connection.source];
    // The connection takes the paradigm of what it points at. An artifact or
    // a node has no paradigm, so fall back to where the line came from.
    const connectionType =
      (target && isEntity(target) ? connectionTypeFor(target.type) : null) ??
      (source && isEntity(source) ? connectionTypeFor(source.type) : null) ??
      'interaction';

    const id = crypto.randomUUID();
    const style = lastConnectionStyle();
    store.dispatch({
      type: 'create-connection',
      id,
      connectionType,
      from: [connection.source],
      to: [connection.target],
      title: '',
      ...(style === undefined ? {} : { style }),
    });

    // The handles the reader actually dragged between. Layout, not structure:
    // which side of a box a line touches says nothing about the domain.
    const sourceSide = asSide(connection.sourceHandle);
    const targetSide = asSide(connection.targetHandle);
    if (sourceSide || targetSide) {
      store.dispatch({
        type: 'set-connection-sides',
        id,
        source: sourceSide,
        target: targetSide,
      });
    }
  }, []);

  /**
   * Double-click renames what sits under the pointer, and creates an element
   * when that is empty canvas.
   *
   * The element under the pointer decides, rather than `event.target`. The
   * first click of a double-click changes the selection and re-renders, so
   * the two clicks can land on different elements and the browser then
   * reports their common ancestor, which is the pane even for a node.
   */
  /**
   * A side worth remembering. A junction's handles are picked by the renderer
   * rather than the reader, so they are not stored.
   */
  const asSide = (handle: string | null | undefined): Side | null =>
    handle === 'left' || handle === 'right' || handle === 'top' || handle === 'bottom'
      ? handle
      : null;

  /**
   * Dragging an end of a selected connection onto another element re-points
   * it. The edge id carries which pair this line stands for, so a
   * many-to-many connection only has the end that moved replaced.
   */
  const onReconnect = useCallback((edge: Edge, connection: Connection) => {
    if (!connection.source || !connection.target) return;

    const [id, oldSource, oldTarget] = edge.id.split(':');
    if (!id || id === 'rollup') return;

    const element = store.getState().document.model.elements[id];
    if (!element || !isConnection(element)) return;

    const swap = (list: Id[], was: string | undefined, now: string): Id[] => {
      if (!was || was === now) return list;
      const next = list.map((entry) => (entry === was ? now : entry));
      return [...new Set(next)];
    };

    store.dispatch({
      type: 'set-endpoints',
      id,
      from: swap(element.from, oldSource, connection.source),
      to: swap(element.to, oldTarget, connection.target),
    });

    // The line was dropped somewhere new, so its old contact points no longer
    // describe where it runs.
    store.dispatch({
      type: 'set-connection-sides',
      id,
      source: asSide(connection.sourceHandle),
      target: asSide(connection.targetHandle),
    });
  }, []);

  /** Puts down whatever the picker has armed, at a point or across a drag. */
  const place = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const type = getPending();
      if (!type) return;
      const id = crypto.randomUUID();
      // The style the reader chose last follows onto whatever they place next.
      const style = lastEntityStyle();

      if (type === 'connection-node' || type === 'decision') {
        store.dispatch({
          type: 'create-connection-node',
          id,
          shape: type === 'decision' ? 'diamond' : 'circle',
          title: '',
          position: { x: rect.x, y: rect.y },
          ...(style === undefined ? {} : { style }),
        });
      } else {
        store.dispatch({
          type: 'create-entity',
          id,
          entityType: type,
          title: `New ${type}`,
          position: { x: rect.x, y: rect.y },
          ...(style === undefined ? {} : { style }),
        });
      }

      // A drag says how big; a click leaves the natural size alone.
      if (rect.width > 0 && rect.height > 0) {
        store.dispatch({ type: 'resize-element', id, width: rect.width, height: rect.height });
      }
      disarm();
    },
    [],
  );

  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      // In the overlay a double-click on empty board writes a general
      // remark; it never edits the model underneath.
      if (store.getState().commentOverlay) {
        const hit = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
        const emptyBoard =
          hit?.closest(
            '.react-flow__node, .edge-label, .comment-card, .comment-timeline, .overlay-toggle, .search-menu, .react-flow__controls, .react-flow__minimap',
          ) === null;
        // The remark lands where it was written, pinned in place.
        if (emptyBoard) {
          setCardGhost(null);
          quickAddComment([], screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }
        return;
      }
      // A double-click on or beside the controls is a mis-aimed button press,
      // not a request for a component. Enabled buttons bubble their clicks up
      // to here, so without this a zoom spam-click drops components too.
      if (nearBoardControls(event.clientX, event.clientY)) return;

      const hit = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;

      // A double-click on the minimap is aimed at the camera, not the board.
      if (hit?.closest('.react-flow__minimap')) return;

      // Nor is one inside an overlay: double-clicking a word in the search
      // box would otherwise drop a component behind the box.
      if (hit?.closest('.search-menu, .hidden-strip')) return;

      const node = hit?.closest<HTMLElement>('.react-flow__node');
      if (node?.dataset['id']) {
        startEditing(node.dataset['id']);
        return;
      }

      const label = hit?.closest<HTMLElement>('.edge-label');
      if (label?.dataset['connectionId']) {
        startEditing(label.dataset['connectionId']);
        return;
      }

      // Centred on the pointer, since that is where the user aimed.
      const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const style = lastEntityStyle();
      store.dispatch({
        type: 'create-entity',
        id: crypto.randomUUID(),
        entityType: 'component',
        title: 'New component',
        position: {
          x: at.x - DEFAULT_ENTITY_SIZE.width / 2,
          y: at.y - DEFAULT_ENTITY_SIZE.height / 2,
        },
        ...(style === undefined ? {} : { style }),
      });
    },
    [screenToFlowPosition],
  );

  /**
   * React Flow is controlled here, so selection and removal only take effect
   * once they come back through the command bus.
   */
  const routeChanges = useCallback(
    (changes: readonly CanvasChange[], toElementId: (id: string) => string) => {
      const state = store.getState();
      const selection = new Set(state.selection);
      let selectionMoved = false;

      for (const change of changes) {
        // The `add` variant carries an item rather than an id, and never applies here.
        if (change.id === undefined) continue;
        const elementId = toElementId(change.id);
        if (change.type === 'remove') {
          store.dispatch({ type: 'delete-element', id: elementId });
          selection.delete(elementId);
          selectionMoved = true;
        } else if (change.type === 'select' && boxGesture.current === null) {
          // A box in flight settles as one dispatch on release, so its
          // change-by-change reports are left alone here.
          selectionMoved = true;
          // Ctrl+click toggles the element, and on a group its visible
          // members with it (docs/decisions/012-selection-gestures.md).
          const affected = pressToggles.current
            ? selectionSpanOf(
                state.document.model.elements,
                new Set(state.expanded),
                state.hidden,
                elementId,
              )
            : [elementId];
          for (const id of affected) {
            if (change.selected) selection.add(id);
            else selection.delete(id);
          }
        }
      }

      if (!selectionMoved) return;
      const ids = [...selection].filter((id) => store.getState().document.model.elements[id]);
      store.dispatch({ type: 'set-selection', ids });
    },
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<BoardNodeData>>[]) => {
      // While a box is open, React Flow deselects the prior selection, which
      // this gesture still needs (the release combines the boxed elements
      // with it). Those elements stay drawn as selected until the release
      // settles what the selection becomes.
      const gesture = boxGesture.current;
      const visual = gesture
        ? changes.filter(
            (change) =>
              !(change.type === 'select' && !change.selected && gesture.prior.has(change.id)),
          )
        : changes;
      // Position and dimension changes stay local until the drag ends.
      setNodes((current) => applyNodeChanges(visual, current));
      routeChanges(changes, (id) => id);
    },
    [routeChanges],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => routeChanges(changes, connectionIdFromEdge),
    [routeChanges],
  );

  /**
   * A ghost card pulsing where the pane was clicked in the overlay. It says
   * what a second click writes there, in the overlay's own language rather
   * than the model's gravity wave.
   */
  const [cardGhost, setCardGhost] = useState<{ at: Point; key: number } | null>(null);
  const ghostTimer = useRef<number | undefined>(undefined);

  /**
   * A lone click on empty canvas answers with a small wave: the spot is live,
   * and a second click here creates an element. In the overlay the answer is
   * the outline of the comment a second click would write instead.
   */
  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      stopEditing();
      const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (store.getState().commentOverlay) {
        setCardGhost((previous) => ({ at, key: (previous?.key ?? 0) + 1 }));
        window.clearTimeout(ghostTimer.current);
        ghostTimer.current = window.setTimeout(() => setCardGhost(null), 650);
        return;
      }
      pressRipple(at);
    },
    [screenToFlowPosition],
  );

  /**
   * Drops the rectangle React Flow draws over the nodes a box gesture just
   * selected. That rectangle sits above them and swallows every press aimed
   * at one, so an alt+drag lands on it rather than on an element and a
   * selection built by a box behaves unlike the same selection built by
   * clicks. A selection is one thing here however it was made, so the
   * rectangle goes and the elements underneath stay live.
   */
  const dropSelectionRect = useCallback(() => {
    if (flowStore.getState().nodesSelectionActive) {
      flowStore.setState({ nodesSelectionActive: false });
    }
  }, [flowStore]);

  /**
   * Settles a box: the nodes drawn fully inside it and the connections
   * touching them, combined with the selection the gesture opened over —
   * replacing it, joining it, or leaving it. One dispatch per gesture, and
   * none when the selection would not change. Shared between the held drag
   * and the begin+end run.
   */
  const settleBox = useCallback(
    (
      rect: { x: number; y: number; width: number; height: number },
      prior: ReadonlySet<Id>,
      combine: BoxCombine,
      forComment: Id | null,
    ) => {
      const boxedNodes = new Set<Id>();
      for (const node of nodes) {
        const origin = node.data.origin;
        const width = node.measured?.width ?? Number(node.style?.width ?? 0);
        const height = node.measured?.height ?? Number(node.style?.height ?? 0);
        if (
          origin.x >= rect.x &&
          origin.y >= rect.y &&
          origin.x + width <= rect.x + rect.width &&
          origin.y + height <= rect.y + rect.height
        ) {
          boxedNodes.add(node.id);
        }
      }

      const boxed = new Set<Id>(boxedNodes);
      for (const edge of edges) {
        // A roll-up stands in for lines hidden inside a collapsed group; the
        // reader has not pointed at any one of them.
        if (edge.id.startsWith('rollup:')) continue;
        if (boxedNodes.has(edge.source) || boxedNodes.has(edge.target)) {
          boxed.add(connectionIdFromEdge(edge.id));
        }
      }

      // A box drawn while a card is open gathers targets for the comment;
      // the selection, which the overlay never shows for elements, is left
      // alone. Only what the filter shows joins.
      if (forComment !== null) {
        addCommentTargets(
          forComment,
          [...boxed].filter((id) => interactable.has(id)),
        );
        return;
      }

      const state = store.getState();
      const next =
        combine === 'subtract'
          ? [...prior].filter((id) => !boxed.has(id))
          : combine === 'add'
            ? [...new Set([...prior, ...boxed])]
            : [...boxed];
      const ids = next.filter((id) => state.document.model.elements[id]);

      const current = new Set(state.selection);
      if (ids.length !== current.size || ids.some((id) => !current.has(id))) {
        store.dispatch({ type: 'set-selection', ids });
        return;
      }
      // Nothing moved, but React Flow deselected mid-drag; put the drawn
      // selection back where the session says it is.
      setNodes((drawn) =>
        drawn.map((node) =>
          node.selected === current.has(node.id)
            ? node
            : { ...node, selected: current.has(node.id) },
        ),
      );
    },
    [nodes, edges, interactable],
  );

  /** Settles a held box gesture on release. */
  const endBoxSelection = useCallback(
    (event: React.PointerEvent) => {
      const gesture = boxGesture.current;
      if (!gesture) return;
      boxGesture.current = null;

      const end = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      settleBox(rectFrom(gesture.start, end), gesture.prior, gesture.combine, gesture.forComment);
    },
    [screenToFlowPosition, settleBox],
  );

  /**
   * Where a copy lands decides which container holds it, the same rule a drop
   * follows. Only a copy whose group stayed behind can move: one copied
   * together with its group is already inside it.
   */
  const settleCopies = useCallback((idMap: Record<Id, Id>) => {
    const copies = new Set(Object.values(idMap));
    for (const copy of copies) {
      const state = store.getState();
      const element = state.document.model.elements[copy];
      if (!element || isConnection(element)) continue;
      if (element.groupId !== null && copies.has(element.groupId)) continue;

      const entry = state.document.layout[copy];
      if (!entry || !isEntityLayout(entry)) continue;
      const size = state.expanded.includes(copy) && entry.expanded ? entry.expanded : entry;
      const centre = { x: entry.x + size.width / 2, y: entry.y + size.height / 2 };

      const own = new Set([copy, ...descendantsOf(state.document.model.elements, copy)]);
      const container = containerAt(state, centre, own);
      if (container !== element.groupId) {
        store.dispatch({ type: 'set-group', id: copy, groupId: container });
      }
    }
  }, []);

  /**
   * Settles a held duplicate drag on release: one duplicate at the distance
   * travelled. A press that never moved copies nothing, since the copy would
   * land exactly on top of what it came from. A begin+end run passes by:
   * only its own next trigger settles it.
   */
  const endCopyDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!copyDrag || copyDrag.untilEnd) return;
      setCopyDrag(null);

      const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const offset = { x: at.x - copyDrag.from.x, y: at.y - copyDrag.from.y };
      if (Math.hypot(offset.x, offset.y) < COPY_DRAG_MINIMUM) return;

      swallowClick.current = true;
      settleCopies(duplicateElements(copyDrag.ids, offset));
    },
    [copyDrag, screenToFlowPosition, settleCopies],
  );

  /**
   * Opens a begin+end duplicate run: the copies are what the pointer is over
   * (the selection when it holds that element), or the selection when the
   * pointer is over nothing.
   */
  const beginCopyRun = useCallback((at: Point, grabbed: Id | null, endKey?: string) => {
    const state = store.getState();
    const ids = grabbed
      ? state.selection.includes(grabbed)
        ? [...state.selection]
        : [grabbed]
      : [...state.selection];
    if (ids.length === 0) return;
    setCopyDrag({
      ids,
      rects: copyRects(state, ids),
      from: at,
      offset: { x: 0, y: 0 },
      untilEnd: true,
      ...(endKey !== undefined ? { endKey } : {}),
    });
  }, []);

  /** Settles a begin+end duplicate run: the copies land where it ended. */
  const endCopyRun = useCallback(
    (at: Point) => {
      if (!copyDrag) return;
      setCopyDrag(null);
      const offset = { x: at.x - copyDrag.from.x, y: at.y - copyDrag.from.y };
      if (Math.hypot(offset.x, offset.y) < COPY_DRAG_MINIMUM) return;
      settleCopies(duplicateElements(copyDrag.ids, offset));
    },
    [copyDrag, settleCopies],
  );

  /** Settles the box run in flight, wherever its rectangle reaches. */
  const settleBoxRun = useCallback(() => {
    if (!boxRun) return;
    settleBox(rectFrom(boxRun.start, boxRun.to), boxRun.prior, boxRun.combine, null);
    setBoxRun(null);
  }, [boxRun, settleBox]);

  /** Drops a copy of the clipboard, centred on a point in flow coordinates. */
  const pasteAt = useCallback(
    (at: Point) => {
      const state = store.getState();
      const ids = pasteableIds(state);
      if (ids.length === 0) return;

      // Centred on the cursor, which is where the reader is pointing. A copy
      // with nothing drawn to measure, every element of it inside a collapsed
      // group, is nudged instead so a second paste clears the first.
      const bounds = boundsOf(copyRects(state, ids));
      const offset = bounds
        ? { x: at.x - (bounds.x + bounds.width / 2), y: at.y - (bounds.y + bounds.height / 2) }
        : PASTE_NUDGE;
      settleCopies(duplicateElements(ids, offset));
    },
    [settleCopies],
  );

  /**
   * The copy binding remembers the selection and the paste binding drops a
   * copy centred on the pointer, so a run of pastes follows the cursor across
   * the board. These live here rather than beside the other shortcuts in App
   * because a paste needs the pointer in flow coordinates.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const copy = matchesKey('copy', event);
      const paste = !copy && matchesKey('paste', event);
      if (!copy && !paste) return;

      // A focused field keeps the browser's copy and paste over its own text.
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable]')) return;

      if (copy) {
        const selection = store.getState().selection;
        // Nothing selected is nothing to copy, and the clipboard keeps what
        // it already holds.
        if (selection.length === 0) return;
        event.preventDefault();
        copyToClipboard(selection);
        return;
      }

      if (pasteableIds(store.getState()).length === 0) return;
      event.preventDefault();
      pasteAt(screenToFlowPosition(pointer.current ?? centreOf(canvasRef.current)));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pasteAt, screenToFlowPosition]);

  /**
   * Gestures bound to keys: the press opens the run at the pointer, and it
   * settles on the key's release (hold mode) or the binding's next press
   * (begin+end). The cancel binding abandons it. Mouse-bound runs go through
   * the pointer handlers below instead.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A focused field keeps its keys for its own text.
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable]')) return;

      if (matchesKey('cancel', event)) {
        // Nearest claim first: a run in flight, an armed placement, the
        // selection, then the comment overlay — repeated presses back out
        // of anything. Menus, editors, and the dialog keep their own Escape
        // (the guard above, their own handlers, and the dialog check here).
        if (boxRun || copyDrag?.untilEnd) {
          event.preventDefault();
          setBoxRun(null);
          setCopyDrag(null);
          return;
        }
        if (getPending() !== null) {
          event.preventDefault();
          disarm();
          return;
        }
        if (target?.closest('dialog')) return;
        const current = store.getState();
        if (current.selection.length > 0) {
          event.preventDefault();
          store.dispatch({ type: 'set-selection', ids: [] });
          return;
        }
        if (current.commentOverlay) {
          event.preventDefault();
          store.dispatch({ type: 'set-comment-overlay', open: false });
        }
        return;
      }

      // A held key repeats its keydown; only the first press drives a run.
      if (event.repeat) return;
      const trigger = keyGestureTrigger(event);
      if (!trigger) return;
      event.preventDefault();
      const at = screenToFlowPosition(pointer.current ?? centreOf(canvasRef.current));
      const endKey = trigger.until === 'release' ? normalizeKey(event.key) : undefined;
      if (trigger.id === 'box-select') {
        if (boxRun) {
          // A begin+end run settles on the next press; a hold run waits for
          // its release.
          if (!boxRun.endKey) settleBoxRun();
          return;
        }
        setBoxRun({
          start: at,
          to: at,
          prior: new Set(store.getState().selection),
          combine: trigger.combine,
          ...(endKey !== undefined ? { endKey } : {}),
        });
        return;
      }
      if (copyDrag?.untilEnd) {
        if (!copyDrag.endKey) endCopyRun(at);
        return;
      }
      const under = pointer.current
        ? document
            .elementFromPoint(pointer.current.x, pointer.current.y)
            ?.closest<HTMLElement>('.react-flow__node')?.dataset['id']
        : undefined;
      beginCopyRun(at, under ?? null, endKey);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = normalizeKey(event.key);
      if (boxRun?.endKey === key) {
        settleBoxRun();
        return;
      }
      if (copyDrag?.untilEnd && copyDrag.endKey === key) {
        endCopyRun(screenToFlowPosition(pointer.current ?? centreOf(canvasRef.current)));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [boxRun, copyDrag, screenToFlowPosition, settleBoxRun, beginCopyRun, endCopyRun]);

  /** A press on the minimap recentres the board there, at the zoom it holds. */
  const onMiniMapClick = useCallback(
    (_: unknown, position: { x: number; y: number }) => {
      void setCenter(position.x, position.y, { zoom: getViewport().zoom, duration: 200 });
    },
    [setCenter, getViewport],
  );

  // How many glides have started, stamped on the board so a spec can assert
  // that a reflow animated (or, under reduced motion, that it did not).
  const glidesStarted = useGlidesStarted();

  /**
   * The minimap mirrors the board: muted elements stay faint, authored
   * colours stay recognisable, an open container draws as a tint so its
   * members show through. Values and ratios live in minimap.ts.
   */
  const miniMapNodeColor = useCallback((node: Node) => miniMapFill(miniMapElementOf(node.data)), []);
  const miniMapNodeStrokeColor = useCallback(
    (node: Node) => miniMapStroke(miniMapElementOf(node.data)),
    [],
  );
  /** One class per element, so a spec can find a given element's rectangle. */
  const miniMapNodeClassName = useCallback((node: Node) => `mm-${node.id}`, []);

  return (
    <div
      ref={canvasRef}
      className={`canvas${pending ? ' is-placing' : ''}${overlay ? ' is-comment-overlay' : ''}`}
      data-testid="canvas"
      data-placing={pending ?? undefined}
      data-comment-overlay={overlay ? 'true' : undefined}
      data-glides={glidesStarted}
      // The board owns the right button, so it can be bound to an action
      // rather than opening the browser's menu.
      onContextMenuCapture={(event) => event.preventDefault()}
      // React Flow starts a node drag on mousedown, so stopping the
      // pointerdown below does not keep the original still by itself.
      onMouseDownCapture={(event) => {
        if (duplicateTarget(event) || beginEndMouseTrigger(event)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      // The click that ends an alt+drag belongs to the gesture, not to the
      // board underneath it.
      onClickCapture={(event) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.stopPropagation();
      }}
      onPointerDownCapture={(event) => {
        pressToggles.current = event.ctrlKey || event.metaKey;
        // A gesture that ended without its click leaves nothing armed here.
        swallowClick.current = false;
        const target = event.target as HTMLElement;

        // In the overlay every element press speaks comments: React Flow
        // never sees it, so the normal selection UI never shows. One click
        // opens the element's discussion (or a fresh card), and while a card
        // is open ctrl+click toggles the element in and out of its targets.
        // preventDefault keeps focus in the open text box, so writing
        // continues across the toggles. Only what the filter shows reacts.
        const pressedId =
          target.closest<HTMLElement>('.react-flow__node')?.dataset['id'] ??
          target.closest<HTMLElement>('.edge-label')?.dataset['connectionId'] ??
          null;
        if (overlay && pressedId !== null) {
          // Cancelling the pointerdown does not cancel the click that
          // follows it, and the click is where React Flow selects.
          swallowClick.current = true;
          event.preventDefault();
          event.stopPropagation();
          if (event.button !== 0 || !interactable.has(pressedId)) return;
          const edit = getCommentEdit();
          if ((event.ctrlKey || event.metaKey) && edit !== null) {
            toggleCommentTarget(edit.commentId, pressedId);
          } else {
            openElementComment(pressedId);
          }
          return;
        }

        // The box-select binding opens a box over the pane; while a card is
        // open the box gathers targets for it, and keeping focus keeps the
        // card open.
        if (overlay && boxSelectGesture(event) !== null && getCommentEdit() !== null) {
          event.preventDefault();
        }

        // A begin+end binding on a mouse press: the first press opens the
        // run, the second settles it, wherever they land on the board.
        const runTrigger = beginEndMouseTrigger(event);
        if (runTrigger) {
          event.preventDefault();
          event.stopPropagation();
          swallowClick.current = true;
          const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          if (runTrigger.id === 'box-select') {
            if (boxRun) {
              settleBoxRun();
            } else {
              setBoxRun({
                start: at,
                to: at,
                prior: new Set(store.getState().selection),
                combine: runTrigger.combine,
              });
            }
          } else if (copyDrag?.untilEnd) {
            endCopyRun(at);
          } else {
            beginCopyRun(at, target.closest<HTMLElement>('.react-flow__node')?.dataset['id'] ?? null);
          }
          return;
        }

        // Alt+drag copies what it grabs, or the whole selection when it holds
        // that element. The copies follow the pointer as ghosts and land on
        // release, so the originals stay where they are.
        const copying = duplicateTarget(event);
        if (copying !== null) {
          event.stopPropagation();
          const state = store.getState();
          const ids = state.selection.includes(copying) ? [...state.selection] : [copying];
          setCopyDrag({
            ids,
            rects: copyRects(state, ids),
            from: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
            offset: { x: 0, y: 0 },
          });
          return;
        }

        if (!pending) {
          // The box-select binding (shift+drag out of the box) opens React
          // Flow's selection box wherever the press lands on the board, so
          // the gesture is noted before any change arrives. Except that a
          // press with no modifier on an element is that element's own drag
          // or click — React Flow only cedes an element press to the box
          // while a modifier is held — so a bare-left binding must not turn
          // a node drag into a box that settles over the selection.
          const gesture = boxSelectGesture(event);
          const onElement =
            target.closest('.react-flow__node, .react-flow__edge, .edge-label') !== null;
          const withModifier =
            event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
          if (gesture && target.closest('.react-flow__pane') && (!onElement || withModifier)) {
            boxGesture.current = {
              prior: new Set(store.getState().selection),
              combine: gesture.combine,
              start: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
              forComment: overlay ? (getCommentEdit()?.commentId ?? null) : null,
            };
          }
          return;
        }
        if (!target.classList.contains('react-flow__pane')) return;
        // An armed placement near the controls is the same mis-aimed click.
        if (nearBoardControls(event.clientX, event.clientY)) return;
        event.stopPropagation();
        setDraft({ from: screenToFlowPosition({ x: event.clientX, y: event.clientY }), to: null });
      }}
      onPointerMove={(event) => {
        pointer.current = { x: event.clientX, y: event.clientY };
        if (copyDrag) {
          const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          setCopyDrag({
            ...copyDrag,
            offset: { x: at.x - copyDrag.from.x, y: at.y - copyDrag.from.y },
          });
        }
        if (boxRun) {
          setBoxRun({ ...boxRun, to: screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
        }
        if (!draft) return;
        setDraft({ ...draft, to: screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
      }}
      // A cancelled pointer never settles its gesture; the next one starts clean.
      onPointerCancel={() => {
        boxGesture.current = null;
        setCopyDrag(null);
      }}
      onPointerUp={(event) => {
        // The pane turns the rectangle on as it ends its own gesture, which
        // it does before this handler runs.
        dropSelectionRect();
        endCopyDrag(event);
        endBoxSelection(event);
        if (!draft) return;
        const end = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const width = Math.abs(end.x - draft.from.x);
        const height = Math.abs(end.y - draft.from.y);
        const dragged = width > 20 && height > 20;
        place({
          x: dragged ? Math.min(draft.from.x, end.x) : draft.from.x,
          y: dragged ? Math.min(draft.from.y, end.y) : draft.from.y,
          width: dragged ? width : 0,
          height: dragged ? height : 0,
        });
        setDraft(null);
      }}
      // No cancel handler here: the window handler above owns the cancel
      // levels, and a duplicate answering the same press disarmed the
      // placement and deselected together once the focus ring made a press
      // from inside the canvas routine (decision 025).
      tabIndex={-1}
    >
      <ArrowMarkers />
      {draft?.to && (
        <PlacementPreview from={draft.from} to={draft.to} />
      )}
      {copyDrag && <DuplicatePreview rects={copyDrag.rects} offset={copyDrag.offset} />}
      {boxRun && <BoxSelectPreview from={boxRun.start} to={boxRun.to} />}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodeDragStop={onNodeDragStop}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        // The overlay reads and discusses; the model underneath holds still.
        nodesDraggable={!overlay}
        nodesConnectable={!overlay}
        reconnectRadius={16}
        // A junction's contact points are small dots on its vertices, so a
        // line dropped near one still lands on it rather than nowhere.
        connectionRadius={45}
        // While the picker is armed the drag sizes an element, so the board
        // has to hold still: panning with it kept the flow position under the
        // pointer identical from start to finish, and every drag measured zero.
        // Otherwise the buttons come from the pan binding, always joined by
        // the left button on the empty pane.
        panOnDrag={pending ? false : panButtons()}
        onDoubleClick={onDoubleClick}
        onPaneClick={onPaneClick}
        onSelectionStart={() => setBoxSelecting(true)}
        onSelectionEnd={() => setBoxSelecting(false)}
        // Double-click creates an element, so it must not also zoom.
        zoomOnDoubleClick={false}
        // The delete binding, spelled in React Flow's combo strings (Delete
        // and Backspace out of the box). In the overlay the keys delete the
        // selected comment instead (CommentOverlay handles that), never the
        // model.
        deleteKeyCode={overlay ? null : deleteKeyCodes()}
        // React Flow matches key combinations exactly, so the box-select
        // binding expands to its shift, ctrl, and meta variants: plain
        // 'Shift' stops matching the moment ctrl joins it and the drag would
        // pan. Naming the combinations keeps the box open for the combine
        // modifiers (add, subtract).
        selectionKeyCode={selectionKeyCodes().length > 0 ? selectionKeyCodes() : null}
        // A box-select binding on the bare left button has no key for React
        // Flow to match, so the pane itself opens the box on drag.
        selectionOnDrag={selectionOnDragEnabled()}
        // Pinned so the gesture is the same on every platform.
        multiSelectionKeyCode={['Control', 'Meta']}
        // Any handle can be either end, so a line attaches to whichever side
        // of a box is nearest rather than always leaving on the right.
        connectionMode={ConnectionMode.Loose}
        // No `fitView`: it defers until nodes exist, so creating the first
        // element re-framed the board and the new element jumped away from
        // the pointer that made it. The fit control does this on request.
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <GravityGrid />
        <WarpGhosts />
        <Panel position="top-center">
          <SearchMenu />
        </Panel>
        <Panel position="top-left">
          <HiddenStrip />
        </Panel>
        <Panel position="top-right">
          <OverlayToggle />
        </Panel>
        <Controls>
          <HistoryControls />
          <ReflowControl />
          <BoardSettings />
        </Controls>
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          bgColor={MINIMAP_BG}
          maskColor="rgb(18 20 26 / 35%)"
          maskStrokeColor="#aeb7c9"
          maskStrokeWidth={1}
          nodeColor={miniMapNodeColor}
          nodeStrokeColor={miniMapNodeStrokeColor}
          nodeStrokeWidth={1.5}
          nodeClassName={miniMapNodeClassName}
          onClick={onMiniMapClick}
        />
        <DockSentinel nodes={nodes} selection={state.selection} />
        <SelectionActions />
        <RelationsMenu nodes={nodes} />
        <ExpansionMenu nodes={nodes} />
        <DockedEditor nodes={nodes} boxSelecting={boxSelecting} />
        <CommentOverlay />
        {cardGhost && (
          <ViewportPortal>
            <div
              key={cardGhost.key}
              className="comment-card-ghost"
              data-testid="comment-ghost"
              style={{
                transform: `translate(${cardGhost.at.x - COMMENT_CARD_SIZE.width / 2}px, ${cardGhost.at.y - 12}px)`,
                width: COMMENT_CARD_SIZE.width,
                height: COMMENT_CARD_SIZE.height,
              }}
            />
          </ViewportPortal>
        )}
      </ReactFlow>
    </div>
  );
}
