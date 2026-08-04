import type { ConnectionType, EntityType } from './types.js';

/**
 * The three modelling paradigms. An entity type and a connection type belong
 * to the same paradigm, and a connection takes the type of the paradigm it
 * points at. See docs/domain-model.md.
 *
 * `artifact` is absent on purpose: a record, file or message is a noun that
 * any paradigm can point at, so it has no opinion about the connections that
 * reach it. Drawing into one keeps whatever type was already chosen, and
 * never warns.
 */
export const PARADIGM_CONNECTION: Partial<Record<EntityType, ConnectionType>> = {
  state: 'transition',
  step: 'relation',
  component: 'interaction',
};

export const ENTITY_TYPES: EntityType[] = ['component', 'state', 'step', 'artifact'];
export const CONNECTION_TYPES: ConnectionType[] = ['interaction', 'transition', 'relation'];

/**
 * The connection type this entity's paradigm implies, or null when it has no
 * opinion.
 */
export function connectionTypeFor(entityType: EntityType): ConnectionType | null {
  return PARADIGM_CONNECTION[entityType] ?? null;
}

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as string[]).includes(value);
}

export function isConnectionType(value: string): value is ConnectionType {
  return (CONNECTION_TYPES as string[]).includes(value);
}
