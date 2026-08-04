import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { expectMatchesGolden } from '../test-support/golden.js';
import { fnv1a32, readableName } from './readable-name.js';
import { ADJECTIVES, NOUNS } from './words.js';

const GOLDEN = join(import.meta.dirname, '__golden__', 'readable-names.txt');

describe('word lists', () => {
  it('hold exactly 256 entries each', () => {
    expect(ADJECTIVES).toHaveLength(256);
    expect(NOUNS).toHaveLength(256);
  });

  it('hold no duplicates', () => {
    expect(new Set(ADJECTIVES).size).toBe(256);
    expect(new Set(NOUNS).size).toBe(256);
  });

  it('hold lowercase words with no separators', () => {
    for (const word of [...ADJECTIVES, ...NOUNS]) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });
});

describe('fnv1a32', () => {
  it('matches the published test vectors', () => {
    // From the FNV reference: http://www.isthe.com/chongo/tech/comp/fnv/
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('stays within unsigned 32-bit range', () => {
    for (let i = 0; i < 1000; i += 1) {
      const hash = fnv1a32(`element-${i}`);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('readableName', () => {
  it('returns an adjective-noun pair', () => {
    const name = readableName('11111111-1111-4111-8111-111111111111');
    const [adjective, noun] = name.split('-');
    expect(ADJECTIVES).toContain(adjective);
    expect(NOUNS).toContain(noun);
  });

  it('is deterministic', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    expect(readableName(id)).toBe(readableName(id));
  });

  it('gives different ids different names most of the time', () => {
    const names = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      names.add(readableName(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`));
    }
    // 65,536 combinations, so a few collisions in 500 draws are expected.
    expect(names.size).toBeGreaterThan(490);
  });

  it('matches the recorded names for a fixed set of ids', () => {
    const ids = [
      '00000000-0000-4000-8000-000000000000',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      'ffffffff-ffff-4fff-bfff-ffffffffffff',
    ];
    const recorded = ids.map((id) => `${id} ${readableName(id)}`).join('\n');
    expectMatchesGolden(`${recorded}\n`, GOLDEN);
  });
});
