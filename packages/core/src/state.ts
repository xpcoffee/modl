import type { AppState } from './commands/types.js';
import type { Id } from './model/types.js';
import { emptyDocument } from './serialize/serialize.js';

/** Starting state for a session. */
export function initialState(documentId: Id, title?: string): AppState {
  return {
    document: emptyDocument(documentId, title),
    filter: '',
    selection: [],
    expanded: [],
    hidden: [],
  };
}
