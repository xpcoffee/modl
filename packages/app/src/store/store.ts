import {
  apply,
  initialState,
  parseTrace,
  replay,
  serializeDocument,
  TraceRecorder,
  type AppState,
  type Command,
  type CommandResult,
  type Document,
  type DomainEvent,
  type TraceEntry,
} from '@modl/core';

/**
 * Sees the events of each accepted command, with the state either side of it.
 * The before-state is how a listener reads an element that the command just
 * deleted.
 */
export type DomainEventListener = (
  events: DomainEvent[],
  before: AppState,
  after: AppState,
) => void;

/**
 * Holds session state and the trace. The UI dispatches commands and never
 * writes state directly, so every change is recorded and replayable.
 */
export class Store {
  private state: AppState;
  private recorder = new TraceRecorder();
  private listeners = new Set<() => void>();
  private eventListeners = new Set<DomainEventListener>();
  /**
   * Bumped whenever a whole document arrives. The canvas frames the board on
   * a load, and only on a load: doing it whenever nodes appear moved the
   * board out from under the first element someone created.
   */
  private loads = 0;

  constructor(documentId: string = crypto.randomUUID()) {
    this.state = initialState(documentId, 'Untitled domain');
  }

  getState = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Presentation-side effects (animations) hang off events, not off state. */
  subscribeEvents = (listener: DomainEventListener): (() => void) => {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  };

  dispatch = (command: Command): CommandResult => {
    const before = this.state;
    const result = apply(this.state, command);
    this.recorder.record(command, result);
    if (result.ok) {
      this.state = result.state;
      if (result.events.some((event) => event.type === 'document-loaded')) this.loads += 1;
      // Event listeners run first, so what they derive is in place before the
      // state listeners trigger a render.
      for (const listener of this.eventListeners) listener(result.events, before, result.state);
      this.emit();
    }
    return result;
  };

  /** Changes when a document is loaded, so a view can react to exactly that. */
  getLoadCount = (): number => this.loads;

  dispatchAll = (commands: Command[]): CommandResult[] => commands.map(this.dispatch);

  getTrace = (): TraceEntry[] => this.recorder.all();

  getDocument = (): Document => this.state.document;

  /** Resets to an empty document and clears the trace. */
  reset = (documentId: string = crypto.randomUUID()): void => {
    this.state = initialState(documentId, 'Untitled domain');
    this.recorder.clear();
    // Not a load: an empty board has nothing to frame, and framing it here
    // would move the camera before the first element is placed.
    this.emit();
  };

  /** Replays a trace into a fresh session. Used for debugging a recorded run. */
  replayTrace = (entries: TraceEntry[]): { divergences: number } => {
    const fresh = initialState(this.state.document.id, this.state.document.title);
    const result = replay(fresh, entries);
    this.state = result.state;
    this.recorder.clear();
    for (const entry of entries) this.recorder.record(entry.command, apply(fresh, entry.command));
    this.emit();
    return { divergences: result.divergences.length };
  };

  serialize = (): string => serializeDocument(this.state.document);

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const store = new Store();

/** Parses a trace file and replays it. */
export function replayFromJson(text: string): { ok: true; divergences: number } | { ok: false; message: string } {
  const parsed = parseTrace(text);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  return { ok: true, ...store.replayTrace(parsed.entries) };
}
