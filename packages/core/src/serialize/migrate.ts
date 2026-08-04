import { FORMAT_VERSION, OLDEST_READABLE_VERSION } from '../model/types.js';

/**
 * Brings an older document up to the current format.
 *
 * A format change should not strand the files people already have, so a
 * reader migrates rather than refusing. Writing always produces the current
 * version, so a document upgrades the first time it is saved.
 */
export type MigrationResult =
  | { ok: true; document: unknown; from: number; migrated: boolean }
  | { ok: false; message: string };

type Loose = Record<string, unknown>;

/** 1 -> 2: tag values became lists, and elements gained `sources`. */
function v1ToV2(document: Loose): Loose {
  const model = (document['model'] ?? {}) as Loose;
  const elements = (model['elements'] ?? {}) as Record<string, Loose>;

  const migrated: Record<string, Loose> = {};
  for (const [id, element] of Object.entries(elements)) {
    const tags = (element['tags'] ?? {}) as Record<string, unknown>;
    const listed: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(tags)) {
      listed[key] = Array.isArray(value) ? (value as string[]) : [String(value)];
    }
    migrated[id] = { ...element, tags: listed, sources: element['sources'] ?? [] };
  }

  return { ...document, formatVersion: 2, model: { ...model, elements: migrated } };
}

const MIGRATIONS: Record<number, (document: Loose) => Loose> = { 1: v1ToV2 };

export function migrateDocument(raw: unknown): MigrationResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'a document must be a JSON object' };
  }

  const document = raw as Loose;
  const version = document['formatVersion'];
  if (typeof version !== 'number') {
    return { ok: false, message: 'formatVersion is missing' };
  }

  if (version > FORMAT_VERSION) {
    return {
      ok: false,
      message: `formatVersion ${version} is newer than this build reads, which is ${FORMAT_VERSION}`,
    };
  }
  if (version < OLDEST_READABLE_VERSION) {
    return {
      ok: false,
      message: `formatVersion ${version} is older than this build reads, which is ${OLDEST_READABLE_VERSION}`,
    };
  }

  let current = document;
  let at = version;
  while (at < FORMAT_VERSION) {
    const step = MIGRATIONS[at];
    if (!step) return { ok: false, message: `no way to read formatVersion ${at}` };
    current = step(current);
    at += 1;
  }

  return { ok: true, document: current, from: version, migrated: version !== FORMAT_VERSION };
}
