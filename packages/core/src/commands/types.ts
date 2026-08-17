import type {
  Arrowhead,
  ConnectionType,
  Direction,
  Document,
  ElementStyle,
  EntityType,
  NodeShape,
  Id,
  Point,
  Side,
  SourceRef,
  StrokeStyle,
  View,
} from '../model/types.js';

/**
 * A partial style change. `undefined` leaves a field alone and `null` clears
 * it back to the theme default, so one command can change a colour without
 * disturbing the rest.
 */
export interface StylePatch {
  fill?: string | null;
  stroke?: string | null;
  strokeStyle?: StrokeStyle | null;
  arrowhead?: Arrowhead | null;
}

/**
 * Session state. `document` is the saved structure; the rest lives only for
 * the length of a session.
 */
export interface AppState {
  document: Document;
  /** Active tag filter expression. Empty matches everything. */
  filter: string;
  /** Ids of elements, of comments, and of notes: pointing at a remark and
   * pointing at a box are the same gesture, so they share one list. */
  selection: Id[];
  /** Groups currently showing their members. Collapsed is the default. */
  expanded: Id[];
  /**
   * The expansion set as it stood before the active filter was applied.
   * A committed filter expands every group on the path to a match; clearing
   * the filter restores this, so a search never permanently unfolds the
   * board. Null while no filter is active. Session-only, like `expanded`.
   */
  expandedBeforeFilter: Id[] | null;
  /**
   * Elements the reader has put away: drawn muted, with their connections not
   * drawn at all. Never holds a connection id: a hidden connection would have
   * no visible remnant to bring it back from, so connections only leave the
   * board when an endpoint hides. Like `expanded`, this is one reader's view
   * of the domain and never reaches the saved file.
   */
  hidden: Id[];
  /**
   * Whether an active selection mutes the rest of the board. A preference
   * rather than a view of one document, so a document load keeps it.
   */
  selectionHighlight: boolean;
  /**
   * Whether the discussion overlay is open: the model dims to a blueprint and
   * comments draw at full strength. A temporary way of looking, like
   * `expanded`, so it never reaches the saved file.
   */
  commentOverlay: boolean;
  /**
   * Whether an active filter removes non-matching elements from the board
   * instead of dimming them. A way of looking at one document, like the
   * filter itself, so a document load turns it off and it never reaches the
   * saved file.
   */
  focusMode: boolean;
  undo: UndoState;
}

/**
 * The session's undo history. Undo refolds this log up to the cursor rather
 * than inverting the last command, so every command the reducer accepts is
 * undoable without inverse logic. See docs/decisions/008-undo-redo.md.
 */
export interface UndoState {
  /** The empty document the session opened with. A refold starts here. */
  base: { id: Id; title: string };
  /** Applied commands that changed the document, in dispatch order. */
  history: Command[];
  /** How many history entries are in effect. Undo moves it back, redo forward. */
  cursor: number;
}

/**
 * Every state change goes through one of these. Commands carry explicit ids
 * so the reducer stays pure and a trace replays without a random source.
 */
export type Command =
  | {
      type: 'create-entity';
      id: Id;
      entityType: EntityType;
      title: string;
      position: Point;
      style?: ElementStyle;
    }
  | {
      type: 'create-connection-node';
      id: Id;
      shape: NodeShape;
      title: string;
      position: Point;
      style?: ElementStyle;
    }
  | { type: 'set-node-shape'; id: Id; shape: NodeShape }
  /**
   * Writes the answer a junction gives for one of its branches. An empty
   * label removes it, so there is one way to say "nothing to add" and a
   * cleared label leaves no empty string behind in the file.
   */
  | { type: 'set-connection-label'; id: Id; connectionId: Id; label: string }
  | {
      type: 'create-connection';
      id: Id;
      connectionType: ConnectionType;
      from: Id[];
      to: Id[];
      title: string;
      direction?: Direction;
      style?: ElementStyle;
    }
  /**
   * Copies elements. `idMap` names every source element and the id its copy
   * takes, so a duplicate replays without a random source, and `offset` moves
   * each copy off the thing it came from. A reference between two copied
   * elements (a member's group, a connection's ends) follows the map; one
   * reaching outside it keeps pointing at the original.
   */
  | { type: 'duplicate-elements'; idMap: Record<Id, Id>; offset: Point }
  | { type: 'move-element'; id: Id; position: Point }
  /**
   * Applies a computed layout in one step: new origins for entities, nodes,
   * and pinned comment cards, translated bends for connections, and new
   * container sizes for expanded groups. One command, so a whole-board
   * re-space is one undo step. It carries the geometry rather than the
   * request because undo refolds the log: a payload of explicit positions
   * keeps a saved trace replaying identically after the reflow algorithm
   * changes. `planReflow` computes a payload for the current board.
   */
  | {
      type: 'reflow-layout';
      positions: Record<Id, Point>;
      waypoints: Record<Id, Point[]>;
      expanded: Record<Id, { width: number; height: number }>;
    }
  | { type: 'set-metadata'; id: Id; title?: string; description?: string }
  | { type: 'set-tag'; id: Id; key: string; values: string[] }
  | { type: 'remove-tag'; id: Id; key: string }
  | { type: 'rename-tag'; id: Id; from: string; to: string }
  | { type: 'resize-element'; id: Id; width: number; height: number }
  | { type: 'set-waypoints'; id: Id; waypoints: Point[] }
  | { type: 'set-arrowheads'; id: Id; start: boolean; end: boolean }
  | { type: 'set-style'; id: Id; style: StylePatch }
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
  | { type: 'set-selection-highlight'; enabled: boolean }
  | { type: 'set-focus-mode'; enabled: boolean }
  | { type: 'set-selection'; ids: Id[] }
  | { type: 'set-filter'; expression: string }
  | { type: 'set-view'; pan: Point; zoom: number }
  /**
   * Writes the document's first-open hint: `true` opens every group on load,
   * a list opens exactly the listed groups, `null` clears the hint so the
   * document opens collapsed again. An edit to the document, unlike
   * `set-expanded`, which is the reader's session.
   */
  | { type: 'set-default-expanded'; defaultExpanded: true | Id[] | null }
  | { type: 'set-sources'; id: Id; sources: SourceRef[] }
  | {
      type: 'create-note';
      id: Id;
      text: string;
      targets: Id[];
      tags?: Record<string, string[]>;
    }
  | { type: 'set-note-text'; id: Id; text: string }
  | { type: 'set-note-targets'; id: Id; targets: Id[] }
  | { type: 'set-note-tag'; id: Id; key: string; values: string[] }
  | { type: 'remove-note-tag'; id: Id; key: string }
  /** Pins the note's card at a position of the reader's choosing. */
  | { type: 'move-note'; id: Id; position: Point }
  | { type: 'delete-note'; id: Id }
  | { type: 'create-comment'; id: Id; text: string; targets: Id[]; createdAt?: string }
  | { type: 'set-comment-text'; id: Id; text: string }
  | { type: 'set-comment-targets'; id: Id; targets: Id[] }
  /** Pins the comment's card at a position of the reader's choosing. */
  | { type: 'move-comment'; id: Id; position: Point }
  | { type: 'delete-comment'; id: Id }
  | { type: 'set-comment-overlay'; open: boolean }
  | { type: 'load-document'; document: Document }
  /**
   * Swaps in a document that arrived from the open file while the reader is
   * working, already merged with what the board holds. Unlike `load-document`
   * it keeps the session: the selection, the filter, the expanded groups, and
   * the camera all survive, so a write by an agent does not restage the board.
   * It carries the merged result rather than the file's own content, so a
   * trace replays to the same board. See docs/decisions/032-file-sync.md.
   */
  | { type: 'sync-document'; document: Document }
  | { type: 'merge-document'; document: Document }
  | { type: 'undo' }
  | { type: 'redo' };

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
  | 'unknown-command'
  | 'nothing-to-undo'
  | 'nothing-to-redo';

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
  /**
   * A reflow moved `ids` in one step. Alongside the per-element moves so a
   * consumer animating the whole change (the canvas glide) reacts to the
   * command once rather than guessing from a count of moves.
   */
  | { type: 'layout-reflowed'; ids: Id[] }
  | { type: 'element-deleted'; id: Id }
  | { type: 'note-created'; id: Id }
  | { type: 'note-updated'; id: Id }
  | { type: 'note-deleted'; id: Id }
  | { type: 'comment-created'; id: Id }
  | { type: 'comment-updated'; id: Id }
  | { type: 'comment-deleted'; id: Id }
  | { type: 'comment-overlay-changed'; open: boolean }
  | { type: 'group-changed'; id: Id; groupId: Id | null }
  | { type: 'expansion-changed'; id: Id; expanded: boolean }
  | { type: 'visibility-changed'; id: Id; hidden: boolean }
  | { type: 'selection-highlight-changed'; enabled: boolean }
  | { type: 'focus-mode-changed'; enabled: boolean }
  | { type: 'selection-changed'; ids: Id[] }
  | { type: 'filter-changed'; expression: string }
  | { type: 'view-changed'; view: View }
  | { type: 'document-loaded'; id: Id }
  /**
   * The open file changed under the board and the merged result is now in
   * state. Separate from `document-loaded` because nobody asked for it: the
   * canvas frames a load and holds the camera still for a sync.
   */
  | { type: 'document-synced'; id: Id }
  | { type: 'history-moved'; direction: 'undo' | 'redo'; cursor: number };

export type CommandResult =
  | { ok: true; state: AppState; events: DomainEvent[] }
  | { ok: false; error: CommandError };
