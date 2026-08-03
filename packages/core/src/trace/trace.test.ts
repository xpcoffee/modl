import { describe, expect, it } from 'vitest';
import { formatDivergences, parseTrace, replay, TraceRecorder, type TraceEntry } from './trace.js';
import { apply } from '../commands/apply.js';
import { initialState } from '../state.js';
import { serializeDocument } from '../serialize/serialize.js';
import type { AppState, Command } from '../commands/types.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const LINK = '44444444-4444-4444-8444-444444444444';
const MISSING = '99999999-9999-4999-8999-999999999999';

/** A fixed clock, so a recorded trace is byte-stable. */
function fixedClock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
}

/** Dispatches through a recorder the way the app store does. */
function session(commands: Command[]): { state: AppState; entries: TraceEntry[] } {
  const recorder = new TraceRecorder(fixedClock());
  let state = initialState(DOC);
  for (const command of commands) {
    const result = apply(state, command);
    recorder.record(command, result);
    if (result.ok) state = result.state;
  }
  return { state, entries: recorder.all() };
}

const SCRIPT: Command[] = [
  { type: 'create-entity', id: A, entityType: 'component', title: 'Checkout UI', position: { x: 0, y: 0 } },
  { type: 'create-entity', id: B, entityType: 'component', title: 'Gateway', position: { x: 240, y: 0 } },
  { type: 'create-connection', id: LINK, connectionType: 'interaction', from: [A], to: [B], title: 'authorise' },
  { type: 'set-tag', id: A, key: 'team', value: 'web' },
  { type: 'move-element', id: A, position: { x: 20, y: 40 } },
  { type: 'set-metadata', id: B, description: 'Third-party gateway.' },
];

describe('TraceRecorder', () => {
  it('numbers entries from 1 with no gaps', () => {
    const { entries } = session(SCRIPT);
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('records rejected commands too', () => {
    const { entries } = session([...SCRIPT, { type: 'move-element', id: MISSING, position: { x: 0, y: 0 } }]);
    const last = entries.at(-1);
    expect(last?.outcome).toBe('rejected');
    expect(last?.error?.code).toBe('unknown-element');
    expect(last?.events).toEqual([]);
  });

  it('records the events an applied command produced', () => {
    const { entries } = session(SCRIPT);
    expect(entries[0]?.events).toEqual([{ type: 'element-created', id: A }]);
  });

  it('clears back to an empty trace', () => {
    const recorder = new TraceRecorder(fixedClock());
    recorder.record(SCRIPT[0]!, apply(initialState(DOC), SCRIPT[0]!));
    recorder.clear();
    expect(recorder.all()).toEqual([]);
  });
});

describe('replay', () => {
  it('reproduces the document the session produced', () => {
    const { state, entries } = session(SCRIPT);
    const result = replay(initialState(DOC), entries);
    expect(result.divergences).toEqual([]);
    expect(serializeDocument(result.state.document)).toBe(serializeDocument(state.document));
  });

  it('reproduces a session that included a rejection', () => {
    const script = [...SCRIPT, { type: 'move-element', id: MISSING, position: { x: 1, y: 1 } } as Command];
    const { state, entries } = session(script);
    const result = replay(initialState(DOC), entries);
    expect(result.divergences).toEqual([]);
    expect(serializeDocument(result.state.document)).toBe(serializeDocument(state.document));
  });

  it('ignores timestamps, so replay is deterministic', () => {
    const { entries } = session(SCRIPT);
    const retimed = entries.map((entry) => ({ ...entry, at: new Date().toISOString() }));
    const first = replay(initialState(DOC), entries);
    const second = replay(initialState(DOC), retimed);
    expect(serializeDocument(second.state.document)).toBe(serializeDocument(first.state.document));
  });

  it('reports a divergence naming the sequence number', () => {
    const { entries } = session(SCRIPT);
    // Corrupt entry 3 so its endpoints no longer resolve.
    const corrupted = entries.map((entry) =>
      entry.seq === 3
        ? { ...entry, command: { ...entry.command, to: [MISSING] } as Command }
        : entry,
    );
    const result = replay(initialState(DOC), corrupted);
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0]).toMatchObject({ seq: 3, recorded: 'applied', actual: 'rejected' });
  });

  it('continues past a divergence so one report names every problem', () => {
    const { entries } = session(SCRIPT);
    const corrupted = entries.map((entry) =>
      entry.seq === 1 || entry.seq === 2
        ? { ...entry, command: { ...entry.command, id: MISSING } as Command }
        : entry,
    );
    const result = replay(initialState(DOC), corrupted);
    expect(result.divergences.length).toBeGreaterThan(1);
  });

  it('formats divergences for a terminal', () => {
    const { entries } = session(SCRIPT);
    const corrupted = entries.map((entry) =>
      entry.seq === 3 ? { ...entry, command: { ...entry.command, to: [MISSING] } as Command } : entry,
    );
    const text = formatDivergences(replay(initialState(DOC), corrupted).divergences);
    expect(text).toContain('seq 3');
    expect(text).toContain('create-connection');
  });

  it('says so when nothing diverged', () => {
    expect(formatDivergences([])).toBe('replay matched the recorded trace');
  });
});

describe('trace round trip', () => {
  it('survives JSON', () => {
    const recorder = new TraceRecorder(fixedClock());
    let state = initialState(DOC);
    for (const command of SCRIPT) {
      const result = apply(state, command);
      recorder.record(command, result);
      if (result.ok) state = result.state;
    }
    const parsed = parseTrace(recorder.toJSON());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(replay(initialState(DOC), parsed.entries).divergences).toEqual([]);
  });

  it('rejects JSON that is not an array', () => {
    const result = parseTrace('{"seq":1}');
    expect(result.ok).toBe(false);
  });

  it('rejects text that is not JSON', () => {
    const result = parseTrace('nope');
    expect(result.ok).toBe(false);
  });
});
