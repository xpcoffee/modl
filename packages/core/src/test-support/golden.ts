import { readFileSync, writeFileSync } from 'node:fs';
import { expect } from 'vitest';

/**
 * Compares text against a golden file.
 *
 * A mismatch prints a diff naming the file and the command to refresh it, so
 * an agent reading the failure knows what broke and how to act.
 *
 *     UPDATE_GOLDEN=1 npm test
 */
export function expectMatchesGolden(actual: string, goldenPath: string): void {
  if (process.env['UPDATE_GOLDEN'] === '1') {
    writeFileSync(goldenPath, actual, 'utf8');
    return;
  }

  let expected: string;
  try {
    expected = readFileSync(goldenPath, 'utf8');
  } catch {
    throw new Error(
      `golden file missing: ${goldenPath}\nCreate it with: UPDATE_GOLDEN=1 npm test`,
    );
  }

  if (actual !== expected) {
    expect(actual, `golden mismatch: ${goldenPath}\nRefresh with: UPDATE_GOLDEN=1 npm test`).toBe(
      expected,
    );
  }
}
