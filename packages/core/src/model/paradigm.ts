import type { ConnectionType, EntityType } from './types.js';

/**
 * The three modelling paradigms. An entity type and a connection type belong
 * to the same paradigm, and a connection takes the type of the paradigm it
 * points at. See docs/domain-model.md.
 */
export const PARADIGM_CONNECTION: Record<EntityType, ConnectionType> = {
  state: 'transition',
  step: 'relation',
  component: 'interaction',
};

export const ENTITY_TYPES: EntityType[] = ['component', 'state', 'step'];
export const CONNECTION_TYPES: ConnectionType[] = ['interaction', 'transition', 'relation'];

/** The connection type a paradigm implies for connections into this entity. */
export function connectionTypeFor(entityType: EntityType): ConnectionType {
  return PARADIGM_CONNECTION[entityType];
}

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as string[]).includes(value);
}

export function isConnectionType(value: string): value is ConnectionType {
  return (CONNECTION_TYPES as string[]).includes(value);
}
