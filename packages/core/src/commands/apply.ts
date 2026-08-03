import {
  DEFAULT_ENTITY_SIZE,
  isConnection,
  isEntity,
  type Connection,
  type Document,
  type Element,
  type Id,
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
        groupId: null,
        from: [...command.from],
        to: [...command.to],
      };
      return ok(withElement(state, connection, state.document.layout), [
        { type: 'element-created', id: command.id },
      ]);
    }

    case 'move-element': {
      const element = state.document.model.elements[command.id];
      if (!element) return unknown(command.type, command.id);
      if (!isEntity(element)) {
        return fail(command.type, 'wrong-kind', `element ${command.id} is not an entity`);
      }
      const previous = state.document.layout[command.id];
      const size =
        previous && 'width' in previous
          ? { width: previous.width, height: previous.height }
          : DEFAULT_ENTITY_SIZE;

      return ok(
        {
          ...state,
          document: {
            ...state.document,
            layout: {
              ...state.document.layout,
              [command.id]: { x: command.position.x, y: command.position.y, ...size },
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
        tags: { ...element.tags, [command.key]: command.value },
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
      if (command.memberIds.length === 0) {
        return fail(command.type, 'empty-endpoints', 'a group needs at least one member');
      }
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
              [command.id]: {
                x: command.position.x,
                y: command.position.y,
                width: DEFAULT_ENTITY_SIZE.width,
                height: DEFAULT_ENTITY_SIZE.height,
              },
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
    if (!isEntity(target)) {
      return {
        code: 'invalid-endpoint',
        message: `endpoint ${ref} is a ${target.kind}, connections join entities`,
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
