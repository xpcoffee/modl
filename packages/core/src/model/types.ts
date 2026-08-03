/**
 * The structure modl produces. See docs/domain-model.md.
 *
 * The model is flat: every element lives in one map keyed by id, and
 * relationships are fields holding ids. Nothing nests.
 */

export type Id = string;

export type EntityType = 'state' | 'component' | 'step';
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
  tags: Record<string, string>;
  /** Id of the entity this element collapses into. Always null in iteration 1. */
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
  width: number;
  height: number;
}

export interface ConnectionLayout {
  waypoints: Point[];
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

/** Bumped on any breaking change to the document format. */
export const FORMAT_VERSION = 1;

export const DEFAULT_ENTITY_SIZE = { width: 180, height: 72 } as const;
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
