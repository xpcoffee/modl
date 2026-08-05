# 008: Undo refolds the command log rather than inverting commands

**Status**: accepted · **Date**: 2026-08-04

## Context

Undo must cover every command, including ones that do not exist yet ([issue #10](https://github.com/xpcoffee/modl/issues/10)). Decision 001 already made every state change a pure `apply(state, command)`, and replay a fold over the command list. Undo can be built three ways on top of that: inverse commands, snapshots of state, or replaying a prefix of the log.

Inverse logic is the trap here. Each command would need a hand-written inverse, and a future command whose author forgets one silently breaks undo. Delete shows how hard the inverses get: deleting an entity also strips it from connections and removes connections left with no endpoint, so its inverse must recreate all of that.

## Decision

The session keeps its applied commands in `AppState.undo`: a `history` list and a `cursor`. Undo moves the cursor back one entry and rebuilds state by folding the reducer over `history[0..cursor]` from the empty starting document. Redo moves the cursor forward the same way. A command that applies while the cursor sits mid-history truncates everything past it: once the timeline diverges there is no branch for redo to return to.

`undo` and `redo` are themselves commands. That keeps decision 001 whole: the trace records them like any dispatch, and replaying a trace that contains an undo reproduces the undo. It also answers the trace question directly: an undone command stays in the trace with its `applied` outcome, followed later by the `undo` entry, so the trace remains a faithful record of the session rather than of the final document.

Six command types stay out of the history: `set-selection`, `set-expanded`, `set-filter`, `set-view`, `set-hidden`, and `set-selection-highlight`. They change only what the user is looking at, not the document, and Ctrl+Z after clicking around should undo the last edit rather than deselect or re-show. The list is a skip-list, so a new command is undoable by default with no registration. After a refold, the current camera, filter, selection, and expansion carry over, pruned to elements that still exist, so undoing a move does not also fling the viewport back.

`load-document` and `merge-document` are ordinary history entries. Undoing a load restores the document that was open before it, and a session rebuilt by replaying a trace carries the whole session in its history, so a loaded trace can be undone and redone end to end.

## Performance

Refolding from the start costs one reduce per history entry, and each reduce copies the element map. Measured on this implementation: 0.4 ms at 100 commands, 2.5 ms at 500, 14 ms at 1,000, 142 ms at 2,000 commands over 1,000 elements. Sessions today run in the tens of commands, so no snapshotting ships with this decision.

## Rejected

**Inverse commands.** Per-command inverse logic that a future command can forget to implement, and the delete cascade shows the inverses are not mechanical.

**State snapshots per command.** Correct and simple, and it stores a full document copy per step; the command log is already stored twice (trace and history), so snapshots buy speed the sessions do not yet need.

**Memoized snapshots every N commands.** The right escape hatch when refolds get slow, rejected for now because the measured cost at realistic history sizes is under 15 ms.

## What would reverse this

Sessions with histories in the thousands of commands, where a refold above 100 ms makes Ctrl+Z lag. The fix is additive: keep a snapshot every N history entries and refold from the nearest one, without changing the command model or the trace format.
