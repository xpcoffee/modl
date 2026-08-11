# 018: Input bindings are reader preferences, matched through one table

**Status**: accepted · **Date**: 2026-08-11 · **Revised**: 2026-08-11 (PR #42 review)

## Context

Every input gesture on the board was hard-coded where it was handled: undo and redo in `App`, copy and paste in `Canvas`, search in `SearchMenu`, and delete, box select, and pan as React Flow props. Issue #11 asks for each action to have a binding the reader can change, from a submenu of the preferences panel, taking effect immediately, with a reset to defaults. Review on PR #42 added: per-binding removal, the left-drag pan as an explicit binding, the bare left drag assignable to box select, board ownership of the right button, a begin+end alternative to held drags, and a rebindable cancel.

## Decision

**Bindings are the reader's, like motion (decision 010).** A binding says nothing about the domain being drawn, follows the person across every document they open, and never reaches the document, the command bus, or the trace. So it lives in `packages/app/src/preferences/keybindings.ts`: a module-level store read through `useSyncExternalStore`, persisted in `localStorage` (`modl.keybindings`, overrides and modes only), installed before the first render.

**One table names the actions.** `ACTIONS` lists eleven user actions (undo, redo, select all, copy, paste, search, delete, cancel, box select, duplicate, pan), each with a label, a kind, and default combos. Handlers stop naming keys and ask the table instead: `matchesKey` for keyboard listeners, `matchesMouse`/`boxSelectGesture` for pointer handlers, and derivation functions (`deleteKeyCodes`, `selectionKeyCodes`, `selectionOnDragEnabled`, `panButtons`) for the gestures React Flow owns. Immediate effect falls out of that: matching reads the store at event time, and `Canvas` re-renders its React Flow props off a version hook.

**An action holds up to two slots, edited one at a time.** Defaults need two (redo answers ctrl+y and ctrl+shift+z; delete answers Delete and Backspace; pan answers the left and middle drags), and the panel shows each as a chip with its own remove button plus an add button for an open slot. Removing every combo unbinds the action; that is the reader's call. `ctrl` in a combo means ctrl-or-cmd, the reading every handler already used.

**Pan is bound like everything else, including the left drag.** `panButtons` returns exactly the bound buttons, and React Flow shows the grab cursor only while the left button is among them, so removing the left-drag binding also returns the pane to a plain cursor. A box-select combo on the bare left button rides React Flow's `selectionOnDrag`, which its key-code strings cannot express. The board takes the right button for itself (`contextmenu` is suppressed on the canvas), so a right-button binding does not fight the browser's menu.

**A box combines by what rides on top of its binding.** Alt in a press must match the combo exactly; shift and ctrl on top of it are the combine modifiers. The bare combo replaces the selection with the boxed elements, extra shift adds them, and extra ctrl subtracts them (revising decision 012's always-add). A modifier inside the combo is spent naming the gesture: the default shift+left drag always adds, because no shift is left over to distinguish adding from replacing. The same reading applies to held drags, held keys, and begin+end presses, and `selectionKeyCodes` expands each combo to its combine variants so React Flow keeps the box open under them.

**A drag action runs held or begin+end, with keys welcome in both.** Box select and duplicate carry a mode. `hold` keeps the input down through the motion: a button drags as before, and a key opens the run on its keydown and settles it on its keyup (hold `d`, move, release: the copy lands under the pointer). `begin-end` opens a run on one press, grows it with pointer movement, settles it on the next press, and abandons it on the cancel binding. A held key reads "Hold D" in the panel; a held button keeps the word drag. Runs free of the pointer draw their own rectangle (`BoxSelectPreview`), because React Flow only draws one for a held drag; every form settles through the same `settleBox`/`settleCopies` code.

**Cancel is an action too, and it backs out of the nearest thing.** Escape by default. One chain in `Canvas` orders its claims: a run in flight, an armed placement, a non-empty selection (which it clears), then the open comment overlay (which it leaves) — repeated presses back out of anything. The panel's capture and the dialog's own Escape sit in front of the chain, and the overlay's old hard-coded Escape handler folded into it. Clicking the empty pane also deselects, and that stays hard-wired: it is the board's base click, like creating a component.

**Captures are typed by action, and any accepted press binds.** A keyboard action records the next key press with its modifiers; a drag action records a key or a button in either mode. Pan records a button and drops modifiers, because React Flow pans by button alone. Duplicate in hold mode refuses a bare left button, which would swallow the plain drag that moves elements. Every other press binds from wherever it lands, the panel's own controls included, so the bare left button is as assignable as anything else; cancel (Escape) is the way out of a capture. The panel dismisses on a backdrop click only when the press also began on the backdrop, so a drag released outside stays open.

**The submenu replaces the page.** The preferences dialog shows one page at a time, with a breadcrumb in the header walking back to the root. No save button: every capture, removal, and mode change persists and announces at once, and reset drops every override.

## Consequences

Conflicts are allowed but visible. Two actions bound to the same combo both fire; the panel marks each such chip amber and names the other owners, and leaves the choice with the reader. The bindings that stay expressible are bounded by React Flow where React Flow owns the gesture: a delete combo becomes its combo strings (with ctrl written as both Control and Meta), a box-select combo becomes exact-match selection key codes with its combine variants (or `selectionOnDrag` for the bare left button), and pan reduces to buttons. React Flow only draws its selection box for the left button, so a box-select drag bound elsewhere selects correctly and draws nothing.

Editor-local keys (Enter and Escape in inline editors, arrows in the roller and search list) stay hard-coded: they belong to the focused control, not to the board.

A stored override that no longer parses, names an unknown action, or breaks its action's capture rule is dropped on load, so a stale or hand-edited store degrades to defaults rather than to a broken board.

## Rejected

**Bindings in the document or the command bus.** Would put the reader's hand positions into the model and the trace, breaking pure replay and following the document instead of the person.

**A general chord or sequence system** (multi-stroke bindings, per-context maps). Nothing on the board needs it, and every layer of expressiveness here must survive round-tripping into React Flow's key-code strings.

**Conflict arbitration in the panel.** Blocking or stealing a duplicate binding needs a policy the reader then has to learn; a visible warning costs nothing and keeps the choice theirs.

**Unlimited combos per action.** Two covers every default and keeps the panel one row per action; a longer list buys nothing the second slot does not.
