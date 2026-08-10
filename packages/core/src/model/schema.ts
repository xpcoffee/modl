import { z } from 'zod';
import { ARROWHEADS, FORMAT_VERSION, STROKE_STYLES } from './types.js';

/**
 * Any UUID version, lowercase. The app mints v4; a producer deriving ids from
 * its own keys should mint v5 so re-running against an unchanged source gives
 * the same ids.
 */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Ids are opaque strings, so a document can be written by hand with readable
 * ids like `checkout-ui`. Requiring UUIDs everywhere meant only a program
 * could author one, and every `from` and `to` was unreadable.
 */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const idSchema = z
  .string()
  .regex(ID_PATTERN, 'must be 1-128 chars of letters, digits, dot, colon, dash or underscore');

export const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const tagsSchema = z.record(z.string().min(1), z.array(z.string()));

export const sourceSchema = z.object({
  ref: z.string().min(1),
  note: z.string().optional(),
});

/** One way to write a colour, so documents diff cleanly: lowercase #rrggbb. */
export const COLOR_PATTERN = /^#[0-9a-f]{6}$/;

export const colorSchema = z
  .string()
  .regex(COLOR_PATTERN, 'must be a lowercase #rrggbb colour');

/**
 * Style a box can carry. `fill` is meaningless on a line, so it is not here.
 * Strict, so a fill on a connection is refused rather than silently dropped.
 */
export const entityStyleSchema = z.strictObject({
  fill: colorSchema.optional(),
  stroke: colorSchema.optional(),
  strokeStyle: z.enum(STROKE_STYLES).optional(),
});

export const connectionStyleSchema = z.strictObject({
  stroke: colorSchema.optional(),
  strokeStyle: z.enum(STROKE_STYLES).optional(),
  arrowhead: z.enum(ARROWHEADS).optional(),
});

const elementBaseShape = {
  id: idSchema,
  title: z.string(),
  description: z.string(),
  tags: tagsSchema,
  sources: z.array(sourceSchema).default([]),
  groupId: idSchema.nullable(),
};

export const entitySchema = z.object({
  ...elementBaseShape,
  kind: z.literal('entity'),
  type: z.enum(['state', 'component', 'step', 'artifact']),
  style: entityStyleSchema.optional(),
});

export const connectionSchema = z.object({
  ...elementBaseShape,
  kind: z.literal('connection'),
  type: z.enum(['transition', 'relation', 'interaction']),
  from: z.array(idSchema),
  to: z.array(idSchema),
  direction: z.enum(['forward', 'both', 'none']).default('forward'),
  style: connectionStyleSchema.optional(),
});

export const connectionNodeSchema = z.object({
  ...elementBaseShape,
  kind: z.literal('connection-node'),
  shape: z.enum(['circle', 'diamond']),
  /**
   * Keyed by connection id: what each branch leaving this junction answers.
   * Defaulted, so a producer that has nothing to say about branches omits it.
   */
  labels: z.record(idSchema, z.string()).default({}),
  style: entityStyleSchema.optional(),
});

export const elementSchema = z.discriminatedUnion('kind', [
  entitySchema,
  connectionSchema,
  connectionNodeSchema,
]);

export const entityLayoutSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  expanded: z
    .object({
      width: z.number().finite().positive(),
      height: z.number().finite().positive(),
    })
    .optional(),
});

export const sideSchema = z.enum(['left', 'right', 'top', 'bottom', 'centre']);

export const connectionLayoutSchema = z.object({
  waypoints: z.array(pointSchema),
  sourceSide: sideSchema.optional(),
  targetSide: sideSchema.optional(),
});

export const elementLayoutSchema = z.union([entityLayoutSchema, connectionLayoutSchema]);

export const viewSchema = z.object({
  pan: pointSchema,
  zoom: z.number().finite().positive(),
});

export const modelSchema = z.object({
  elements: z.record(idSchema, elementSchema),
});

export const commentSchema = z.object({
  id: idSchema,
  text: z.string(),
  /** A comment discusses something: detached from everything it is noise. */
  targets: z.array(idSchema).min(1),
});

export const documentSchema = z.object({
  formatVersion: z.number().int(),
  id: idSchema,
  title: z.string(),
  model: modelSchema,
  comments: z.record(idSchema, commentSchema).default({}),
  layout: z.record(idSchema, elementLayoutSchema).default({}),
  view: viewSchema.default({ pan: { x: 0, y: 0 }, zoom: 1 }),
});

export { FORMAT_VERSION };

/**
 * The document format as JSON Schema, so a producer in another language can
 * validate before writing rather than after loading.
 */
export function documentJsonSchema(): unknown {
  return z.toJSONSchema(documentSchema, { target: 'draft-2020-12', io: 'input' });
}
