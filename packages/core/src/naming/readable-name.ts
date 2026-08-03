import { ADJECTIVES, NOUNS } from './words.js';

/**
 * FNV-1a, 32-bit, over the UTF-8 bytes of the input.
 * Documented in docs/domain-model.md so other languages reproduce it.
 */
export function fnv1a32(input: string): number {
  const bytes = new TextEncoder().encode(input);
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    // Multiply by 16777619 mod 2^32 without losing precision to float64.
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Maps an id to a stable `adjective-noun` pair for humans reading traces.
 * Derived on read and never stored in a document.
 *
 * 65,536 combinations, so names collide past a few hundred elements. Names
 * are a reading aid and ids remain the identity.
 */
export function readableName(id: string): string {
  const hash = fnv1a32(id);
  const adjective = ADJECTIVES[hash & 0xff];
  const noun = NOUNS[(hash >>> 8) & 0xff];
  return `${adjective}-${noun}`;
}
