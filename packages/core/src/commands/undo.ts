import type { AppState, Command } from './types.js';

/**
 * Commands that change only what the user is looking at, not the document.
 * They stay out of the undo history: Ctrl+Z after clicking around should
 * undo the last edit, not deselect. A command missing from this list is
 * undoable by default, so a new command needs no registration to take part.
 */
const SESSION_COMMANDS: ReadonlySet<Command['type']> = new Set([
  'set-selection',
  'set-expanded',
  'set-filter',
  'set-view',
  'set-hidden',
  'set-selection-highlight',
  'undo',
  'redo',
]);

/** Whether a command enters the undo history when it applies. */
export function isUndoable(command: Command): boolean {
  return !SESSION_COMMANDS.has(command.type);
}

export function canUndo(state: AppState): boolean {
  return state.undo.cursor > 0;
}

export function canRedo(state: AppState): boolean {
  return state.undo.cursor < state.undo.history.length;
}
