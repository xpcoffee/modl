import { z } from 'zod';
import { FORMAT_VERSION } from './types.js';

/**
 * Any UUID version, lowercase. v4 for ids minted in the app; v5 lets a
 * programmatic producer derive stable ids from its own keys.
 */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const idSchema = z.string().regex(UUID_PATTERN, 'must be a lowercase UUID');

export const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const tagsSchema = z.record(z.string().min(1), z.string());

const elementBaseShape = {
  id: idSchema,
  title: z.string(),
  description: z.string(),
  tags: tagsSchema,
  groupId: idSchema.nullable(),
};

export const entitySchema = z.object({
  ...elementBaseShape,
  kind: z.literal('entity'),
  type: z.enum(['state', 'component', 'step']),
});

export const connectionSchema = z.object({
  ...elementBaseShape,
  kind: z.literal('connection'),
  type: z.enum(['transition', 'relation', 'interaction']),
  from: z.array(idSchema),
  to: z.array(idSchema),
});

export const forkSchema = z.object({
  ...elementBaseShape,
  kind: z.literal('fork'),
  shape: z.enum(['circle', 'diamond']),
});

export const elementSchema = z.discriminatedUnion('kind', [
  entitySchema,
  connectionSchema,
  forkSchema,
]);

export const entityLayoutSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export const connectionLayoutSchema = z.object({
  waypoints: z.array(pointSchema),
});

export const elementLayoutSchema = z.union([entityLayoutSchema, connectionLayoutSchema]);

export const viewSchema = z.object({
  pan: pointSchema,
  zoom: z.number().finite().positive(),
});

export const modelSchema = z.object({
  elements: z.record(idSchema, elementSchema),
});

export const documentSchema = z.object({
  formatVersion: z.number().int(),
  id: idSchema,
  title: z.string(),
  model: modelSchema,
  layout: z.record(idSchema, elementLayoutSchema).default({}),
  view: viewSchema.default({ pan: { x: 0, y: 0 }, zoom: 1 }),
});

export { FORMAT_VERSION };
