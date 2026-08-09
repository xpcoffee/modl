import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Controls,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  DEFAULT_ENTITY_SIZE,
  connectionTypeFor,
  descendantsOf,
  isConnection,
  isEntity,
  selectionSpanOf,
  type Id,
  type Point,
  type Side,
} from '@modl/core';
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
import { PlacementPreview } from './PlacementPreview.js';
import { arm, disarm, getPending, usePending } from './placement.js';
import { HistoryControls } from './HistoryControls.js';
import { ExpansionMenu } from './ExpansionMenu.js';
import { PanRelations } from './PanRelations.js';
import { SelectionActions } from './SelectionActions.js';
import { startEditing, stopEditing, useEditingId } from './editing.js';
import { useHighlightId } from './highlight.js';
import { lastConnectionStyle, lastEntityStyle } from './styleMemory.js';
import { pressRipple, useWarpingIds } from './animations.js';
import { GravityGrid } from './GravityGrid.js';
import { MotionControl } from './MotionControl.js';
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
 * are computed from geometry and joined with (shift) or removed from
 * (ctrl+shift) the selection the gesture started with, in one dispatch.
 */
interface BoxGesture {
  /** The selection when the box opened. */
  prior: ReadonlySet<Id>;
  /** True for ctrl+shift: the boxed elements leave the selection. */
  subtract: boolean;
  /** Where the box opened, in flow coordinates. Converted at press time so
      auto-panning mid-drag cannot shift it. */
  start: Point;
}

export function Canvas() {
  const state = useAppState();
  const editingId = useEditingId();
  const highlightId = useHighlightId();
  const loadCount = useLoadCount();
  const { screenToFlowPosition, fitView, setViewport, setCenter, getViewport } = useReactFlow();

  // A selection box in flight keeps element editors shut.
  const [boxSelecting, setBoxSelecting] = useState(false);
  const boxGesture = useRef<BoxGesture | null>(null);
  // Whether the last press held ctrl or cmd, read when React Flow reports the
  // resulting selection change: a toggle also speaks for a group's members.
  const pressToggles = useRef(false);
  const pending = usePending();
  const warping = useWarpingIds();
  const [draft, setDraft] = useState<{ from: Point; to: Point | null } | null>(null);
  const options = useMemo(
    () => ({ editingId, boxSelecting, highlightId }),
    [editingId, boxSelecting, highlightId],
  );
  const derived = useMemo(
    () =>
      deriveNodes(state, options).map((node) =>
        warping.has(node.id) ? { ...node, className: 'is-warping-in' } : node,
      ),
    [state, options, warping],
  );
  const edges = useMemo(() => deriveEdges(state, options), [state, options]);

  /**
   * React Flow owns node positions while a drag is in flight, so the node
   * follows the pointer. The command fires once on drop, which keeps the
   * trace holding the position the user meant rather than every pixel.
   */
  const [nodes, setNodes] = useState(derived);
  useEffect(() => {
    // Carry each node's measured size forward. Handing React Flow a fresh
    // unmeasured object on every state change makes it hide the node until it
    // re-measures, which drops it out of hit-testing mid-interaction.
    setNodes((current) => {
      const previous = new Map(current.map((node) => [node.id, node]));
      return derived.map((node) => {
        const before = previous.get(node.id);
        return before?.measured ? { ...node, measured: before.measured } : node;
      });
    });
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
   * pan-to-relation control, an agent, a replay) actually moves the board.
   * Hand-panning never dispatches set-view, so nothing fights the pointer, and
   * a document load is left to the fitView above.
   */
  const seenView = useRef({ view: state.document.view, loads: loadCount });
  useEffect(() => {
    const prior = seenView.current;
    seenView.current = { view: state.document.view, loads: loadCount };
    if (state.document.view === prior.view || loadCount !== prior.loads) return;
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
      // A double-click on or beside the controls is a mis-aimed button press,
      // not a request for a component. Enabled buttons bubble their clicks up
      // to here, so without this a zoom spam-click drops components too.
      if (nearBoardControls(event.clientX, event.clientY)) return;

      const hit = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;

      // A double-click on the minimap is aimed at the camera, not the board.
      if (hit?.closest('.react-flow__minimap')) return;

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
      // this gesture keeps (it adds or subtracts on release). Those elements
      // stay drawn as selected so the board never shows a selection the
      // release would contradict.
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
   * A lone click on empty canvas answers with a small wave: the spot is live,
   * and a second click here creates an element.
   */
  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      stopEditing();
      pressRipple(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [screenToFlowPosition],
  );

  /**
   * Settles a box gesture on release: the nodes drawn fully inside the box
   * (the ones React Flow highlighted during the drag) and the connections
   * touching them, joined with the selection the gesture opened over, or
   * removed from it for ctrl+shift. One dispatch per gesture, and none when
   * the selection would not change.
   */
  const endBoxSelection = useCallback(
    (event: React.PointerEvent) => {
      const gesture = boxGesture.current;
      if (!gesture) return;
      boxGesture.current = null;

      const end = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const rect = {
        x: Math.min(gesture.start.x, end.x),
        y: Math.min(gesture.start.y, end.y),
        width: Math.abs(end.x - gesture.start.x),
        height: Math.abs(end.y - gesture.start.y),
      };

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

      const state = store.getState();
      const next = gesture.subtract
        ? [...gesture.prior].filter((id) => !boxed.has(id))
        : [...new Set([...gesture.prior, ...boxed])];
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
    [nodes, edges, screenToFlowPosition],
  );

  /** A press on the minimap recentres the board there, at the zoom it holds. */
  const onMiniMapClick = useCallback(
    (_: unknown, position: { x: number; y: number }) => {
      void setCenter(position.x, position.y, { zoom: getViewport().zoom, duration: 200 });
    },
    [setCenter, getViewport],
  );

  /** Muted elements stay muted in the minimap, so it mirrors the board. */
  const miniMapNodeColor = useCallback(
    (node: Node) => (node.data['dimmed'] === true ? '#242938' : '#3c4354'),
    [],
  );

  return (
    <div
      className={`canvas${pending ? ' is-placing' : ''}`}
      data-testid="canvas"
      data-placing={pending ?? undefined}
      onPointerDownCapture={(event) => {
        pressToggles.current = event.ctrlKey || event.metaKey;
        const target = event.target as HTMLElement;
        if (!pending) {
          // Shift opens React Flow's selection box wherever the press lands
          // on the board, so the gesture is noted before any change arrives.
          if (event.shiftKey && event.button === 0 && target.closest('.react-flow__pane')) {
            boxGesture.current = {
              prior: new Set(store.getState().selection),
              subtract: event.ctrlKey || event.metaKey,
              start: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
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
        if (!draft) return;
        setDraft({ ...draft, to: screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
      }}
      // A cancelled pointer never settles its box; the next gesture starts clean.
      onPointerCancel={() => {
        boxGesture.current = null;
      }}
      onPointerUp={(event) => {
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
      onKeyDown={(event) => event.key === 'Escape' && disarm()}
      tabIndex={-1}
    >
      <ArrowMarkers />
      {draft?.to && (
        <PlacementPreview from={draft.from} to={draft.to} />
      )}
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
        reconnectRadius={16}
        // A connection node's contact point is a dot at its middle. Snapping
        // from further out means a reader drops a line on the node rather
        // than pinpointing its centre.
        connectionRadius={45}
        // While the picker is armed the drag sizes an element, so the board
        // has to hold still: panning with it kept the flow position under the
        // pointer identical from start to finish, and every drag measured zero.
        panOnDrag={!pending}
        onDoubleClick={onDoubleClick}
        onPaneClick={onPaneClick}
        onSelectionStart={() => setBoxSelecting(true)}
        onSelectionEnd={() => setBoxSelecting(false)}
        // Double-click creates an element, so it must not also zoom.
        zoomOnDoubleClick={false}
        // Both keys delete, matching what either keyboard leads you to expect.
        deleteKeyCode={['Delete', 'Backspace']}
        // React Flow matches key combinations exactly, so plain 'Shift' stops
        // matching the moment ctrl joins it and ctrl+shift+drag would pan.
        // Naming the combinations keeps the box open for subtraction.
        selectionKeyCode={['Shift', 'Control+Shift', 'Meta+Shift']}
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
        <Controls>
          <HistoryControls />
          <MotionControl />
        </Controls>
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          bgColor="#171a21"
          maskColor="rgb(18 20 26 / 65%)"
          nodeColor={miniMapNodeColor}
          nodeStrokeColor="transparent"
          onClick={onMiniMapClick}
        />
        <SelectionActions nodes={nodes} />
        <PanRelations nodes={nodes} />
        <ExpansionMenu nodes={nodes} />
      </ReactFlow>
    </div>
  );
}
