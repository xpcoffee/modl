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
import { connectionTypeFor, isEntity } from '@domain-mapper/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import {
  connectionIdFromEdge,
  deriveEdges,
  deriveNodes,
  type EntityNodeData,
} from './derive.js';
import { EntityNode } from './EntityNode.js';
import { GroupNode } from './GroupNode.js';
import { ConnectionEdge } from './ConnectionEdge.js';
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

  const options = useMemo(() => ({ editingId }), [editingId]);
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
      // Every selected node moves together, so each one needs its own command.
      for (const node of dragged) {
        // A node inside a group reports a position relative to it, and the
        // document stores absolute coordinates.
        const origin = node.data.parentOrigin ?? { x: 0, y: 0 };
        store.dispatch({
          type: 'move-element',
          id: node.id,
          position: { x: node.position.x + origin.x, y: node.position.y + origin.y },
        });
      }
    },
    [],
  );

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

      store.dispatch({
        type: 'create-entity',
        id: crypto.randomUUID(),
        entityType: 'component',
        title: 'New component',
        position: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
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
      </ReactFlow>
    </div>
  );
}
