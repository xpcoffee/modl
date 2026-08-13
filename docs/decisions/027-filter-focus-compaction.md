# 027: Focus compaction is a derived layout, and geometry gestures pause under it

**Status**: accepted · **Date**: 2026-08-13 · Amended by [029](029-focus-compaction-on-collapse.md): the pack now runs whenever the mode is on, so a collapse reflows the view

## Context

Issue #76: with focus mode on and a filter active, non-matching elements leave the board (the first pull request for the issue) and the matching ones should then move closer together so the filtered flow fits in less space. The issue fixes the ground rule: the compacted layout is a transient view, so the saved geometry never changes and entering or leaving the mode creates no undo entries.

Decision 020's `planCompact` already packs a board into reading-order rows and refits containers exactly, but it travels through the `reflow-layout` command, which writes the document and takes a history slot. This feature needs the same packing without the write.

## Decision

**The compacted layout is derived on render, never stored.** `planFocusLayout(state)` in core prunes the elements focus mode removed, treats them as absent rather than pinned, and hands what remains to `planCompact`: the visible elements close up over the space the hidden ones occupied, and a partly-emptied container refits around the members still showing. `focusLayoutState(state)` merges the plan into a copy of the layout and returns it; the canvas derives nodes and edges from that copy the same way the search preview substitutes a filter expression. There is no overlay lifecycle to manage: the plan recomputes whenever the state it reads (filter, focus mode, expansion, document) changes, and returns the input state untouched, by identity, the moment the mode turns off or the filter clears, which puts every element back at its saved position exactly.

**Geometry gestures pause while the overlay stands.** The drawn position of an overlaid element is not its saved position, so a drag would read a compacted coordinate and dispatch it as a real `move-element`; clearing the filter would then teleport the element to wherever the compacted view happened to put it. The same holds for bend drags (`set-waypoints`) and container resizes, whose drawn sizes come from the plan's refit. While the overlay is active, node drags are off (`nodesDraggable`, and per-node for open containers, whose `draggable` outranks the global flag), and the waypoint and resize handles are not shown. Everything that edits structure or content rather than geometry (rename, retag, connect, delete, comment) keeps working, and those edits recompute the plan.

**Comment cards stay at their pinned positions.** The plan moves model elements only: a card is brought forward by selection rather than by the filter, and `planFocusLayout` hands `planCompact` no comments.

## Consequences

The overlay recomputes the pack on every relevant state change instead of caching a plan. `planCompact` is a single pass over the layout, boards are hundreds of elements, and the derivation is memoised on the drawn state, so this stays well under a frame.

A reader who wants to rearrange the filtered flow must leave focus mode first. The alternative, translating a drag on the compacted view back into saved coordinates, was rejected below.

Search's go-to pans to an element's saved position, which under the overlay can sit beside the compacted spot where the element is drawn. The pack anchors each scope at its own corner, so the miss stays within the old bounding box; wiring the search pan through the overlaid layout is a follow-up if it bothers anyone in practice.

## Rejected

**Translating drags back to saved coordinates.** Applying the drag delta to the element's saved position keeps editing alive under the overlay, but the reader watches the element land somewhere other than where they dropped it once the plan recomputes around the edit, and a container drop is judged against boxes whose drawn and saved rectangles disagree. Gestures whose feedback lies are worse than gestures that pause.

**Pinning the hidden elements instead of removing them.** `separate()`'s pinned boxes hold still and everything else spaces around them, which would keep the visible elements apart to clear neighbours the reader cannot see. Treating hidden elements as absent is the point of the mode.

**Storing the overlay in session state.** A stored `Record<Id, Point>` needs explicit invalidation on every command that can change what is visible or where it sits, and each missed case draws a stale board. Deriving from the state that is already the render input makes staleness unrepresentable.
