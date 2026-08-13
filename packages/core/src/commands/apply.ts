import {
  ARROWHEADS,
  COMMENT_CARD_SIZE,
  DEFAULT_ENTITY_SIZE,
  CONNECTION_NODE_SIZE,
  STROKE_STYLES,
  isConnection,
  isEntity,
  isEntityLayout,
  isConnectionNode,
  type Comment,
  type Connection,
  type Direction,
  type Document,
  type Element,
  type ElementKind,
  type ElementLayout,
  type ElementStyle,
  type Id,
  type Point,
  type View,
} from '../model/types.js';
import { COLOR_PATTERN } from '../model/schema.js';
import { isConnectionType, isEntityType } from '../model/paradigm.js';
import { seededExpansion } from '../query/expansion.js';
import { parseFilter } from '../query/filter.js';
import { membersOf, wouldCycle } from '../query/groups.js';
import { hiddenElementIds, suppressedConnectionIds } from '../query/view.js';
import { emptyDocument, loadDocument } from '../serialize/serialize.js';
import { isUndoable } from './undo.js';
import type {
  AppState,
  Command,
  CommandError,
  CommandResult,
  CommandType,
  DomainEvent,
  ErrorCode,
  StylePatch,
} from './types.js';

function fail(commandType: CommandType, code: ErrorCode, message: string): CommandResult {
  return { ok: false, error: { code, message, commandType } };
}

/**
 * Applies one command. Pure: it reads `state` without mutating it and returns
 * a new value. Rejections come back as `{ok: false}` and never throw, so a
 * caller can assert on the error code.
 */
export function apply(state: AppState, command: Command): CommandResult {
  if (command.type === 'undo') return moveCursor(state, state.undo.cursor - 1, command.type);
  if (command.type === 'redo') return moveCursor(state, state.undo.cursor + 1, command.type);

  const result = reduce(state, command);
  if (!result.ok || !isUndoable(command)) return result;

  // A new command discards anything undone past the cursor: once the
  // timeline diverges there is no branch for redo to come back to.
  const history = [...state.undo.history.slice(0, state.undo.cursor), command];
  return {
    ...result,
    state: { ...result.state, undo: { ...state.undo, history, cursor: history.length } },
  };
}

/**
 * Moves the history cursor and rebuilds state by refolding the command log
 * up to it, so undo works for every command without inverse logic.
 */
function moveCursor(state: AppState, cursor: number, commandType: 'undo' | 'redo'): CommandResult {
  if (cursor < 0) {
    return fail(commandType, 'nothing-to-undo', 'the history is already at its beginning');
  }
  if (cursor > state.undo.history.length) {
    return fail(commandType, 'nothing-to-redo', 'the history is already at its end');
  }

  let refolded: AppState = {
    document: emptyDocument(state.undo.base.id, state.undo.base.title),
    filter: '',
    selection: [],
    expanded: [],
    hidden: [],
    selectionHighlight: state.selectionHighlight,
    commentOverlay: state.commentOverlay,
    focusMode: state.focusMode,
    undo: { ...state.undo, cursor },
  };
  for (const command of state.undo.history.slice(0, cursor)) {
    const result = reduce(refolded, command);
    // Every history entry applied once already; a rejection here means the
    // reducer changed underneath a saved trace. Skipping it keeps the rest
    // of the history reachable.
    if (result.ok) refolded = result.state;
  }

  // Undo speaks the same event vocabulary as the commands it rewinds, so a
  // consumer reading creations and deletions (the warp animations, say)
  // reacts to a refold like any other change.
  const events: DomainEvent[] = [{ type: 'history-moved', direction: commandType, cursor }];
  const elements = refolded.document.model.elements;
  for (const id of Object.keys(elements)) {
    if (!state.document.model.elements[id]) events.push({ type: 'element-created', id });
  }
  for (const id of Object.keys(state.document.model.elements)) {
    if (!elements[id]) events.push({ type: 'element-deleted', id });
  }

  // The camera, filter, selection, and expansion are what the user is
  // looking at, not what they did: undoing a move must not also fling the
  // viewport back. They carry over, pruned to what still exists. The
  // first-open hint is an edit rather than a way of looking, so it refolds
  // with the document.
  const comments = refolded.document.comments;
  return ok(
    {
      ...refolded,
      document: {
        ...refolded.document,
        view: {
          pan: state.document.view.pan,
          zoom: state.document.view.zoom,
          ...(refolded.document.view.defaultExpanded === undefined
            ? {}
            : { defaultExpanded: refolded.document.view.defaultExpanded }),
        },
      },
      filter: state.filter,
      selection: state.selection.filter(
        (id) => elements[id] !== undefined || comments[id] !== undefined,
      ),
      expanded: state.expanded.filter((id) => elements[id] !== undefined),
      hidden: state.hidden.filter((id) => elements[id] !== undefined),
      selectionHighlight: state.selectionHighlight,
      commentOverlay: state.commentOverlay,
      focusMode: state.focusMode,
    },
    events,
  );
}

function reduce(state: AppState, command: Command): CommandResult {
  switch (command.type) {
    case 'create-entity': {
      if (state.document.model.elements[command.id]) {
        return fail(command.type, 'duplicate-id', `element ${command.id} already exists`);
      }
      const style = patchedStyle(command.type, 'entity', undefined, command.style ?? {});
      if (!style.ok) return { ok: false, error: style.error };
      const entity: Element = {
        id: command.id,
        kind: 'entity',
        type: command.entityType,
        title: command.title,
        description: '',
        tags: {},
        sources: [],
        groupId: null,
        ...(style.style === undefined ? {} : { style: style.style }),
      };
      return ok(
        withElement(state, entity, {
          ...state.document.layout,
          [command.id]: {
            x: command.position.x,
            y: command.position.y,
            width: DEFAULT_ENTITY_SIZE.width,
            height: DEFAULT_ENTITY_SIZE.height,
          },
        }),
        [{ type: 'element-created', id: command.id }],
      );
    }

    case 'create-connection-node': {
      if (state.document.model.elements[command.id]) {
        return fail(command.type, 'duplicate-id', `element ${command.id} already exists`);
      }
      const style = patchedStyle(command.type, 'connection-node', undefined, command.style ?? {});
      if (!style.ok) return { ok: false, error: style.error };
      const node: Element = {
        id: command.id,
        kind: 'connection-node',
        shape: command.shape,
        labels: {},
        title: command.title,
        description: '',
        tags: {},
        sources: [],
        groupId: null,
        ...(style.style === undefined ? {} : { style: style.style }),
      };
      return ok(
        withElement(state, node, {
          ...state.document.layout,
          [command.id]: { x: command.position.x, y: command.position.y, ...CONNECTION_NODE_SIZE },
        }),
        [{ type: 'element-created', id: command.id }],
      );
    }

    case 'set-node-shape': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (!isConnectionNode(element)) {
        return fail(command.type, 'wrong-kind', `element ${command.id} is not a node`);
      }
      return ok(withElement(state, { ...element, shape: command.shape }, state.document.layout), [
        { type: 'element-updated', id: command.id },
      ]);
    }

    case 'set-connection-label': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (!isConnectionNode(element)) {
        return fail(command.type, 'wrong-kind', `element ${command.id} is not a node`);
      }

      const connection = state.document.model.elements[command.connectionId];
      if (!connection) return unknown(command.type, command.connectionId);
      if (!isConnection(connection)) {
        return fail(
          command.type,
          'wrong-kind',
          `element ${command.connectionId} is not a connection`,
        );
      }
      // A label says why this branch is taken, so it only means anything on a
      // line that actually touches the junction.
      if (![...connection.from, ...connection.to].includes(command.id)) {
        return fail(
          command.type,
          'invalid-endpoint',
          `connection ${command.connectionId} does not touch node ${command.id}`,
        );
      }

      const labels = { ...element.labels };
      if (command.label === '') delete labels[command.connectionId];
      else labels[command.connectionId] = command.label;

      return ok(withElement(state, { ...element, labels }, state.document.layout), [
        { type: 'element-updated', id: command.id },
      ]);
    }

    case 'create-connection': {
      if (state.document.model.elements[command.id]) {
        return fail(command.type, 'duplicate-id', `element ${command.id} already exists`);
      }
      const endpointError = checkEndpoints(state, command.type, command.from, command.to);
      if (endpointError) return { ok: false, error: endpointError };
      const style = patchedStyle(command.type, 'connection', undefined, command.style ?? {});
      if (!style.ok) return { ok: false, error: style.error };

      const connection: Element = {
        id: command.id,
        kind: 'connection',
        type: command.connectionType,
        title: command.title,
        description: '',
        tags: {},
        sources: [],
        groupId: null,
        from: [...command.from],
        to: [...command.to],
        direction: command.direction ?? 'forward',
        ...(style.style === undefined ? {} : { style: style.style }),
      };
      return ok(withElement(state, connection, state.document.layout), [
        { type: 'element-created', id: command.id },
      ]);
    }

    case 'duplicate-elements': {
      // Sorted, so a copy of the same set is the same copy every time.
      const pairs = Object.keys(command.idMap)
        .sort()
        .map((source) => [source, command.idMap[source] as Id] as const);

      if (pairs.length === 0) {
        return fail(command.type, 'schema-invalid', 'a duplicate needs at least one element');
      }
      if (!Number.isFinite(command.offset.x) || !Number.isFinite(command.offset.y)) {
        return fail(command.type, 'schema-invalid', 'the offset needs finite coordinates');
      }

      const minted = new Set<Id>();
      for (const [source, copy] of pairs) {
        if (!state.document.model.elements[source]) return unknown(command.type, source);
        if (state.document.model.elements[copy] || minted.has(copy)) {
          return fail(command.type, 'duplicate-id', `element ${copy} already exists`);
        }
        minted.add(copy);
      }

      const elements = { ...state.document.model.elements };
      const layout = { ...state.document.layout };
      const expanded = new Set(state.expanded);
      const events: DomainEvent[] = [];

      for (const [source, copy] of pairs) {
        const element = state.document.model.elements[source];
        if (!element) continue;
        elements[copy] = copyOf(element, copy, command.idMap);

        const entry = state.document.layout[source];
        if (entry) layout[copy] = movedLayout(entry, command.offset);

        // A copy of an open group opens too, so it draws like the thing it
        // came from rather than as a node the reader has to expand again.
        if (expanded.has(source)) {
          expanded.add(copy);
          events.push({ type: 'expansion-changed', id: copy, expanded: true });
        }
        events.push({ type: 'element-created', id: copy });
      }

      // The copies become the selection: they are what the reader is now
      // holding, and a second duplicate should repeat over them.
      const copies = pairs.map(([, copy]) => copy);
      return ok(
        {
          ...state,
          document: { ...state.document, model: { elements }, layout },
          expanded: [...expanded].sort(),
          selection: copies,
        },
        [...events, { type: 'selection-changed', ids: [...copies] }],
      );
    }

    case 'move-element': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (isConnection(element)) {
        return fail(command.type, 'wrong-kind', `element ${command.id} is a connection`);
      }
      const previous = state.document.layout[command.id];
      // Keeps both sizes, including a container's, so moving is only a move.
      const existing =
        previous && 'width' in previous ? previous : { ...DEFAULT_ENTITY_SIZE };

      return ok(
        {
          ...state,
          document: {
            ...state.document,
            layout: {
              ...state.document.layout,
              [command.id]: { ...existing, x: command.position.x, y: command.position.y },
            },
          },
        },
        [{ type: 'element-moved', id: command.id, position: command.position }],
      );
    }

    case 'reflow-layout': {
      const positionIds = Object.keys(command.positions).sort();
      const waypointIds = Object.keys(command.waypoints).sort();
      const expandedIds = Object.keys(command.expanded).sort();
      if (positionIds.length + waypointIds.length + expandedIds.length === 0) {
        return fail(command.type, 'schema-invalid', 'a reflow needs at least one change');
      }

      // Everything is checked before anything is written, so a payload
      // naming one stale id leaves the whole layout untouched.
      for (const id of positionIds) {
        const element = state.document.model.elements[id];
        if (!element && !state.document.comments[id]) return unknown(command.type, id);
        if (element && isConnection(element)) {
          return fail(command.type, 'wrong-kind', `element ${id} is a connection`);
        }
        const position = command.positions[id]!;
        if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
          return fail(command.type, 'schema-invalid', 'a position needs finite coordinates');
        }
      }
      for (const id of waypointIds) {
        const element = state.document.model.elements[id];
        if (!element) return unknown(command.type, id);
        if (!isConnection(element)) {
          return fail(command.type, 'wrong-kind', `element ${id} is not a connection`);
        }
        if (command.waypoints[id]!.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
          return fail(command.type, 'schema-invalid', 'a waypoint needs finite coordinates');
        }
      }
      for (const id of expandedIds) {
        const element = state.document.model.elements[id];
        if (!element) return unknown(command.type, id);
        if (!isEntity(element)) {
          return fail(command.type, 'wrong-kind', `element ${id} is not an entity`);
        }
        const size = command.expanded[id]!;
        if (!(size.width > 0) || !(size.height > 0)) {
          return fail(command.type, 'schema-invalid', 'width and height must be positive');
        }
      }

      const layout = { ...state.document.layout };
      // One id per changed element: a grown group is in both positions and
      // expanded, and a consumer counting ids must not see it twice.
      const events: DomainEvent[] = [
        {
          type: 'layout-reflowed',
          ids: [...new Set([...positionIds, ...waypointIds, ...expandedIds])].sort(),
        },
      ];

      for (const id of positionIds) {
        const position = command.positions[id]!;
        const previous = layout[id];
        const fallbackSize = state.document.comments[id]
          ? COMMENT_CARD_SIZE
          : isConnectionNode(state.document.model.elements[id]!)
            ? CONNECTION_NODE_SIZE
            : DEFAULT_ENTITY_SIZE;
        const existing = previous && 'width' in previous ? previous : { ...fallbackSize };
        layout[id] = { ...existing, x: position.x, y: position.y };
        events.push(
          state.document.comments[id]
            ? { type: 'comment-updated', id }
            : { type: 'element-moved', id, position: { x: position.x, y: position.y } },
        );
      }
      for (const id of waypointIds) {
        const previous = layout[id];
        const existing = previous && 'waypoints' in previous ? previous : { waypoints: [] };
        layout[id] = {
          ...existing,
          waypoints: command.waypoints[id]!.map((p) => ({ x: p.x, y: p.y })),
        };
        events.push({ type: 'element-updated', id });
      }
      for (const id of expandedIds) {
        const size = command.expanded[id]!;
        const previous = layout[id];
        const existing =
          previous && 'x' in previous ? previous : { x: 0, y: 0, ...DEFAULT_ENTITY_SIZE };
        layout[id] = { ...existing, expanded: { width: size.width, height: size.height } };
        // A moved group already announced itself; a resize alone still has to.
        if (!command.positions[id]) events.push({ type: 'element-updated', id });
      }

      return ok({ ...state, document: { ...state.document, layout } }, events);
    }

    case 'set-metadata': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      const updated: Element = {
        ...element,
        ...(command.title === undefined ? {} : { title: command.title }),
        ...(command.description === undefined ? {} : { description: command.description }),
      };
      return ok(withElement(state, updated, state.document.layout), [
        { type: 'element-updated', id: command.id },
      ]);
    }

    case 'set-tag': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (command.key === '') {
        return fail(command.type, 'schema-invalid', 'tag key must not be empty');
      }
      const updated: Element = {
        ...element,
        tags: { ...element.tags, [command.key]: [...command.values] },
      };
      return ok(withElement(state, updated, state.document.layout), [
        { type: 'element-updated', id: command.id },
      ]);
    }

    case 'remove-tag': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      const tags = { ...element.tags };
      delete tags[command.key];
      return ok(withElement(state, { ...element, tags }, state.document.layout), [
        { type: 'element-updated', id: command.id },
      ]);
    }

    case 'set-element-type': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);

      // A type belongs to a kind: an entity cannot become a 'transition'.
      if (isEntity(element)) {
        if (!isEntityType(command.elementType)) {
          return fail(
            command.type,
            'schema-invalid',
            `"${command.elementType}" is not an entity type`,
          );
        }
        return ok(
          withElement(state, { ...element, type: command.elementType }, state.document.layout),
          [{ type: 'element-updated', id: command.id }],
        );
      }

      if (isConnection(element)) {
        if (!isConnectionType(command.elementType)) {
          return fail(
            command.type,
            'schema-invalid',
            `"${command.elementType}" is not a connection type`,
          );
        }
        return ok(
          withElement(state, { ...element, type: command.elementType }, state.document.layout),
          [{ type: 'element-updated', id: command.id }],
        );
      }

      return fail(command.type, 'wrong-kind', `element ${command.id} carries no type`);
    }

    case 'convert-element': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (isConnection(element)) {
        return fail(command.type, 'wrong-kind', `element ${command.id} is a connection`);
      }

      // Everything a reader wrote survives the change: only what the two
      // kinds disagree about is replaced. The id stays, so the connections
      // reaching it are untouched.
      const { title, description, tags, sources, groupId, id } = element;
      const shared = { id, title, description, tags, sources, groupId };

      const converted: Element =
        command.to === 'connection-node' || command.to === 'decision'
          ? {
              ...shared,
              kind: 'connection-node',
              shape: command.to === 'decision' ? 'diamond' : 'circle',
              // A box that becomes a junction has answered nothing yet, and
              // one that becomes a box again drops the field with its answers.
              labels: isConnectionNode(element) ? { ...element.labels } : {},
            }
          : { ...shared, kind: 'entity', type: command.to };

      // A junction is a point; an entity is a box. Size follows the kind
      // unless the reader has already chosen one for that kind.
      const previous = state.document.layout[command.id];
      const origin = previous && 'x' in previous ? { x: previous.x, y: previous.y } : { x: 0, y: 0 };
      const size = converted.kind === 'connection-node' ? CONNECTION_NODE_SIZE : DEFAULT_ENTITY_SIZE;

      return ok(
        withElement(state, converted, {
          ...state.document.layout,
          [command.id]: { ...origin, ...size },
        }),
        [{ type: 'element-updated', id: command.id }],
      );
    }

    case 'rename-tag': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (!(command.from in element.tags)) {
        return fail(command.type, 'unknown-element', `element ${command.id} has no tag "${command.from}"`);
      }
      if (command.to.trim() === '') {
        return fail(command.type, 'schema-invalid', 'tag key must not be empty');
      }
      if (command.to !== command.from && command.to in element.tags) {
        return fail(
          command.type,
          'duplicate-id',
          `element ${command.id} already carries a tag "${command.to}"`,
        );
      }

      // Rebuilt in order so a rename keeps the tag where the reader left it.
      const tags: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(element.tags)) {
        if (key === command.from) tags[command.to] = value;
        else tags[key] = value;
      }
      return ok(withElement(state, { ...element, tags }, state.document.layout), [
        { type: 'element-updated', id: command.id },
      ]);
    }

    case 'resize-element': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (isConnection(element)) {
        return fail(command.type, 'wrong-kind', `element ${command.id} is a connection`);
      }
      if (!(command.width > 0) || !(command.height > 0)) {
        return fail(command.type, 'schema-invalid', 'width and height must be positive');
      }

      const previous = state.document.layout[command.id];
      const existing =
        previous && 'x' in previous ? previous : { x: 0, y: 0, ...DEFAULT_ENTITY_SIZE };

      // Resizes whichever box is on screen. An expanded container and the node
      // it collapses to keep their own sizes, so opening a group to work
      // inside it does not swell the box it shrinks back to.
      const next = state.expanded.includes(command.id)
        ? { ...existing, expanded: { width: command.width, height: command.height } }
        : { ...existing, width: command.width, height: command.height };

      return ok(
        {
          ...state,
          document: { ...state.document, layout: { ...state.document.layout, [command.id]: next } },
        },
        [{ type: 'element-updated', id: command.id }],
      );
    }

    case 'set-waypoints': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (!isConnection(element)) {
        return fail(command.type, 'wrong-kind', `element ${command.id} is not a connection`);
      }
      if (command.waypoints.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
        return fail(command.type, 'schema-invalid', 'a waypoint needs finite coordinates');
      }

      const previous = state.document.layout[command.id];
      const existing = previous && 'waypoints' in previous ? previous : { waypoints: [] };

      return ok(
        {
          ...state,
          document: {
            ...state.document,
            layout: {
              ...state.document.layout,
              [command.id]: {
                ...existing,
                waypoints: command.waypoints.map((p) => ({ x: p.x, y: p.y })),
              },
            },
          },
        },
        [{ type: 'element-updated', id: command.id }],
      );
    }

    case 'set-arrowheads': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (!isConnection(element)) {
        return fail(command.type, 'wrong-kind', `element ${command.id} is not a connection`);
      }

      // A head at the `from` end alone means the reader has turned the
      // connection round. Swapping the endpoints keeps one way of saying it:
      // a connection always runs from `from` to `to`.
      if (command.start && !command.end) {
        return ok(
          withElement(
            state,
            { ...element, from: [...element.to], to: [...element.from], direction: 'forward' },
            flipSides(state.document.layout, command.id),
          ),
          [{ type: 'element-updated', id: command.id }],
        );
      }

      const direction: Direction = command.end ? (command.start ? 'both' : 'forward') : 'none';
      return ok(withElement(state, { ...element, direction }, state.document.layout), [
        { type: 'element-updated', id: command.id },
      ]);
    }

    case 'set-style': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);

      const outcome = patchedStyle(command.type, element.kind, element.style, command.style);
      if (!outcome.ok) return { ok: false, error: outcome.error };

      const { style, ...rest } = element;
      void style;
      const updated = (
        outcome.style === undefined ? rest : { ...rest, style: outcome.style }
      ) as Element;
      return ok(withElement(state, updated, state.document.layout), [
        { type: 'element-updated', id: command.id },
      ]);
    }

    case 'set-connection-sides': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (!isConnection(element)) {
        return fail(command.type, 'wrong-kind', `element ${command.id} is not a connection`);
      }

      const previous = state.document.layout[command.id];
      const existing = previous && 'waypoints' in previous ? previous : { waypoints: [] };
      const { sourceSide, targetSide, ...rest } = existing;
      void sourceSide;
      void targetSide;

      return ok(
        {
          ...state,
          document: {
            ...state.document,
            layout: {
              ...state.document.layout,
              [command.id]: {
                ...rest,
                ...(command.source === null ? {} : { sourceSide: command.source }),
                ...(command.target === null ? {} : { targetSide: command.target }),
              },
            },
          },
        },
        [{ type: 'element-updated', id: command.id }],
      );
    }

    case 'set-endpoints': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (!isConnection(element)) {
        return fail(command.type, 'wrong-kind', `element ${command.id} is not a connection`);
      }
      const endpointError = checkEndpoints(state, command.type, command.from, command.to);
      if (endpointError) return { ok: false, error: endpointError };

      const updated: Connection = { ...element, from: [...command.from], to: [...command.to] };
      const moved = withElement(state, updated, state.document.layout);

      // A line dragged off a junction takes that junction's answer with it:
      // the label described a branch that no longer leaves from there.
      const touching = new Set([...updated.from, ...updated.to]);
      const elements = { ...moved.document.model.elements };
      const events: DomainEvent[] = [{ type: 'element-updated', id: command.id }];
      for (const candidate of Object.values(elements)) {
        if (!isConnectionNode(candidate)) continue;
        if (candidate.labels[command.id] === undefined || touching.has(candidate.id)) continue;
        const labels = { ...candidate.labels };
        delete labels[command.id];
        elements[candidate.id] = { ...candidate, labels };
        events.push({ type: 'element-updated', id: candidate.id });
      }

      return ok(
        { ...moved, document: { ...moved.document, model: { elements } } },
        events,
      );
    }

    case 'delete-element': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);

      const elements = { ...state.document.model.elements };
      const layout = { ...state.document.layout };
      const events: DomainEvent[] = [];

      const remove = (id: Id): void => {
        delete elements[id];
        delete layout[id];
        events.push({ type: 'element-deleted', id });
      };
      remove(command.id);

      // Members of a deleted group move up to its parent, so no groupId is
      // left pointing at something that no longer exists.
      for (const candidate of Object.values(elements)) {
        if (candidate.groupId !== command.id) continue;
        elements[candidate.id] = { ...candidate, groupId: element.groupId };
        events.push({ type: 'group-changed', id: candidate.id, groupId: element.groupId });
      }

      // Deleting an entity strips it from every connection, and a connection
      // left with no source or no target goes with it.
      for (const candidate of Object.values(elements)) {
        if (!isConnection(candidate)) continue;
        const from = candidate.from.filter((ref) => ref !== command.id);
        const to = candidate.to.filter((ref) => ref !== command.id);
        if (from.length === candidate.from.length && to.length === candidate.to.length) continue;

        if (from.length === 0 || to.length === 0) {
          remove(candidate.id);
        } else {
          elements[candidate.id] = { ...candidate, from, to };
          events.push({ type: 'element-updated', id: candidate.id });
        }
      }

      const removed = new Set(events.filter((e) => e.type === 'element-deleted').map((e) => e.id));

      // A junction's answers go with the branches they answer for, so no
      // label is left naming a line that has gone.
      for (const candidate of Object.values(elements)) {
        if (!isConnectionNode(candidate)) continue;
        const stale = Object.keys(candidate.labels).filter((ref) => removed.has(ref));
        if (stale.length === 0) continue;
        const labels = { ...candidate.labels };
        for (const ref of stale) delete labels[ref];
        elements[candidate.id] = { ...candidate, labels };
        events.push({ type: 'element-updated', id: candidate.id });
      }

      // A comment follows what it discusses: deleted targets leave its list,
      // and a comment with nothing left to discuss goes with them.
      const comments = { ...state.document.comments };
      for (const comment of Object.values(state.document.comments)) {
        const targets = comment.targets.filter((ref) => !removed.has(ref));
        if (targets.length === comment.targets.length) continue;
        if (targets.length === 0) {
          delete comments[comment.id];
          delete layout[comment.id];
          removed.add(comment.id);
          events.push({ type: 'comment-deleted', id: comment.id });
        } else {
          comments[comment.id] = { ...comment, targets };
          events.push({ type: 'comment-updated', id: comment.id });
        }
      }

      return ok(
        {
          ...state,
          document: { ...state.document, model: { elements }, comments, layout },
          selection: state.selection.filter((id) => !removed.has(id)),
          expanded: state.expanded.filter((id) => !removed.has(id)),
          hidden: state.hidden.filter((id) => !removed.has(id)),
        },
        events,
      );
    }

    case 'set-group': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);

      if (command.groupId !== null) {
        const group = state.document.model.elements[command.groupId];
        if (!group) return unknown(command.type, command.groupId);
        if (!isEntity(group)) {
          return fail(command.type, 'not-a-group', `element ${command.groupId} is not an entity`);
        }
        if (wouldCycle(state.document.model.elements, command.id, command.groupId)) {
          return fail(
            command.type,
            'group-cycle',
            `putting ${command.id} inside ${command.groupId} closes a loop`,
          );
        }
      }

      return ok(
        withElement(state, { ...element, groupId: command.groupId }, state.document.layout),
        [{ type: 'group-changed', id: command.id, groupId: command.groupId }],
      );
    }

    case 'group-elements': {
      if (state.document.model.elements[command.id]) {
        return fail(command.type, 'duplicate-id', `element ${command.id} already exists`);
      }
      // An empty group is allowed: it draws as a container you can drag
      // elements into, and stays an ordinary entity if nothing joins it.
      for (const memberId of command.memberIds) {
        if (!state.document.model.elements[memberId]) return unknown(command.type, memberId);
      }

      const group: Element = {
        id: command.id,
        kind: 'entity',
        type: 'component',
        title: command.title,
        description: '',
        tags: {},
        sources: [],
        groupId: null,
      };

      const elements: Record<Id, Element> = {
        ...state.document.model.elements,
        [command.id]: group,
      };
      const events: DomainEvent[] = [{ type: 'element-created', id: command.id }];

      for (const memberId of command.memberIds) {
        const member = elements[memberId];
        if (!member) continue;
        elements[memberId] = { ...member, groupId: command.id };
        events.push({ type: 'group-changed', id: memberId, groupId: command.id });
      }

      return ok(
        {
          ...state,
          document: {
            ...state.document,
            model: { elements },
            layout: {
              ...state.document.layout,
              [command.id]: containerBox(state, command.memberIds, command.position),
            },
          },
          selection: [command.id],
        },
        events,
      );
    }

    case 'ungroup': {
      const group = state.document.model.elements[command.id];
      if (!group) return unknown(command.type, command.id);

      const members = membersOf(state.document.model.elements, command.id);
      if (members.length === 0) {
        return fail(command.type, 'not-a-group', `element ${command.id} holds no members`);
      }

      // Members move up to whatever contained the group, so nothing is orphaned.
      const elements = { ...state.document.model.elements };
      const events: DomainEvent[] = [];
      for (const member of members) {
        elements[member.id] = { ...member, groupId: group.groupId };
        events.push({ type: 'group-changed', id: member.id, groupId: group.groupId });
      }

      return ok(
        {
          ...state,
          document: { ...state.document, model: { elements } },
          expanded: state.expanded.filter((id) => id !== command.id),
        },
        events,
      );
    }

    case 'set-expanded': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);

      const expanded = new Set(state.expanded);
      if (command.expanded) expanded.add(command.id);
      else expanded.delete(command.id);

      return ok({ ...state, expanded: [...expanded].sort() }, [
        { type: 'expansion-changed', id: command.id, expanded: command.expanded },
      ]);
    }

    case 'set-hidden': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      // A hidden connection leaves no visible remnant to bring it back from.
      // Connections leave the board only when an endpoint hides.
      if (isConnection(element)) {
        return fail(
          command.type,
          'wrong-kind',
          `element ${command.id} is a connection, which hides with its endpoints`,
        );
      }

      const hidden = new Set(state.hidden);
      if (command.hidden) hidden.add(command.id);
      else hidden.delete(command.id);
      const hiddenList = [...hidden].sort();

      const events: DomainEvent[] = [
        { type: 'visibility-changed', id: command.id, hidden: command.hidden },
      ];

      // Hiding deselects what it takes off the board: the element, anything
      // hidden with it inside a group, and the connections that leave with
      // them. A selection surviving its own hide kept the highlight muting
      // everything except invisible lines.
      let selection = state.selection;
      if (command.hidden) {
        const elements = state.document.model.elements;
        const closed = hiddenElementIds(elements, hiddenList);
        const suppressed = suppressedConnectionIds(elements, new Set(state.expanded), closed);
        selection = state.selection.filter((id) => !closed.has(id) && !suppressed.has(id));
        if (selection.length !== state.selection.length) {
          events.push({ type: 'selection-changed', ids: [...selection] });
        }
      }

      return ok({ ...state, hidden: hiddenList, selection }, events);
    }

    case 'set-selection-highlight': {
      return ok({ ...state, selectionHighlight: command.enabled }, [
        { type: 'selection-highlight-changed', enabled: command.enabled },
      ]);
    }

    case 'set-focus-mode': {
      return ok({ ...state, focusMode: command.enabled }, [
        { type: 'focus-mode-changed', enabled: command.enabled },
      ]);
    }

    case 'set-selection': {
      for (const id of command.ids) {
        if (!state.document.model.elements[id] && !state.document.comments[id]) {
          return unknown(command.type, id);
        }
      }
      return ok({ ...state, selection: [...command.ids] }, [
        { type: 'selection-changed', ids: [...command.ids] },
      ]);
    }

    case 'set-filter': {
      const parsed = parseFilter(command.expression);
      if (!parsed.ok) {
        return fail(command.type, 'invalid-filter', parsed.message);
      }
      return ok({ ...state, filter: command.expression }, [
        { type: 'filter-changed', expression: command.expression },
      ]);
    }

    case 'set-view': {
      if (!Number.isFinite(command.zoom) || command.zoom <= 0) {
        return fail(command.type, 'schema-invalid', `zoom must be a positive number`);
      }
      const view: View = {
        ...state.document.view,
        pan: { ...command.pan },
        zoom: command.zoom,
      };
      return ok({ ...state, document: { ...state.document, view } }, [
        { type: 'view-changed', view },
      ]);
    }

    case 'set-default-expanded': {
      if (Array.isArray(command.defaultExpanded)) {
        const missing = command.defaultExpanded.filter(
          (id) => !state.document.model.elements[id],
        );
        if (missing.length > 0) {
          return fail(
            command.type,
            'unknown-element',
            `no element with id ${missing.join(', ')}`,
          );
        }
      }
      const view: View = {
        pan: { ...state.document.view.pan },
        zoom: state.document.view.zoom,
        ...(command.defaultExpanded === null
          ? {}
          : {
              defaultExpanded:
                command.defaultExpanded === true ? true : [...command.defaultExpanded],
            }),
      };
      return ok({ ...state, document: { ...state.document, view } }, [
        { type: 'view-changed', view },
      ]);
    }

    case 'load-document': {
      const result = loadDocument(command.document);
      if (!result.ok) {
        const first = result.errors[0];
        const code: ErrorCode =
          first?.code === 'version-unsupported'
            ? 'version-unsupported'
            : first?.code === 'group-cycle'
              ? 'group-cycle'
              : 'schema-invalid';
        return fail(command.type, code, result.errors.map((e) => e.message).join('; '));
      }
      // Highlighting is a preference rather than a view of one document, so
      // it is the only session field a load keeps. The expanded set starts
      // as the document's first-open hint says; from here it is the
      // reader's own.
      return ok(
        {
          ...state,
          document: result.document,
          filter: '',
          selection: [],
          expanded: seededExpansion(result.document),
          hidden: [],
          selectionHighlight: state.selectionHighlight,
          commentOverlay: false,
          focusMode: false,
        },
        [{ type: 'document-loaded', id: result.document.id }],
      );
    }

    case 'merge-document': {
      const result = loadDocument(command.document);
      if (!result.ok) {
        return fail(command.type, 'schema-invalid', result.errors.map((e) => e.message).join('; '));
      }

      // Upserts by id, so a producer can regenerate one subsystem and leave
      // the rest of the document alone. With stable ids the trace then shows
      // exactly what that round changed.
      const elements = { ...state.document.model.elements };
      const comments = { ...state.document.comments };
      const layout = { ...state.document.layout };
      const events: DomainEvent[] = [];

      for (const [id, element] of Object.entries(result.document.model.elements)) {
        events.push({ type: elements[id] ? 'element-updated' : 'element-created', id });
        elements[id] = element;
        const incoming = result.document.layout[id];
        if (incoming) layout[id] = incoming;
      }
      for (const [id, comment] of Object.entries(result.document.comments)) {
        events.push({ type: comments[id] ? 'comment-updated' : 'comment-created', id });
        comments[id] = comment;
      }

      const merged = { ...state.document, model: { elements }, comments, layout };
      const check = loadDocument(merged);
      if (!check.ok) {
        return fail(
          command.type,
          'schema-invalid',
          `merging would break the document: ${check.errors.map((e) => e.message).join('; ')}`,
        );
      }

      return ok({ ...state, document: check.document }, events);
    }

    case 'set-sources': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (command.sources.some((source) => source.ref.trim() === '')) {
        return fail(command.type, 'schema-invalid', 'a source needs a ref');
      }
      const updated: Element = {
        ...element,
        sources: command.sources.map((source) => ({
          ref: source.ref,
          ...(source.note === undefined ? {} : { note: source.note }),
        })),
      };
      return ok(withElement(state, updated, state.document.layout), [
        { type: 'element-updated', id: command.id },
      ]);
    }

    case 'create-comment': {
      if (state.document.model.elements[command.id] || state.document.comments[command.id]) {
        return fail(command.type, 'duplicate-id', `${command.id} already names something in the document`);
      }
      const targetError = checkCommentTargets(state, command.type, command.targets);
      if (targetError) return { ok: false, error: targetError };

      const comment: Comment = {
        id: command.id,
        text: command.text,
        ...(command.createdAt === undefined ? {} : { createdAt: command.createdAt }),
        targets: [...new Set(command.targets)],
      };
      return ok(withComment(state, comment), [{ type: 'comment-created', id: command.id }]);
    }

    case 'set-comment-text': {
      const comment = state.document.comments[command.id];
      if (!comment) return unknownComment(command.type, command.id);
      return ok(withComment(state, { ...comment, text: command.text }), [
        { type: 'comment-updated', id: command.id },
      ]);
    }

    case 'set-comment-targets': {
      const comment = state.document.comments[command.id];
      if (!comment) return unknownComment(command.type, command.id);
      const targetError = checkCommentTargets(state, command.type, command.targets);
      if (targetError) return { ok: false, error: targetError };

      return ok(
        withComment(state, { ...comment, targets: [...new Set(command.targets)] }),
        [{ type: 'comment-updated', id: command.id }],
      );
    }

    case 'move-comment': {
      const comment = state.document.comments[command.id];
      if (!comment) return unknownComment(command.type, command.id);
      if (!Number.isFinite(command.position.x) || !Number.isFinite(command.position.y)) {
        return fail(command.type, 'schema-invalid', 'a position needs finite coordinates');
      }

      // The card's pin lives in `layout` like any other geometry: where a
      // remark is drawn says nothing about what it means.
      const previous = state.document.layout[command.id];
      const existing = previous && 'width' in previous ? previous : { ...COMMENT_CARD_SIZE };
      return ok(
        {
          ...state,
          document: {
            ...state.document,
            layout: {
              ...state.document.layout,
              [command.id]: { ...existing, x: command.position.x, y: command.position.y },
            },
          },
        },
        [{ type: 'comment-updated', id: command.id }],
      );
    }

    case 'delete-comment': {
      const comment = state.document.comments[command.id];
      if (!comment) return unknownComment(command.type, command.id);

      const comments = { ...state.document.comments };
      delete comments[command.id];
      const layout = { ...state.document.layout };
      delete layout[command.id];
      return ok(
        {
          ...state,
          document: { ...state.document, comments, layout },
          selection: state.selection.filter((id) => id !== command.id),
        },
        [{ type: 'comment-deleted', id: command.id }],
      );
    }

    case 'set-comment-overlay': {
      // Opening drops any selected elements: the overlay never shows the
      // element selection UI, and clicking an element there speaks comments.
      // A selected comment rides along, since the overlay is its home.
      const selection = command.open
        ? state.selection.filter((id) => state.document.comments[id])
        : state.selection;
      const events: DomainEvent[] = [
        { type: 'comment-overlay-changed', open: command.open },
      ];
      if (selection.length !== state.selection.length) {
        events.push({ type: 'selection-changed', ids: [...selection] });
      }
      return ok({ ...state, commentOverlay: command.open, selection }, events);
    }

    default: {
      // A caller guessing at a command name gets a rejection it can read,
      // rather than `undefined` crashing the dispatcher two frames later.
      const unknownCommand = command as { type?: unknown };
      return fail(
        String(unknownCommand.type) as CommandType,
        'unknown-command',
        `there is no command "${String(unknownCommand.type)}"`,
      );
    }
  }
}

function ok(state: AppState, events: DomainEvent[]): CommandResult {
  return { ok: true, state, events };
}

function unknown(commandType: CommandType, id: Id): CommandResult {
  return fail(commandType, 'unknown-element', `element ${id} is not in the document`);
}

function unknownComment(commandType: CommandType, id: Id): CommandResult {
  return fail(commandType, 'unknown-element', `comment ${id} is not in the document`);
}

/**
 * Each target has to be an element. An empty list is legal: a comment with
 * no targets is a general remark about the whole document.
 */
function checkCommentTargets(
  state: AppState,
  commandType: CommandType,
  targets: Id[],
): CommandError | null {
  for (const ref of targets) {
    if (!state.document.model.elements[ref]) {
      return {
        code: 'unknown-element',
        message: `element ${ref} is not in the document`,
        commandType,
      };
    }
  }
  return null;
}

function withComment(state: AppState, comment: Comment): AppState {
  return {
    ...state,
    document: {
      ...state.document,
      comments: { ...state.document.comments, [comment.id]: comment },
    },
  };
}

function checkEndpoints(
  state: AppState,
  commandType: CommandType,
  from: Id[],
  to: Id[],
): CommandError | null {
  if (from.length === 0 || to.length === 0) {
    return {
      code: 'empty-endpoints',
      message: 'a connection needs at least one source and one target',
      commandType,
    };
  }
  for (const ref of [...from, ...to]) {
    const target = state.document.model.elements[ref];
    if (!target) {
      return {
        code: 'invalid-endpoint',
        message: `endpoint ${ref} is not in the document`,
        commandType,
      };
    }
    // A node is a junction, so it is a legal endpoint. A connection is not:
    // joining one to another says nothing the model can read.
    if (isConnection(target)) {
      return {
        code: 'invalid-endpoint',
        message: `endpoint ${ref} is a connection, which cannot be an endpoint`,
        commandType,
      };
    }
  }
  for (const ref of from) {
    if (to.includes(ref)) {
      return {
        code: 'self-connection',
        message: `endpoint ${ref} is both a source and a target`,
        commandType,
      };
    }
  }
  return null;
}

/**
 * Applies a style patch and validates it against the element's kind, since a
 * trace or the runtime API can carry any string where a colour should be.
 * `undefined` leaves a field alone, `null` clears it, and a style with
 * nothing left in it comes back as `undefined` so the element drops the field
 * instead of serializing `"style": {}`.
 */
function patchedStyle(
  commandType: CommandType,
  kind: ElementKind,
  current: ElementStyle | undefined,
  patch: StylePatch,
): { ok: true; style: ElementStyle | undefined } | { ok: false; error: CommandError } {
  const invalid = (code: ErrorCode, message: string) =>
    ({ ok: false, error: { code, message, commandType } }) as const;

  if (patch.fill !== undefined && patch.fill !== null && kind === 'connection') {
    return invalid('wrong-kind', 'a connection has no fill');
  }
  if (patch.arrowhead !== undefined && patch.arrowhead !== null && kind !== 'connection') {
    return invalid('wrong-kind', `only a connection carries an arrowhead, not a ${kind}`);
  }
  for (const [field, value] of [
    ['fill', patch.fill],
    ['stroke', patch.stroke],
  ] as const) {
    if (typeof value === 'string' && !COLOR_PATTERN.test(value)) {
      return invalid('schema-invalid', `${field} must be a lowercase #rrggbb colour`);
    }
  }
  if (
    typeof patch.strokeStyle === 'string' &&
    !(STROKE_STYLES as readonly string[]).includes(patch.strokeStyle)
  ) {
    return invalid('schema-invalid', `there is no stroke style "${patch.strokeStyle}"`);
  }
  if (
    typeof patch.arrowhead === 'string' &&
    !(ARROWHEADS as readonly string[]).includes(patch.arrowhead)
  ) {
    return invalid('schema-invalid', `there is no arrowhead "${patch.arrowhead}"`);
  }

  const next: ElementStyle = { ...current };
  for (const field of ['fill', 'stroke', 'strokeStyle', 'arrowhead'] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value === null) delete next[field];
    else next[field] = value as never;
  }

  return { ok: true, style: Object.keys(next).length === 0 ? undefined : next };
}

/** Turning a connection round takes its chosen contact points with it. */
function flipSides(layout: Document['layout'], id: Id): Document['layout'] {
  const entry = layout[id];
  if (!entry || !('waypoints' in entry)) return layout;

  const { sourceSide, targetSide, ...rest } = entry;
  return {
    ...layout,
    [id]: {
      ...rest,
      // The bends run source to target, so a flip reverses them too.
      waypoints: [...entry.waypoints].reverse(),
      ...(targetSide === undefined ? {} : { sourceSide: targetSide }),
      ...(sourceSide === undefined ? {} : { targetSide: sourceSide }),
    },
  };
}

/**
 * One element copied under a new id. Every field is named rather than spread,
 * so a field added to the model has to be considered here rather than
 * silently shared between an element and its copy.
 *
 * A reference to something being copied follows the map; one reaching outside
 * it is left alone, which is how a copy made inside a group stays in it.
 */
function copyOf(element: Element, id: Id, idMap: Record<Id, Id>): Element {
  const remap = (ref: Id): Id => idMap[ref] ?? ref;
  const shared = {
    id,
    title: element.title,
    description: element.description,
    tags: Object.fromEntries(
      Object.entries(element.tags).map(([key, values]) => [key, [...values]]),
    ),
    sources: element.sources.map((source) => ({ ...source })),
    groupId: element.groupId === null ? null : remap(element.groupId),
    ...(element.style === undefined ? {} : { style: { ...element.style } }),
  };

  if (isConnection(element)) {
    return {
      ...shared,
      kind: 'connection',
      type: element.type,
      direction: element.direction,
      from: element.from.map(remap),
      to: element.to.map(remap),
    };
  }
  if (isConnectionNode(element)) {
    return {
      ...shared,
      kind: 'connection-node',
      shape: element.shape,
      // A label follows the branch it answers for, and only that branch: a
      // junction copied without its connections has nothing left to answer
      // for, so it starts blank rather than pointing at the original's lines.
      labels: Object.fromEntries(
        Object.entries(element.labels).flatMap(([ref, label]) => {
          const copied = idMap[ref];
          return copied === undefined ? [] : [[copied, label] as const];
        }),
      ),
    };
  }
  return { ...shared, kind: 'entity', type: element.type };
}

/** The same layout, shifted. A copy keeps its size, its container box, and its bends. */
function movedLayout(entry: ElementLayout, offset: Point): ElementLayout {
  if (isEntityLayout(entry)) {
    return {
      ...entry,
      x: entry.x + offset.x,
      y: entry.y + offset.y,
      ...(entry.expanded === undefined ? {} : { expanded: { ...entry.expanded } }),
    };
  }
  return {
    ...entry,
    waypoints: entry.waypoints.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y })),
  };
}

/** Room for the container header and a margin around what it holds. */
export const GROUP_PADDING = { side: 28, top: 44, bottom: 28 } as const;
/** An empty container still needs somewhere to drop things. */
export const MIN_GROUP_SIZE = { width: 260, height: 180 } as const;

/**
 * A rectangle that actually contains its members, since membership on the
 * board is decided by what sits inside the box. Without this a caller has to
 * work the geometry out itself, and a box that misses its own members hides
 * its header behind them.
 */
function containerBox(
  state: AppState,
  memberIds: Id[],
  fallback: Point,
): { x: number; y: number; width: number; height: number; expanded: { width: number; height: number } } {
  const boxes = memberIds
    .map((id) => state.document.layout[id])
    .filter((entry): entry is { x: number; y: number; width: number; height: number } =>
      entry !== undefined && 'x' in entry,
    );

  if (boxes.length === 0) {
    return { ...fallback, ...DEFAULT_ENTITY_SIZE, expanded: { ...MIN_GROUP_SIZE } };
  }

  const x = Math.min(...boxes.map((b) => b.x)) - GROUP_PADDING.side;
  const y = Math.min(...boxes.map((b) => b.y)) - GROUP_PADDING.top;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + GROUP_PADDING.side;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + GROUP_PADDING.bottom;

  // The box has to hold its members; the collapsed node stays node-sized.
  return {
    x,
    y,
    ...DEFAULT_ENTITY_SIZE,
    expanded: {
      width: Math.max(right - x, MIN_GROUP_SIZE.width),
      height: Math.max(bottom - y, MIN_GROUP_SIZE.height),
    },
  };
}

function withElement(
  state: AppState,
  element: Element,
  layout: Document['layout'],
): AppState {
  return {
    ...state,
    document: {
      ...state.document,
      model: { elements: { ...state.document.model.elements, [element.id]: element } },
      layout,
    },
  };
}

/** Applies commands in order, stopping at the first rejection. */
export function applyAll(state: AppState, commands: Command[]): CommandResult {
  let current = state;
  const events: DomainEvent[] = [];
  for (const command of commands) {
    const result = apply(current, command);
    if (!result.ok) return result;
    current = result.state;
    events.push(...result.events);
  }
  return { ok: true, state: current, events };
}
