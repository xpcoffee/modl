import { documentSchema } from './schema.js';
import { PARADIGM_CONNECTION } from './paradigm.js';
import { cyclicGroupIds } from '../query/groups.js';
import { migrateDocument } from '../serialize/migrate.js';
import {
  FORMAT_VERSION,
  isConnection,
  isEntity,
  type Connection,
  type ConnectionType,
  type Document,
  type Element,
  type Id,
} from './types.js';

export type IssueCode =
  // errors
  | 'version-unsupported'
  | 'schema-invalid'
  | 'id-key-mismatch'
  | 'unknown-reference'
  | 'group-cycle'
  | 'not-a-group'
  // warnings
  | 'paradigm-mismatch'
  | 'empty-endpoints'
  | 'orphan-entity'
  | 'duplicate-title'
  | 'connection-node-one-sided'
  | 'label-unattached';

export interface Issue {
  code: IssueCode;
  /** The element the issue concerns, absent for document-level issues. */
  elementId?: Id;
  message: string;
}

export interface ValidationResult {
  errors: Issue[];
  warnings: Issue[];
}

/**
 * Checks a parsed document. Never throws.
 *
 * Errors make a document invalid and a loader refuses it. Warnings are
 * advisory: the document loads and renders with the elements marked.
 */
export function validateDocument(input: unknown): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  const upgraded = migrateDocument(input);
  if (!upgraded.ok) {
    errors.push({ code: 'version-unsupported', message: upgraded.message });
    return { errors, warnings };
  }

  const parsed = documentSchema.safeParse(upgraded.document);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      errors.push({
        code: 'schema-invalid',
        message: path ? `${path}: ${issue.message}` : issue.message,
      });
    }
    return { errors, warnings };
  }

  const document = parsed.data as Document;

  const elements = document.model.elements;
  const known = new Set(Object.keys(elements));

  for (const [key, element] of Object.entries(elements)) {
    if (key !== element.id) {
      errors.push({
        code: 'id-key-mismatch',
        elementId: element.id,
        message: `element keyed as ${key} carries id ${element.id}`,
      });
    }

    if (element.groupId !== null) {
      if (!known.has(element.groupId)) {
        errors.push({
          code: 'unknown-reference',
          elementId: element.id,
          message: `groupId ${element.groupId} names no element in the document`,
        });
      } else {
        const group = elements[element.groupId];
        if (group && !isEntity(group)) {
          errors.push({
            code: 'not-a-group',
            elementId: element.id,
            message: `groupId ${element.groupId} names a ${group.kind}, groups are entities`,
          });
        }
      }
    }

    if (isConnection(element)) {
      for (const ref of [...element.from, ...element.to]) {
        if (!known.has(ref)) {
          errors.push({
            code: 'unknown-reference',
            elementId: element.id,
            message: `endpoint ${ref} names no element in the document`,
          });
        }
      }
      if (element.from.length === 0 || element.to.length === 0) {
        warnings.push({
          code: 'empty-endpoints',
          elementId: element.id,
          message: 'connection has no source or no target',
        });
      }
      warnings.push(...paradigmWarnings(element, elements));
    }
  }

  for (const id of cyclicGroupIds(elements)) {
    errors.push({
      code: 'group-cycle',
      elementId: id,
      message: 'groupId chain closes a loop',
    });
  }

  const connected = new Set<Id>();
  for (const element of Object.values(elements)) {
    if (isConnection(element)) {
      for (const ref of [...element.from, ...element.to]) connected.add(ref);
    }
  }
  // A container's connections are its members' connections, so a group that
  // holds something is doing its job without any of its own.
  const containers = new Set<Id>();
  for (const element of Object.values(elements)) {
    if (element.groupId !== null) containers.add(element.groupId);
  }

  for (const element of Object.values(elements)) {
    if (!isEntity(element)) continue;
    if (connected.has(element.id) || containers.has(element.id)) continue;
    warnings.push({
      code: 'orphan-entity',
      elementId: element.id,
      message: 'entity has no connections',
    });
  }

  // A node is a junction. One that only receives, or only sends, is a dead
  // end that reads as a mistake.
  for (const element of Object.values(elements)) {
    if (element.kind !== 'connection-node') continue;
    let incoming = 0;
    let outgoing = 0;
    for (const candidate of Object.values(elements)) {
      if (!isConnection(candidate)) continue;
      if (candidate.to.includes(element.id)) incoming += 1;
      if (candidate.from.includes(element.id)) outgoing += 1;
    }
    if (incoming === 0 || outgoing === 0) {
      warnings.push({
        code: 'connection-node-one-sided',
        elementId: element.id,
        message: `node has ${incoming} incoming and ${outgoing} outgoing connections`,
      });
    }

    // A label answers for one branch, so it has to name a line that actually
    // leaves or arrives here. A stale key is advisory rather than fatal: a
    // sentence someone wrote is worth keeping until they say otherwise.
    for (const ref of Object.keys(element.labels).sort()) {
      const labelled = elements[ref];
      const attached =
        labelled !== undefined &&
        isConnection(labelled) &&
        [...labelled.from, ...labelled.to].includes(element.id);
      if (!attached) {
        warnings.push({
          code: 'label-unattached',
          elementId: element.id,
          message: `label names ${ref}, which is not a connection touching this node`,
        });
      }
    }
  }

  // Scoped to siblings. The same role name inside two different groups reads
  // naturally, and warning about it pushes producers into awkward names.
  const byTitle = new Map<string, Id[]>();
  for (const element of Object.values(elements)) {
    if (element.title === '') continue;
    const scope = `${element.groupId ?? ''}\u0000${element.title}`;
    const seen = byTitle.get(scope) ?? [];
    seen.push(element.id);
    byTitle.set(scope, seen);
  }
  for (const [scope, ids] of byTitle) {
    if (ids.length < 2) continue;
    const title = scope.split('\u0000')[1] ?? '';
    for (const id of ids) {
      warnings.push({
        code: 'duplicate-title',
        elementId: id,
        message: `title "${title}" is shared by ${ids.length} elements in the same group`,
      });
    }
  }

  return { errors, warnings };
}

/**
 * A connection takes the type of the paradigm it points at. Warns when it
 * carries a different one, and stays quiet when the targets disagree with
 * each other so a legal cross-paradigm connection produces no noise.
 */
function paradigmWarnings(connection: Connection, elements: Record<Id, Element>): Issue[] {
  const expected = new Set<ConnectionType>();
  for (const id of connection.to) {
    const target = elements[id];
    if (!target || !isEntity(target)) continue;
    // An artifact has no paradigm, so it never contradicts a connection.
    const implied = PARADIGM_CONNECTION[target.type];
    if (implied) expected.add(implied);
  }

  if (expected.size === 0 || expected.has(connection.type)) return [];

  return [
    {
      code: 'paradigm-mismatch',
      elementId: connection.id,
      message: `connection type "${connection.type}" mismatches its targets, expected ${[...expected].join(' or ')}`,
    },
  ];
}

/** True when the document has no errors, so a loader accepts it. */
export function isLoadable(result: ValidationResult): boolean {
  return result.errors.length === 0;
}

export { FORMAT_VERSION };
