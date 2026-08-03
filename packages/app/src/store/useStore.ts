import { useSyncExternalStore } from 'react';
import { store } from './store.js';
import type { AppState } from '@modl/core';

/** Subscribes a component to session state. */
export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
