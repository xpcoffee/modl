import { useCallback, useEffect, useRef, useState } from 'react';
import { ViewportPortal, type Node } from '@xyflow/react';
import {
  isConnectionNode,
  readableName,
  relationsOf,
  type AppState,
  type Id,
} from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { setHighlight } from './highlight.js';
import { clearHovered, setHovered, useHoveredId } from './hover.js';
import { RollerMenu, type RollerOption } from './RollerMenu.js';
import type { BoardNodeData } from './derive.js';

/** One line leaving or arriving at the junction, and what it reaches. */
interface Branch {
  connectionId: Id;
  /** The elements at the other end, as they appear on the board. */
  peerIds: Id[];
}

/**
 * The branches of one junction, one slot per connection.
 *
 * The issue asks for a slot per connected component; a slot is per connection
 * because that is what a label belongs to, and a connection reaching two
 * components names both on the one pill rather than offering two slots that
 * edit the same sentence.
 */
function branchesOf(state: AppState, nodeId: Id): Branch[] {
  const branches: Branch[] = [];
  for (const relation of relationsOf(state, nodeId)) {
    const existing = branches.find((branch) => branch.connectionId === relation.connectionId);
    if (existing) existing.peerIds.push(relation.peerId);
    else branches.push({ connectionId: relation.connectionId, peerIds: [relation.peerId] });
  }
  return branches;
}

function nameOf(state: AppState, id: Id): string {
  return state.document.model.elements[id]?.title || readableName(id);
}

/** The label already written against this branch, empty when there is none. */
function labelOf(state: AppState, nodeId: Id, connectionId: Id): string {
  const node = state.document.model.elements[nodeId];
  if (!node || !isConnectionNode(node)) return '';
  return node.labels[connectionId] ?? '';
}

/**
 * The connections menu (issue #12): a hover point beside a junction that opens
 * into a roller of its connections, one pill per branch showing what it
 * reaches and, underneath, the connector's own title. Turning the roller
 * highlights that connector on the board; choosing a pill opens the editor for
 * the label the junction gives that branch.
 *
 * It stands opposite pan-to-relation, which holds the right-hand corner. The
 * control is deliberately generic: components get connection points of their
 * own in issue #6, and the same roller will carry them.
 */
export function ConnectionsMenu({ nodes }: { nodes: Node<BoardNodeData>[] }) {
  const state = useAppState();
  const hoveredId = useHoveredId();
  /**
   * The junction whose label editor is open. It holds the menu in place while
   * the reader types, so moving the pointer off the node does not close the
   * field under their hands.
   */
  const [pinned, setPinned] = useState<Id | null>(null);

  const isJunction = (id: Id | null | undefined): boolean => {
    const element = id ? state.document.model.elements[id] : undefined;
    return element !== undefined && isConnectionNode(element);
  };

  const sole = state.selection.length === 1 ? state.selection[0] : undefined;
  const anchorId = isJunction(pinned)
    ? (pinned as Id)
    : isJunction(sole)
      ? (sole as Id)
      : isJunction(hoveredId)
        ? (hoveredId as Id)
        : null;

  // A junction inside a collapsed group is not on the board, so nothing to
  // hang the menu on.
  const node = anchorId ? nodes.find((candidate) => candidate.id === anchorId) : undefined;
  if (!anchorId || !node) return null;

  const branches = branchesOf(state, anchorId);
  if (branches.length === 0) return null;

  const origin = node.data.parentOrigin ?? { x: 0, y: 0 };
  const corner = { x: node.position.x + origin.x, y: node.position.y + origin.y };

  return (
    <ViewportPortal>
      <div
        className="connections-menu"
        // The trailing -100% puts the menu's right edge on the junction's left
        // edge. Its own padding holds the pill clear of the node while the box
        // still touches it, so the pointer crossing the gap keeps the hover.
        style={{ transform: `translate(${corner.x}px, ${corner.y}px) translateX(-100%)` }}
        onPointerEnter={() => setHovered(anchorId)}
        onPointerLeave={() => clearHovered(anchorId)}
      >
        <Branches
          key={anchorId}
          nodeId={anchorId}
          branches={branches}
          state={state}
          onPin={setPinned}
        />
      </div>
    </ViewportPortal>
  );
}

/**
 * Keyed by junction, so moving to another one starts with the roller shut and
 * no half-typed label carried across.
 */
function Branches({
  nodeId,
  branches,
  state,
  onPin,
}: {
  nodeId: Id;
  branches: Branch[];
  state: AppState;
  onPin: (id: Id | null) => void;
}) {
  const [editing, setEditing] = useState<Id | null>(null);

  const emphasise = useCallback(
    (branch: Branch | null) => setHighlight(branch?.connectionId ?? null),
    [],
  );

  // The highlight belongs to whatever is open now; a menu that goes away
  // leaves the board unmarked.
  useEffect(() => () => setHighlight(null), []);

  const open = useCallback(
    (branch: Branch) => {
      setEditing(branch.connectionId);
      onPin(nodeId);
    },
    [nodeId, onPin],
  );

  const close = useCallback(() => {
    setEditing(null);
    onPin(null);
  }, [onPin]);

  if (editing !== null) {
    return (
      <LabelEditor
        nodeId={nodeId}
        connectionId={editing}
        peers={branches.find((branch) => branch.connectionId === editing)?.peerIds ?? []}
        state={state}
        onDone={close}
      />
    );
  }

  const options: RollerOption<Branch>[] = branches.map((branch) => {
    const connection = state.document.model.elements[branch.connectionId];
    const written = labelOf(state, nodeId, branch.connectionId);
    return {
      id: branch.connectionId,
      label: branch.peerIds.map((peer) => nameOf(state, peer)).join(', '),
      // The connector's own title, and failing that the answer already
      // written against it, so a reader can tell which line they are about to
      // annotate either way.
      ...(connection?.title || written ? { sublabel: connection?.title || written } : {}),
      value: branch,
      testId: `connection-pill-${branch.connectionId}`,
    };
  });

  return (
    <RollerMenu
      entranceLabel={`${branches.length} ⋔`}
      entranceAriaLabel={`${branches.length} connections, open to label one`}
      options={options}
      onSelect={open}
      onActiveChange={emphasise}
      steppers
      // The junction is small, so the pills hang off the menu's right edge
      // and open away from it rather than across it.
      align="right"
      // Three pills at a time: a two-line pill is tall, and a stack of five
      // covers the board around the junction.
      depth={1}
      testId="connections-menu"
    />
  );
}

/**
 * The label editor for one branch. Enter and blur commit, Escape abandons, and
 * an empty field clears the label rather than storing an empty answer.
 */
function LabelEditor({
  nodeId,
  connectionId,
  peers,
  state,
  onDone,
}: {
  nodeId: Id;
  connectionId: Id;
  peers: Id[];
  state: AppState;
  onDone: () => void;
}) {
  const current = labelOf(state, nodeId, connectionId);
  const [text, setText] = useState(current);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const finish = (commit: boolean): void => {
    if (done.current) return;
    done.current = true;
    if (commit && text !== current) {
      store.dispatch({ type: 'set-connection-label', id: nodeId, connectionId, label: text });
    }
    onDone();
  };

  return (
    <div
      className="connection-label-editor nodrag nopan nowheel"
      data-testid={`connection-label-editor-${connectionId}`}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="connection-label-editor__peer">
        {peers.map((peer) => nameOf(state, peer)).join(', ')}
      </span>
      <input
        ref={input}
        className="connection-label-editor__input"
        data-testid={`connection-label-input-${connectionId}`}
        aria-label="Why this branch is taken"
        placeholder="why this way?"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') finish(true);
          if (event.key === 'Escape') finish(false);
          // Delete edits the text rather than removing the element.
          event.stopPropagation();
        }}
      />
    </div>
  );
}
