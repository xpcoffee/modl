# 016: Input bindings are reader preferences, matched through one table

**Status**: accepted · **Date**: 2026-08-11

## Context

Every input gesture on the board was hard-coded where it was handled: undo and redo in `App`, copy and paste in `Canvas`, search in `SearchMenu`, and delete, box select, and pan as React Flow props. Issue #11 asks for each action to have a binding the reader can change, from a submenu of the preferences panel, taking effect immediately, with a reset to defaults.

## Decision

**Bindings are the reader's, like motion (decision 010).** A binding says nothing about the domain being drawn, follows the person across every document they open, and never reaches the document, the command bus, or the trace. So it lives in `packages/app/src/preferences/keybindings.ts`: a module-level store read through `useSyncExternalStore`, persisted in `localStorage` (`modl.keybindings`, overrides only), installed before the first render.

**One table names the actions.** `ACTIONS` lists ten user actions (undo, redo, select all, copy, paste, search, delete, box select, duplicate, pan), each with a label, a capture type, and default combos. Handlers stop naming keys and ask the table instead: `matchesKey('undo', event)` for keyboard listeners, `matchesMouse`/`boxSelectGesture` for pointer handlers, and derivation functions (`deleteKeyCodes`, `selectionKeyCodes`, `panButtons`) for the gestures React Flow owns. Immediate effect falls out of that: matching reads the store at event time, and `Canvas` re-renders its React Flow props off a version hook.

**An action holds a list of combos; rebinding replaces the list with one.** Defaults need the list (redo answers ctrl+y and ctrl+shift+z; delete answers Delete and Backspace), and a single captured combo is what the panel's click-then-press interaction can honestly record. `ctrl` in a combo means ctrl-or-cmd, the reading every handler already used.

**Captures are typed.** A keyboard action records the next key press with its modifiers. A mouse action records the next button press, in two flavours: `modifier+button` (box select, duplicate) refuses a bare left button, because that would swallow the plain drag that moves elements; `button` (pan) drops modifiers, because React Flow pans by button alone. The left button always pans the empty pane; the pan binding adds a button that also works over elements.

**The submenu replaces the page.** The preferences dialog shows one page at a time, with a breadcrumb in the header walking back to the root. No save button: `setBinding` persists and announces on each capture, and reset drops every override at once.

## Consequences

Conflicts are allowed. Two actions bound to the same combo both fire; the panel does not arbitrate. The bindings that stay expressible are bounded by React Flow where React Flow owns the gesture: a delete combo becomes its combo strings (with ctrl written as both Control and Meta), a box-select combo becomes exact-match selection key codes with ctrl and meta variants for subtraction, and pan reduces to buttons.

Editor-local keys (Enter and Escape in inline editors, arrows in the roller and search list) stay hard-coded: they belong to the focused control, not to the board.

A stored override that no longer parses, names an unknown action, or breaks its action's capture rule is dropped on load, so a stale or hand-edited store degrades to defaults rather than to a broken board.

## Rejected

**Bindings in the document or the command bus.** Would put the reader's hand positions into the model and the trace, breaking pure replay and following the document instead of the person.

**A general chord or sequence system** (multi-stroke bindings, per-context maps). Nothing on the board needs it, and every layer of expressiveness here must survive round-tripping into React Flow's key-code strings.

**Conflict detection in the panel.** Arbitration needs a policy (block? warn? steal?) and the cost of a duplicate binding is low and self-inflicted. A later pass can add a warning without changing the model.
