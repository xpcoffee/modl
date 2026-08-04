import type { AppState, Command, CommandResult, Document, TraceEntry } from '@modl/core';
import { store, replayFromJson } from '../store/store.js';
import { forgetStyle } from '../canvas/styleMemory.js';

export interface DomainMapperApi {
  dispatch(command: Command): CommandResult;
  dispatchAll(commands: Command[]): CommandResult[];
  getState(): AppState;
  getDocument(): Document;
  serialize(): string;
  getTrace(): TraceEntry[];
  replay(entries: TraceEntry[]): { divergences: number };
  replayJson(text: string): ReturnType<typeof replayFromJson>;
  reset(): void;
  ready: boolean;
}

declare global {
  interface Window {
    __modl: DomainMapperApi;
  }
}

/**
 * Exposes the command bus to agents and to the Playwright suite. Available in
 * every build: the app is a local static page, and driving it programmatically
 * is a stated requirement rather than a debug aid.
 */
export function installRuntimeApi(): void {
  window.__modl = {
    dispatch: store.dispatch,
    dispatchAll: store.dispatchAll,
    getState: store.getState,
    getDocument: store.getDocument,
    serialize: store.serialize,
    getTrace: store.getTrace,
    replay: store.replayTrace,
    replayJson: replayFromJson,
    reset: () => {
      // The remembered style is session state too; a fresh session starts plain.
      forgetStyle();
      store.reset();
    },
    ready: false,
  };
}

/** Flipped after first render so a spec can wait for a usable page. */
export function markReady(): void {
  window.__modl.ready = true;
}
