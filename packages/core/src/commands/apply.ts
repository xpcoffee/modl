import {
  DEFAULT_ENTITY_SIZE,
  FORK_SIZE,
  isConnection,
  isEntity,
  isFork,
  type Connection,
  type Document,
  type Element,
  type Id,
  type Point,
} from '../model/types.js';
import { isConnectionType, isEntityType } from '../model/paradigm.js';
import { parseFilter } from '../query/filter.js';
import { membersOf, wouldCycle } from '../query/groups.js';
import { loadDocument } from '../serialize/serialize.js';
import type {
  AppState,
  Command,
  CommandError,
  CommandResult,
  CommandType,
  DomainEvent,
  ErrorCode,
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
  switch (command.type) {
    case 'create-entity': {
      if (state.document.model.elements[command.id]) {
        return fail(command.type, 'duplicate-id', `element ${command.id} already exists`);
      }
      const entity: Element = {
        id: command.id,
        kind: 'entity',
        type: command.entityType,
        title: command.title,
        description: '',
        tags: {},
        sources: [],
        groupId: null,
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

    case 'create-fork': {
      if (state.document.model.elements[command.id]) {
        return fail(command.type, 'duplicate-id', `element ${command.id} already exists`);
      }
      const fork: Element = {
        id: command.id,
        kind: 'fork',
        shape: command.shape,
        title: command.title,
        description: '',
        tags: {},
        sources: [],
        groupId: null,
      };
      return ok(
        withElement(state, fork, {
          ...state.document.layout,
          [command.id]: { x: command.position.x, y: command.position.y, ...FORK_SIZE },
        }),
        [{ type: 'element-created', id: command.id }],
      );
    }

    case 'set-fork-shape': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (!isFork(element)) {
        return fail(command.type, 'wrong-kind', `element ${command.id} is not a fork`);
      }
      return ok(withElement(state, { ...element, shape: command.shape }, state.document.layout), [
        { type: 'element-updated', id: command.id },
      ]);
    }

    case 'create-connection': {
      if (state.document.model.elements[command.id]) {
        return fail(command.type, 'duplicate-id', `element ${command.id} already exists`);
      }
      const endpointError = checkEndpoints(state, command.type, command.from, command.to);
      if (endpointError) return { ok: false, error: endpointError };

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
      };
      return ok(withElement(state, connection, state.document.layout), [
        { type: 'element-created', id: command.id },
      ]);
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

    case 'set-direction': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (!isConnection(element)) {
        return fail(command.type, 'wrong-kind', `element ${command.id} is not a connection`);
      }
      return ok(
        withElement(state, { ...element, direction: command.direction }, state.document.layout),
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
      return ok(withElement(state, updated, state.document.layout), [
        { type: 'element-updated', id: command.id },
      ]);
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
      return ok(
        {
          ...state,
          document: { ...state.document, model: { elements }, layout },
          selection: state.selection.filter((id) => !removed.has(id)),
          expanded: state.expanded.filter((id) => !removed.has(id)),
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

    case 'set-selection': {
      for (const id of command.ids) {
        if (!state.document.model.elements[id]) return unknown(command.type, id);
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
      const view = { pan: { ...command.pan }, zoom: command.zoom };
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
      return ok({ document: result.document, filter: '', selection: [], expanded: [] }, [
        { type: 'document-loaded', id: result.document.id },
      ]);
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
      const layout = { ...state.document.layout };
      const events: DomainEvent[] = [];

      for (const [id, element] of Object.entries(result.document.model.elements)) {
        events.push({ type: elements[id] ? 'element-updated' : 'element-created', id });
        elements[id] = element;
        const incoming = result.document.layout[id];
        if (incoming) layout[id] = incoming;
      }

      const merged = { ...state.document, model: { elements }, layout };
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
    // A fork is a junction, so it is a legal endpoint. A connection is not:
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

/** Room for the container header and a margin around what it holds. */
const GROUP_PADDING = { side: 28, top: 44, bottom: 28 } as const;
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
