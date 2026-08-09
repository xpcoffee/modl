# 013: A copy is self-contained, and arrives as one command

**Status**: accepted · **Date**: 2026-08-09

## Context

Issue #29 asks for two ways to duplicate. Alt+drag copies what it grabs and the copy follows the cursor while the original stays where it is. Ctrl+C then ctrl+V drops a copy centred on the pointer, and a run of pastes places several as the reader moves the cursor. Both raise the same two questions: given what the reader pointed at, what does a copy cover, and how does that copy enter the document without filling the trace and the undo history with a dozen entries per element.

## Decision

**One `duplicate-elements` command carries the whole copy.** It holds `idMap`, naming every source element and the id its copy takes, and `offset`, how far the copies sit from what they came from. Explicit ids keep the reducer pure and let a trace replay without a random source (decision 001). The reducer copies title, description, tags, sources, style, size, and bends, so one entry in the history is one duplicate, and one undo takes it back.

**A copy is self-contained.** `duplicationSpan` (`packages/core/src/query/duplication.ts`) answers what the copy covers: the elements themselves, every member of a group among them at any depth, and each connection whose ends all sit inside that set. A group without its members would copy as an empty box, so the members come along even when the group is collapsed and they are not on screen. An internal connection comes along whether or not it was selected, since the relationship is part of what the reader is copying. A connection asked for on its own is skipped: a line needs both of its ends to say anything.

**A reference inside the copy follows the map, and one reaching outside it keeps pointing at the original.** That single rule gives a member re-pointed at the copy of its group, and a copy made inside a group that stays in that group. The copies become the selection, so a second gesture repeats over what the reader is now holding.

**The gesture computes, then dispatches once**, the same shape as the selection gestures (decision 012). Alt+drag draws the copies as ghost boxes and creates nothing until the release, so the originals stay still and the trace holds no `move-element` for them. Where each copy lands then decides which container holds it, the rule a drop already follows, so a copy dragged out of a group leaves it.

**Alt+drag has to stop React Flow twice.** React Flow drags a node with d3-drag, which starts on `mousedown`, so stopping the `pointerdown` that opens the gesture leaves the original moving under the pointer. The canvas stops both. The release then produces a click on the pane, which React Flow answers by clearing the selection, so the canvas swallows that one click and the copies stay selected.

**The clipboard holds ids.** A paste copies what is on the board now, and anything deleted since the copy drops out of it. The ids live beside the canvas like the placement picker, outside the document and the trace.

## Rejected

**Dragging the original and leaving the copy behind.** React Flow already drags a node, so this is the cheapest build: move the original, and on release put a copy back at the start. The board says the wrong thing throughout the gesture, though. The original carries its connections with it, so every line stretches towards the cursor and snaps back at the release, while the copy the reader is supposedly holding has no lines at all.

**A clipboard holding a snapshot of the elements.** It would survive deleting the original and could carry between documents. It also gives the reader a second, invisible copy of an element they can edit, and a paste would then re-create what they changed. The ids keep one source of truth on the board.

**Copying a connection that reaches outside the copy.** Pointing the copy at the original draws a line the reader never asked for, and doubles a line already on the board. Dropping the far end leaves a connection with nothing to join.

**Composing a duplicate from `create-entity`, `set-metadata`, `set-tag`, `set-sources`, and `set-style`.** No new command, but around six entries per element in the history, so taking back one alt+drag of five elements would be thirty presses of ctrl+Z.

**Writing to the system clipboard.** Ctrl+C leaves the operating system's clipboard alone, so copying between two boards in two tabs does nothing. Making it work means serializing elements into the clipboard and reading text back that any other program could have written, which is a document exchange rather than a copy.

## What would reverse this

- Copying between documents or tabs. That serializes the elements into the system clipboard, and the paste becomes a `merge-document` with fresh ids rather than a duplicate.
- Readers wanting a copy to keep its connections to what stayed behind, say duplicating a component that talks to a database everything else also talks to. That would be a second gesture with its own name, since the two answers cannot both be the default.
- A cut. It needs delete and copy in one entry to be undoable in one step, which is another command rather than a flag on this one.
