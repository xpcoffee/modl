# 012: Selection gestures compute the next selection, then dispatch once

**Status**: accepted · **Date**: 2026-08-06

## Context

Issue #27 asks for ways to modify a selection rather than replace it: shift+drag adds a boxed region, ctrl+click toggles one element (a group with its members), ctrl+shift+drag removes a boxed region, ctrl+a selects everything, and a minimap gives the reader somewhere to click when the selection work needs repositioning. The tension is between React Flow's own selection machinery, which replaces the selection and reports it change by change, and the command bus, where selection is session state (`set-selection`, outside the undo history per decision 008) and a trace reader expects one entry per thing the reader did.

## Decision

**Each gesture dispatches exactly one `set-selection`.** The modifiers change how the UI computes the next selection, not how it is applied. A box gesture is noted at pointer-down (before React Flow clears anything), dispatches pause while the box is open, and the release settles the gesture in one command. A replayed trace then shows one selection per gesture, and the box's intermediate states never exist as commands.

**Shift+drag adds, ctrl+shift+drag removes.** The boxed elements are the nodes drawn fully inside the box, the rule React Flow highlights by during the drag, plus the connections touching them, the rule React Flow already uses to select edges. Roll-up edges stand in for connections hidden inside a collapsed group and stay out: the reader has not pointed at any one of them. The result joins the selection the gesture opened over, or leaves it for ctrl+shift. Box contents come from geometry at release rather than from React Flow's change stream, whose edge deselections do not fire against a controlled store.

**Ctrl+click toggles the element, and on a group its visible members too.** `selectionSpanOf` (`packages/core/src/query/selection.ts`) returns the element plus, for a group, every member at any depth that is rendered and not put away. Both directions use the same span, so a toggle never half-selects a group's contents: the emphasis rule (decision 009) and the expansion roller (decision 011) see either the group with its visible members or none of them. A collapsed group toggles alone; it already stands in for its members everywhere else (`visibleAnchor`, emphasis, edges), and pulling hidden members into the selection would act on things not on the board.

**Ctrl+a selects what is drawn, not what exists.** `visibleElementIds` returns entities and connection nodes outside every collapsed group and not put away, plus each connection that draws as an edge, including connections a roll-up edge carries: they are on the board, in aggregate. Members of collapsed groups stay out: their group is selected and speaks for them. Put-away elements stay out too: selection beats hiding in the emphasis rule, so selecting them would undo the reader's tidying; clicking one directly still selects it, which is how it comes back. The browser's native select-all is suppressed except inside a text field, where the field keeps it.

**The minimap is React Flow's, click-to-recentre added.** `<MiniMap pannable zoomable>` in the bottom-right corner (the controls hold the bottom-left), themed to the panel colours, muted elements drawn dimmer. A click recentres the viewport on that point at the current zoom; dragging pans, scrolling zooms. A double-click on it is aimed at the camera and never creates an element.

## Rejected

**Reimplementing box selection.** React Flow already draws the box, highlights fully-contained nodes, and auto-pans at the edges. Only the settlement is ours; replacing the gesture would duplicate all of that for the same visuals.

**Dispatching React Flow's selection changes as they arrive (the status quo).** A box drag produced a `set-selection` per change batch, so one gesture littered the trace and made "what did the reader select" a diff across entries.

**Ctrl+a over every element in the document.** Selecting members of collapsed groups would mix on-board and off-board elements in one selection: delete would remove things the reader cannot see, and the selection count would disagree with the board.

**A toggle that stops at the group node.** Toggling a group without its members leaves the next gesture ambiguous: removing one member from a selected group would appear to do nothing, since the group still speaks for it in the emphasis rule.

## What would reverse this

- Readers expecting ctrl+a to reach inside collapsed groups (say, for whole-document restyling). That would add a second, explicit "select all everywhere" rather than change this default.
- A need for the box's intermediate states in the trace (live-shared cursors, selection analytics). That would add a session event stream beside the command log, not more `set-selection` entries.
- Partial-overlap box selection (React Flow's `SelectionMode.Partial`). The geometry at release already mirrors the drawn highlight, so switching modes changes one flag and one containment test together.
