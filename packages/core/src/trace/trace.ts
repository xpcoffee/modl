import { apply } from '../commands/apply.js';
import type { AppState, Command, CommandError, DomainEvent } from '../commands/types.js';
import { serializeDocument } from '../serialize/serialize.js';

export interface TraceEntry {
  /** From 1, no gaps. */
  seq: number;
  /** ISO 8601. Recorded for humans and ignored by replay. */
  at: string;
  command: Command;
  outcome: 'applied' | 'rejected';
  error?: CommandError;
  events: DomainEvent[];
}

export interface Divergence {
  seq: number;
  command: Command;
  recorded: TraceEntry['outcome'];
  actual: TraceEntry['outcome'];
  message: string;
}

export interface ReplayResult {
  state: AppState;
  divergences: Divergence[];
}

/**
 * Collects a session trace. Every dispatch is recorded, including rejected
 * commands, so a replay reproduces what the user tried as well as what stuck.
 */
export class TraceRecorder {
  private entries: TraceEntry[] = [];
  private seq = 0;

  constructor(private clock: () => string = () => new Date().toISOString()) {}

  record(command: Command, result: ReturnType<typeof apply>): TraceEntry {
    this.seq += 1;
    const entry: TraceEntry = result.ok
      ? {
          seq: this.seq,
          at: this.clock(),
          command,
          outcome: 'applied',
          events: result.events,
        }
      : {
          seq: this.seq,
          at: this.clock(),
          command,
          outcome: 'rejected',
          error: result.error,
          events: [],
        };
    this.entries.push(entry);
    return entry;
  }

  all(): TraceEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
    this.seq = 0;
  }

  toJSON(): string {
    return `${JSON.stringify(this.entries, null, 2)}\n`;
  }
}

/**
 * Folds a trace back into state, checking each outcome against the recorded
 * one. Continues past a divergence so a single report names every problem.
 */
export function replay(initial: AppState, entries: TraceEntry[]): ReplayResult {
  let state = initial;
  const divergences: Divergence[] = [];

  for (const entry of entries) {
    const result = apply(state, entry.command);
    const actual = result.ok ? 'applied' : 'rejected';

    if (actual !== entry.outcome) {
      divergences.push({
        seq: entry.seq,
        command: entry.command,
        recorded: entry.outcome,
        actual,
        message: result.ok
          ? `recorded a rejection (${entry.error?.code}) and the command applied cleanly`
          : `recorded success and the command was rejected: ${result.error.code}`,
      });
    }

    if (result.ok) state = result.state;
  }

  return { state, divergences };
}

/** Reads a trace back from JSON. */
export function parseTrace(text: string): { ok: true; entries: TraceEntry[] } | { ok: false; message: string } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return { ok: false, message: 'a trace must be a JSON array' };
    return { ok: true, entries: parsed as TraceEntry[] };
  } catch (cause) {
    return { ok: false, message: `not valid JSON: ${(cause as Error).message}` };
  }
}

/**
 * Renders a replay failure for a terminal. An agent reading this knows which
 * command broke and how the run differed.
 */
export function formatDivergences(divergences: Divergence[]): string {
  if (divergences.length === 0) return 'replay matched the recorded trace';
  return divergences
    .map((d) => `  seq ${d.seq} ${d.command.type}: ${d.message}`)
    .join('\n');
}

/** Convenience for tests: the serialized document after replaying a trace. */
export function replayToDocument(initial: AppState, entries: TraceEntry[]): string {
  return serializeDocument(replay(initial, entries).state.document);
}
