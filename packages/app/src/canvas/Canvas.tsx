import { useCallback, useMemo } from 'react';
import {
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
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { connectionIdFromEdge, deriveEdges, deriveNodes, type EntityNodeData } from './derive.js';
import { EntityNode } from './EntityNode.js';

const NODE_TYPES = { entity: EntityNode };

/** The subset of a React Flow change this app acts on. */
interface CanvasChange {
  type: string;
  id?: string;
  selected?: boolean;
}

export function Canvas() {
  const state = useAppState();
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useMemo(() => deriveNodes(state), [state]);
  const edges = useMemo(() => deriveEdges(state), [state]);

  /**
   * React Flow moves a node internally during a drag. The command fires once
   * on drop, so the trace records intent instead of every mouse position.
   */
  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    store.dispatch({ type: 'move-element', id: node.id, position: node.position });
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    store.dispatch({
      type: 'create-connection',
      id: crypto.randomUUID(),
      connectionType: 'interaction',
      from: [connection.source],
      to: [connection.target],
      title: '',
    });
  }, []);

  const onPaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      store.dispatch({
        type: 'create-entity',
        id: crypto.randomUUID(),
        entityType: 'component',
        title: 'New component',
        position,
      });
    },
    [screenToFlowPosition],
  );

  /**
   * React Flow is controlled here, so its selection and removal changes only
   * take effect once they come back through the command bus.
   */
  const applyChanges = useCallback(
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
    (changes: NodeChange<Node<EntityNodeData>>[]) => applyChanges(changes, (id) => id),
    [applyChanges],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => applyChanges(changes, connectionIdFromEdge),
    [applyChanges],
  );

  return (
    <div className="canvas" data-testid="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeDragStop={onNodeDragStop}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDoubleClick={onPaneDoubleClick}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
