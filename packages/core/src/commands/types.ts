import type {
  ConnectionType,
  Direction,
  Document,
  EntityType,
  NodeShape,
  Id,
  Point,
  Side,
  SourceRef,
  View,
} from '../model/types.js';

/**
 * Session state. `document` is the saved structure; the rest lives only for
 * the length of a session.
 */
export interface AppState {
  document: Document;
  /** Active tag filter expression. Empty matches everything. */
  filter: string;
  selection: Id[];
  /** Groups currently showing their members. Collapsed is the default. */
  expanded: Id[];
  /**
   * Elements the reader has put away: drawn muted, with their connections not
   * drawn at all. Like `expanded`, this is one reader's view of the domain
   * and never reaches the saved file.
   */
  hidden: Id[];
}

/**
 * Every state change goes through one of these. Commands carry explicit ids
 * so the reducer stays pure and a trace replays without a random source.
 */
export type Command =
  | { type: 'create-entity'; id: Id; entityType: EntityType; title: string; position: Point }
  | { type: 'create-connection-node'; id: Id; shape: NodeShape; title: string; position: Point }
  | { type: 'set-node-shape'; id: Id; shape: NodeShape }
  | {
      type: 'create-connection';
      id: Id;
      connectionType: ConnectionType;
      from: Id[];
      to: Id[];
      title: string;
      direction?: Direction;
    }
  | { type: 'move-element'; id: Id; position: Point }
  | { type: 'set-metadata'; id: Id; title?: string; description?: string }
  | { type: 'set-tag'; id: Id; key: string; values: string[] }
  | { type: 'remove-tag'; id: Id; key: string }
  | { type: 'rename-tag'; id: Id; from: string; to: string }
  | { type: 'resize-element'; id: Id; width: number; height: number }
  | { type: 'set-waypoints'; id: Id; waypoints: Point[] }
  | { type: 'set-arrowheads'; id: Id; start: boolean; end: boolean }
  | { type: 'set-connection-sides'; id: Id; source: Side | null; target: Side | null }
  | { type: 'set-element-type'; id: Id; elementType: EntityType | ConnectionType }
  | { type: 'convert-element'; id: Id; to: EntityType | 'connection-node' | 'decision' }
  | { type: 'set-endpoints'; id: Id; from: Id[]; to: Id[] }
  | { type: 'delete-element'; id: Id }
  | { type: 'set-group'; id: Id; groupId: Id | null }
  | { type: 'group-elements'; id: Id; title: string; memberIds: Id[]; position: Point }
  | { type: 'ungroup'; id: Id }
  | { type: 'set-expanded'; id: Id; expanded: boolean }
  | { type: 'set-hidden'; id: Id; hidden: boolean }
  | { type: 'set-selection'; ids: Id[] }
  | { type: 'set-filter'; expression: string }
  | { type: 'set-view'; pan: Point; zoom: number }
  | { type: 'set-sources'; id: Id; sources: SourceRef[] }
  | { type: 'load-document'; document: Document }
  | { type: 'merge-document'; document: Document };

export type CommandType = Command['type'];

export type ErrorCode =
  | 'unknown-element'
  | 'duplicate-id'
  | 'invalid-endpoint'
  | 'empty-endpoints'
  | 'self-connection'
  | 'invalid-filter'
  | 'groups-unsupported'
  | 'schema-invalid'
  | 'version-unsupported'
  | 'wrong-kind'
  | 'group-cycle'
  | 'not-a-group'
  | 'unknown-command';

export interface CommandError {
  code: ErrorCode;
  message: string;
  commandType: CommandType;
}

/** What changed. The UI and the trace both read these. */
export type DomainEvent =
  | { type: 'element-created'; id: Id }
  | { type: 'element-updated'; id: Id }
  | { type: 'element-moved'; id: Id; position: Point }
  | { type: 'element-deleted'; id: Id }
  | { type: 'group-changed'; id: Id; groupId: Id | null }
  | { type: 'expansion-changed'; id: Id; expanded: boolean }
  | { type: 'visibility-changed'; id: Id; hidden: boolean }
  | { type: 'selection-changed'; ids: Id[] }
  | { type: 'filter-changed'; expression: string }
  | { type: 'view-changed'; view: View }
  | { type: 'document-loaded'; id: Id };

export type CommandResult =
  | { ok: true; state: AppState; events: DomainEvent[] }
  | { ok: false; error: CommandError };
