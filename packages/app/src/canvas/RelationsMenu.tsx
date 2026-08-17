import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ViewportPortal,
  useReactFlow,
  useStore as useFlowStore,
  type Node,
} from '@xyflow/react';
import {
  focusLayoutState,
  goToTarget,
  isConnection,
  isConnectionNode,
  readableName,
  relationsOf,
  type AppState,
  type Id,
  type Relation,
} from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { setHighlight } from './highlight.js';
import { RollerMenu, type RollerOption } from './RollerMenu.js';
import { useDock, useDockedTransform } from './docking.js';
import type { BoardNodeData } from './derive.js';

function nameOf(state: AppState, id: Id): string {
  return state.document.model.elements[id]?.title || readableName(id);
}

/** The answer a junction gives for one of its branches, empty when it gives none. */
function labelOf(state: AppState, nodeId: Id, connectionId: Id): string {
  const node = state.document.model.elements[nodeId];
  if (!node || !isConnectionNode(node)) return '';
  return node.labels[connectionId] ?? '';
}

/**
 * Armed when a relation is chosen, so the destination arrives with its own
 * roller open and holding focus: a reader keeps walking the graph without
 * re-opening the menu at every stop (issue #68, revising decision 009's
 * closed arrival). Session state, like the highlight beside it.
 */
let walkTo: Id | null = null;

/** Consumes the walk arrival for this element; any mount clears a stale one. */
function takeWalkArrival(id: Id): boolean {
  const armed = walkTo === id;
  walkTo = null;
  return armed;
}

/**
 * The relations menu: a roller beside the selected element listing everything
 * it connects to on the board the reader sees, so a peer focus mode removed
 * is not offered. Turning the roller emphasises each connection on the board.
 *
 * Choosing a relation pans to its peer, unless the element is a junction, in
 * which case the roller branches: go to the peer, or write the answer this
 * junction gives for that branch (issue #12). One control rather than two
 * beside the same element, because both actions are about the same list.
 *
 * The pan is a set-view command rather than a direct camera call, so a trace
 * shows where the reader went and a replay can follow.
 */
export function RelationsMenu({ nodes }: { nodes: Node<BoardNodeData>[] }) {
  const state = useAppState();
  const { getViewport } = useReactFlow();
  const paneWidth = useFlowStore((flow) => flow.width);
  const paneHeight = useFlowStore((flow) => flow.height);
  const { docked, travelling } = useDock();
  const dockedTransform = useDockedTransform('relations', docked || travelling);

  const panTo = useCallback(
    (relation: Relation): void => {
      // Focus mode draws elements at compacted positions, so the pan reads
      // the same overlaid layout the canvas renders (issue #101). With the
      // mode off this is the state itself, and the saved position.
      const target = goToTarget(focusLayoutState(store.getState()), relation.peerId);
      if (target === null) return;
      const zoom = getViewport().zoom;
      store.dispatch({
        type: 'set-view',
        pan: {
          x: paneWidth / 2 - target.centre.x * zoom,
          y: paneHeight / 2 - target.centre.y * zoom,
        },
        zoom,
      });
      // The reader's focus moved with the camera, so selection follows: the
      // highlight lands on the destination, and its own roller takes over,
      // already open and focused so the walk can continue (decision 025).
      walkTo = relation.peerId;
      store.dispatch({ type: 'set-selection', ids: [relation.peerId] });
    },
    [getViewport, paneWidth, paneHeight],
  );

  const selectedId = state.selection.length === 1 ? state.selection[0] : undefined;
  const element = selectedId ? state.document.model.elements[selectedId] : undefined;
  const relations = selectedId && element && !isConnection(element) ? relationsOf(state, selectedId) : [];
  if (!selectedId || relations.length === 0) return null;

  const node = nodes.find((candidate) => candidate.id === selectedId);
  if (!node) return null;
  const origin = node.data.parentOrigin ?? { x: 0, y: 0 };
  const corner = {
    x: node.position.x + origin.x + (node.measured?.width ?? 0) + 10,
    y: node.position.y + origin.y,
  };
  // The anchor holds until the travel to the dock begins, and takes back over
  // when the travel home ends, so the transition has both ends to run between.
  const transform =
    docked && dockedTransform !== undefined
      ? dockedTransform
      : `translate(${corner.x}px, ${corner.y}px)`;

  return (
    <ViewportPortal>
      <div
        className={`relations-menu${travelling ? ' is-travelling' : ''}`}
        style={{ transform }}
      >
        <Steps
          key={selectedId}
          elementId={selectedId}
          relations={relations}
          state={state}
          onPan={panTo}
        />
      </div>
    </ViewportPortal>
  );
}

/** Which level of the menu is showing. */
type Step =
  | { at: 'relations' }
  | { at: 'actions'; relation: Relation }
  | { at: 'label'; relation: Relation };

/**
 * Keyed by the selected element, so moving to another one starts at the top
 * with the roller shut and no half-typed label carried across.
 */
function Steps({
  elementId,
  relations,
  state,
  onPan,
}: {
  elementId: Id;
  relations: Relation[];
  state: AppState;
  onPan: (relation: Relation) => void;
}) {
  const [step, setStep] = useState<Step>({ at: 'relations' });
  // Latched on mount: a later render must not re-open a roller the reader shut.
  const [arrivedOpen] = useState(() => takeWalkArrival(elementId));

  const emphasise = useCallback(
    (relation: Relation | null) => setHighlight(relation?.connectionId ?? null),
    [],
  );

  // The emphasis belongs to whatever is open now; a menu that goes away
  // leaves the board unmarked.
  useEffect(() => () => setHighlight(null), []);

  // A junction is the only thing with an answer to give, so it is the only
  // thing whose relations branch. Everywhere else, choosing still pans.
  const anchor = state.document.model.elements[elementId];
  const branches = anchor !== undefined && isConnectionNode(anchor);

  if (step.at === 'label') {
    return (
      <ConnectionLabelEditor
        nodeId={elementId}
        relation={step.relation}
        state={state}
        onDone={() => setStep({ at: 'relations' })}
      />
    );
  }

  if (step.at === 'actions') {
    const { relation } = step;
    const written = labelOf(state, elementId, relation.connectionId);
    const actions: RollerOption<() => void>[] = [
      {
        id: 'go',
        label: `go to ${nameOf(state, relation.peerId)}`,
        value: () => onPan(relation),
        testId: `relation-go-${relation.peerId}`,
      },
      {
        id: 'label',
        label: written ? 'edit label' : 'add label',
        ...(written ? { sublabel: written } : {}),
        value: () => setStep({ at: 'label', relation }),
        testId: `relation-label-${relation.connectionId}`,
      },
    ];

    return (
      <RollerMenu
        entranceLabel={nameOf(state, relation.peerId)}
        entranceAriaLabel={`What to do with ${nameOf(state, relation.peerId)}`}
        options={actions}
        onSelect={(act) => act()}
        align="left"
        // Already chosen from the level above, so asking for another click
        // to open this one would be asking twice. Closing it steps back.
        startOpen
        onOpenChange={(open) => {
          if (!open) setStep({ at: 'relations' });
        }}
        depth={1}
        // The submenu stands where the top-level roller stood, so it holds
        // the same slot on the focus ring.
        focusSlot="relations"
        testId="relation-actions"
      />
    );
  }

  const options: RollerOption<Relation>[] = relations.map((relation) => {
    const connection = state.document.model.elements[relation.connectionId];
    const written = branches ? labelOf(state, elementId, relation.connectionId) : '';
    return {
      id: `${relation.connectionId}:${relation.peerId}`,
      label: nameOf(state, relation.peerId),
      // The connector's own title, and failing that the answer already
      // written against it, so a reader can tell the branches apart.
      ...(connection?.title || written ? { sublabel: connection?.title || written } : {}),
      value: relation,
      testId: `relation-${relation.peerId}`,
    };
  });

  return (
    <RollerMenu
      entranceLabel={`${relations.length} →`}
      entranceAriaLabel={
        branches
          ? `${relations.length} connected, open to go to one or label it`
          : `${relations.length} connected, open to pan to one`
      }
      options={options}
      onSelect={(relation) => (branches ? setStep({ at: 'actions', relation }) : onPan(relation))}
      onActiveChange={emphasise}
      startOpen={arrivedOpen}
      focusSlot="relations"
      // The menu sits at the element's right corner, so the pills open away
      // from it: over a junction they would otherwise cover the shape.
      align="left"
      // Three pills at a time: a two-line pill is tall, and a stack of five
      // covers the board around a small element.
      depth={1}
      testId="relations-menu"
    />
  );
}

/**
 * Writes the answer a junction gives for one branch. Enter and blur commit,
 * Escape abandons, and an empty field clears the label rather than storing an
 * empty answer.
 */
function ConnectionLabelEditor({
  nodeId,
  relation,
  state,
  onDone,
}: {
  nodeId: Id;
  relation: Relation;
  state: AppState;
  onDone: () => void;
}) {
  const current = labelOf(state, nodeId, relation.connectionId);
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
      store.dispatch({
        type: 'set-connection-label',
        id: nodeId,
        connectionId: relation.connectionId,
        label: text,
      });
    }
    onDone();
  };

  return (
    <div
      className="connection-label-editor nodrag nopan nowheel"
      data-testid={`connection-label-editor-${relation.connectionId}`}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="connection-label-editor__peer">{nameOf(state, relation.peerId)}</span>
      <input
        ref={input}
        className="connection-label-editor__input"
        data-testid={`connection-label-input-${relation.connectionId}`}
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
