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

/**
 * 2 -> 3: connections carry `direction`, and arrowheads left `layout`.
 *
 * Arrowheads used to be presentation, off by default, because `from` and `to`
 * carried the direction and a line always left the right side of a box. Now
 * that a line attaches to whichever side is nearest, the arrowhead is what
 * tells a reader which way it runs, so it belongs to the model.
 */
function v2ToV3(document: Loose): Loose {
  const model = (document['model'] ?? {}) as Loose;
  const elements = (model['elements'] ?? {}) as Record<string, Loose>;
  const layout = (document['layout'] ?? {}) as Record<string, Loose>;

  const migrated: Record<string, Loose> = {};
  for (const [id, element] of Object.entries(elements)) {
    if (element['kind'] !== 'connection') {
      migrated[id] = element;
      continue;
    }
    // A line drawn with a head at each end was already saying "both ways".
    // Anything else read as running from `from` to `to`.
    const box = layout[id] ?? {};
    const both = box['arrowStart'] === true && box['arrowEnd'] === true;
    migrated[id] = { ...element, direction: both ? 'both' : 'forward' };
  }

  const cleaned: Record<string, Loose> = {};
  for (const [id, box] of Object.entries(layout)) {
    const { arrowStart, arrowEnd, ...rest } = box;
    void arrowStart;
    void arrowEnd;
    cleaned[id] = rest;
  }

  return {
    ...document,
    formatVersion: 3,
    model: { ...model, elements: migrated },
    layout: cleaned,
  };
}

/** 3 -> 4: `fork` became `connection-node`. */
function v3ToV4(document: Loose): Loose {
  const model = (document['model'] ?? {}) as Loose;
  const elements = (model['elements'] ?? {}) as Record<string, Loose>;

  const migrated: Record<string, Loose> = {};
  for (const [id, element] of Object.entries(elements)) {
    migrated[id] = element['kind'] === 'fork' ? { ...element, kind: 'connection-node' } : element;
  }

  return { ...document, formatVersion: 4, model: { ...model, elements: migrated } };
}

/**
 * 4 -> 5: elements may carry `style`. Nothing to rewrite, since the field is
 * new and optional; the bump exists so a version 4 build refuses a styled
 * file rather than stripping its colours on the next save.
 */
function v4ToV5(document: Loose): Loose {
  return { ...document, formatVersion: 5 };
}

/**
 * 5 -> 6: a connection node carries `labels`, keyed by the connections
 * touching it. An older node has nothing to say about its branches, so it
 * arrives with an empty map rather than inventing answers.
 */
function v5ToV6(document: Loose): Loose {
  const model = (document['model'] ?? {}) as Loose;
  const elements = (model['elements'] ?? {}) as Record<string, Loose>;

  const migrated: Record<string, Loose> = {};
  for (const [id, element] of Object.entries(elements)) {
    migrated[id] =
      element['kind'] === 'connection-node'
        ? { ...element, labels: element['labels'] ?? {} }
        : element;
  }

  return { ...document, formatVersion: 6, model: { ...model, elements: migrated } };
}

const MIGRATIONS: Record<number, (document: Loose) => Loose> = {
  1: v1ToV2,
  2: v2ToV3,
  3: v3ToV4,
  4: v4ToV5,
  5: v5ToV6,
};

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
