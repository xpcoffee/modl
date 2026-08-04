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
export type ForkShape = 'circle' | 'diamond';

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
}

export interface Entity extends ElementBase {
  kind: 'entity';
  type: EntityType;
}

export interface Connection extends ElementBase {
  kind: 'connection';
  type: ConnectionType;
  from: Id[];
  to: Id[];
}

export interface Fork extends ElementBase {
  kind: 'fork';
  shape: ForkShape;
}

export type Element = Entity | Connection | Fork;
export type ElementKind = Element['kind'];

export interface Model {
  elements: Record<Id, Element>;
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

export interface ConnectionLayout {
  /** Hand-placed bends, in order from source to target. */
  waypoints: Point[];
  /** Arrowheads are presentation: `from` and `to` already carry direction. */
  arrowStart?: boolean;
  arrowEnd?: boolean;
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
  layout: Record<Id, ElementLayout>;
  view: View;
}

/**
 * Bumped on any breaking change to the format.
 *
 * 1 -> 2: tag values became lists, and elements gained `sources`. A version 1
 * document still loads: the reader migrates it.
 */
export const FORMAT_VERSION = 2;
export const OLDEST_READABLE_VERSION = 1;

export const DEFAULT_ENTITY_SIZE = { width: 180, height: 72 } as const;
/** A fork is a junction, drawn small so it reads as a point rather than a box. */
export const FORK_SIZE = { width: 64, height: 64 } as const;
export const DEFAULT_VIEW: View = { pan: { x: 0, y: 0 }, zoom: 1 };

export function isEntity(element: Element): element is Entity {
  return element.kind === 'entity';
}

export function isConnection(element: Element): element is Connection {
  return element.kind === 'connection';
}

export function isFork(element: Element): element is Fork {
  return element.kind === 'fork';
}

export function isEntityLayout(layout: ElementLayout): layout is EntityLayout {
  return 'x' in layout;
}
