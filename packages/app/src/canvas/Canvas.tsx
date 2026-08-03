import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { DEFAULT_ENTITY_SIZE, connectionTypeFor, descendantsOf, isEntity } from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import {
  connectionIdFromEdge,
  containerAt,
  deriveEdges,
  deriveNodes,
  type EntityNodeData,
} from './derive.js';
import { EntityNode } from './EntityNode.js';
import { GroupNode } from './GroupNode.js';
import { ConnectionEdge } from './ConnectionEdge.js';
import { ArrowMarkers } from './ArrowMarkers.js';
import { SelectionActions } from './SelectionActions.js';
import { getNewElementType } from './newElementType.js';
import { startEditing, stopEditing, useEditingId } from './editing.js';

const NODE_TYPES = { entity: EntityNode, group: GroupNode };
const EDGE_TYPES = { connection: ConnectionEdge };

/** The subset of a React Flow change this app acts on. */
interface CanvasChange {
  type: string;
  id?: string;
  selected?: boolean;
}

export function Canvas() {
  const state = useAppState();
  const editingId = useEditingId();
  const { screenToFlowPosition } = useReactFlow();

  // A selection box in flight keeps element editors shut.
  const [boxSelecting, setBoxSelecting] = useState(false);
  const options = useMemo(() => ({ editingId, boxSelecting }), [editingId, boxSelecting]);
  const derived = useMemo(() => deriveNodes(state, options), [state, options]);
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

  const onNodeDragStop = useCallback(
    (_: unknown, __: Node, dragged: Node<EntityNodeData>[]) => {
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
        // their old positions the moment it is expanded.
        const carriesMembers = node.data.isContainer || node.data.memberCount > 0;
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
    const target = store.getState().document.model.elements[connection.target];
    // The connection takes the paradigm of what it points at.
    const connectionType =
      target && isEntity(target) ? connectionTypeFor(target.type) : 'interaction';

    store.dispatch({
      type: 'create-connection',
      id: crypto.randomUUID(),
      connectionType,
      from: [connection.source],
      to: [connection.target],
      title: '',
    });
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
  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const hit = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;

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
      store.dispatch({
        type: 'create-entity',
        id: crypto.randomUUID(),
        entityType: getNewElementType(),
        title: `New ${getNewElementType()}`,
        position: {
          x: at.x - DEFAULT_ENTITY_SIZE.width / 2,
          y: at.y - DEFAULT_ENTITY_SIZE.height / 2,
        },
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
      const selection = new Set(store.getState().selection);
      let selectionMoved = false;

      for (const change of changes) {
        // The `add` variant carries an item rather than an id, and never applies here.
        if (change.id === undefined) continue;
        const elementId = toElementId(change.id);
        if (change.type === 'remove') {
          store.dispatch({ type: 'delete-element', id: elementId });
          selection.delete(elementId);
          selectionMoved = true;
        } else if (change.type === 'select') {
          selectionMoved = true;
          if (change.selected) selection.add(elementId);
          else selection.delete(elementId);
        }
      }

      if (!selectionMoved) return;
      const ids = [...selection].filter((id) => store.getState().document.model.elements[id]);
      store.dispatch({ type: 'set-selection', ids });
    },
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<EntityNodeData>>[]) => {
      // Position and dimension changes stay local until the drag ends.
      setNodes((current) => applyNodeChanges(changes, current));
      routeChanges(changes, (id) => id);
    },
    [routeChanges],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => routeChanges(changes, connectionIdFromEdge),
    [routeChanges],
  );

  return (
    <div className="canvas" data-testid="canvas">
      <ArrowMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodeDragStop={onNodeDragStop}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDoubleClick={onDoubleClick}
        onPaneClick={stopEditing}
        onSelectionStart={() => setBoxSelecting(true)}
        onSelectionEnd={() => setBoxSelecting(false)}
        // Double-click creates an element, so it must not also zoom.
        zoomOnDoubleClick={false}
        // Both keys delete, matching what either keyboard leads you to expect.
        deleteKeyCode={['Delete', 'Backspace']}
        // Pinned so the gesture is the same on every platform.
        multiSelectionKeyCode={['Control', 'Meta']}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <SelectionActions nodes={nodes} />
      </ReactFlow>
    </div>
  );
}
