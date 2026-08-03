import { describe, expect, it } from 'vitest';
import {
  CONNECTION_TYPES,
  ENTITY_TYPES,
  connectionTypeFor,
  isConnectionType,
  isEntityType,
} from './paradigm.js';

describe('connectionTypeFor', () => {
  it('maps each entity type to its paradigm connection', () => {
    expect(connectionTypeFor('state')).toBe('transition');
    expect(connectionTypeFor('step')).toBe('relation');
    expect(connectionTypeFor('component')).toBe('interaction');
  });

  it('covers every entity type', () => {
    for (const type of ENTITY_TYPES) {
      expect(CONNECTION_TYPES).toContain(connectionTypeFor(type));
    }
  });
});

describe('type guards', () => {
  it('accepts known types', () => {
    expect(isEntityType('component')).toBe(true);
    expect(isConnectionType('transition')).toBe(true);
  });

  it('rejects a type from the other kind', () => {
    expect(isEntityType('transition')).toBe(false);
    expect(isConnectionType('component')).toBe(false);
  });

  it('rejects nonsense', () => {
    expect(isEntityType('sprocket')).toBe(false);
    expect(isConnectionType('sprocket')).toBe(false);
  });
});
