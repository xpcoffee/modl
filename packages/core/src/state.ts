import type { AppState } from './commands/types.js';
import type { Id } from './model/types.js';
import { emptyDocument } from './serialize/serialize.js';

/** Starting state for a session. */
export function initialState(documentId: Id, title?: string): AppState {
  const document = emptyDocument(documentId, title);
  return {
    document,
    filter: '',
    selection: [],
    expanded: [],
    expandedBeforeFilter: null,
    hidden: [],
    selectionHighlight: true,
    commentOverlay: false,
    focusMode: false,
    undo: { base: { id: document.id, title: document.title }, history: [], cursor: 0 },
  };
}
