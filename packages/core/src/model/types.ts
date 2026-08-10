/**
 * The structure modl produces. See docs/domain-model.md.
 *
 * The model is flat: every element lives in one map keyed by id, and
 * relationships are fields holding ids. Nothing nests.
 */

export type Id = string;

/** A source backing a claim: a file and line, a ticket, a document. */
export interface SourceRef {
  ref: string;
  note?: string;
}

export type EntityType = 'state' | 'component' | 'step' | 'artifact';
export type ConnectionType = 'transition' | 'relation' | 'interaction';
export type NodeShape = 'circle' | 'diamond';

export const STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type StrokeStyle = (typeof STROKE_STYLES)[number];

export const ARROWHEADS = ['triangle', 'open', 'diamond'] as const;
export type Arrowhead = (typeof ARROWHEADS)[number];

/**
 * The author's colours and line treatment. On the element rather than in
 * `layout` for the same reason a node's `shape` is: it is a choice the author
 * made about the element, and it should survive a re-layout and travel with
 * the element into any tool that ignores geometry. Every field is optional;
 * an absent field means the theme default.
 */
export interface ElementStyle {
  /** Background tint, `#rrggbb`. Entities and nodes; drawn mostly transparent. */
  fill?: string;
  /** Border and line colour, `#rrggbb`. */
  stroke?: string;
  strokeStyle?: StrokeStyle;
  /** Connections only: the glyph drawn at whichever ends `direction` points. */
  arrowhead?: Arrowhead;
}

export interface Point {
  x: number;
  y: number;
}

export interface ElementBase {
  id: Id;
  title: string;
  description: string;
  /**
   * Filterable labels. A key holds several values because one element often
   * belongs to more than one flow, team, or subdomain at once.
   */
  tags: Record<string, string[]>;
  /** Where the claim came from. Empty for anything drawn by hand. */
  sources: SourceRef[];
  /** Id of the entity this element collapses into. */
  groupId: Id | null;
  /** Absent means the theme default for every field. */
  style?: ElementStyle;
}

export interface Entity extends ElementBase {
  kind: 'entity';
  type: EntityType;
}

/**
 * Which way a connection reads.
 *
 * `forward` runs from `from` to `to`. `both` is a two-way interaction, and
 * `none` an association with no direction at all.
 */
export type Direction = 'forward' | 'both' | 'none';

export interface Connection extends ElementBase {
  kind: 'connection';
  type: ConnectionType;
  from: Id[];
  to: Id[];
  /**
   * Direction is part of the model, not the drawing. Once a line can attach
   * to whichever side of a box is nearest, the geometry no longer says which
   * way it runs, so the arrowheads have to mean something.
   */
  direction: Direction;
}

export interface ConnectionNode extends ElementBase {
  kind: 'connection-node';
  shape: NodeShape;
  /**
   * What each branch answers, keyed by the id of the connection it labels.
   *
   * The node's title carries the question; a label carries the answer that
   * sends a reader down one line rather than another. It lives here rather
   * than on the connection because a line running between two decisions
   * answers both of them, and one field per end would be two ways to say the
   * same thing. A key naming a connection that does not touch this node is a
   * `label-unattached` warning, not an error.
   */
  labels: Record<Id, string>;
}

export type Element = Entity | Connection | ConnectionNode;
export type ElementKind = Element['kind'];

export interface Model {
  elements: Record<Id, Element>;
}

/**
 * A remark about one or more elements: a question, an objection, a note for
 * the next reader. It discusses the model rather than describing the domain,
 * so it lives in its own map beside `model` — a consumer reading structure
 * ignores it, and a discussion never pollutes the elements it is about.
 */
export interface Comment {
  id: Id;
  text: string;
  /**
   * When the comment was written, ISO 8601. Carried by the create command
   * rather than read from a clock, so a trace replays identically. Absent on
   * comments written before the field existed.
   */
  createdAt?: string;
  /**
   * Elements this comment discusses. Empty means a general remark about the
   * whole document. An attached comment whose last target is deleted goes
   * with it: it was written against that thing, and a general one was not.
   */
  targets: Id[];
}

export interface EntityLayout {
  x: number;
  y: number;
  /** Size drawn when collapsed, or when the entity holds nothing. */
  width: number;
  height: number;
  /**
   * Size of the container drawn while expanded. Independent of the collapsed
   * size: opening a group to work inside it should not swell the box it
   * shrinks back to.
   */
  expanded?: { width: number; height: number };
}

/** Where a line meets an element. `centre` aims at the middle. */
export type Side = 'left' | 'right' | 'top' | 'bottom' | 'centre';

export interface ConnectionLayout {
  /** Hand-placed bends, in order from source to target. */
  waypoints: Point[];
  /**
   * The points a reader dragged the line onto. Layout, not structure: which
   * side of a box a line touches says nothing about the domain, so a producer
   * omits these and the renderer picks the nearest sides.
   */
  sourceSide?: Side;
  targetSide?: Side;
}

export type ElementLayout = EntityLayout | ConnectionLayout;

export interface View {
  pan: Point;
  zoom: number;
}

export interface Document {
  formatVersion: number;
  id: Id;
  title: string;
  model: Model;
  /** Discussion about the model, keyed by comment id. Not part of `model`:
   * iterating on a diagram is not describing the domain. */
  comments: Record<Id, Comment>;
  layout: Record<Id, ElementLayout>;
  view: View;
}

/**
 * Bumped on any breaking change to the format.
 *
 * 1 -> 2: tag values became lists, and elements gained `sources`.
 * 2 -> 3: connections carry `direction`, and arrowheads left `layout`.
 * 3 -> 4: a `fork` became a `connection-node`, to match the word a reader
 *         sees. "Fork" described the shape of the drawing rather than the
 *         thing, and the two names drifting apart cost more than the rename.
 * 4 -> 5: elements may carry `style`. Additive, but still a bump: a version 4
 *         build saving a version 5 file would silently strip every colour,
 *         and refusing the file is better than losing the work.
 * 5 -> 6: a connection node carries `labels`, one per connection touching it.
 *         Same reasoning as the last bump: an older build would drop the
 *         reasons someone wrote against each branch on the next save.
 * 6 -> 7: the document carries `comments`, discussion attached to elements
 *         but kept beside the model. Additive, and the bump exists for the
 *         same reason as the last two: a version 6 build would silently drop
 *         every comment on save.
 *
 * Older documents still load: the reader migrates them.
 */
export const FORMAT_VERSION = 7;
export const OLDEST_READABLE_VERSION = 1;

export const DEFAULT_ENTITY_SIZE = { width: 180, height: 72 } as const;
/** A node is a junction, drawn small so it reads as a point rather than a box. */
export const CONNECTION_NODE_SIZE = { width: 64, height: 64 } as const;
export const DEFAULT_VIEW: View = { pan: { x: 0, y: 0 }, zoom: 1 };

export function isEntity(element: Element): element is Entity {
  return element.kind === 'entity';
}

export function isConnection(element: Element): element is Connection {
  return element.kind === 'connection';
}

export function isConnectionNode(element: Element): element is ConnectionNode {
  return element.kind === 'connection-node';
}

export function isEntityLayout(layout: ElementLayout): layout is EntityLayout {
  return 'x' in layout;
}
