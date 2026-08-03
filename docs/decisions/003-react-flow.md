# 003: React Flow renders the canvas, and does not own the state

**Status**: accepted · **Date**: 2026-08-03

## Context

The canvas has to be a view of the document rather than a second copy of it. [Decision 001](001-command-bus.md) only holds if there is exactly one writable copy of state.

## Decision

`@xyflow/react` 12 with React 19, Vite, and TypeScript. Nodes and edges are derived from the model on every render. React Flow is driven as a controlled component: its selection, removal, and position changes take effect only after passing through the command bus.

Two behaviours were tuned against real use:

**A drag commits once, on drop.** Positions are local while the drag is in flight so the node follows the pointer, and one `move-element` fires on release. A command per mouse position would bury the trace and make replay logs useless.

**Measured sizes carry across derivations.** Handing React Flow a freshly derived, unmeasured node on every state change makes it hide the node while it re-measures, which drops the node out of hit-testing mid-interaction.

## Consequences

Being controlled means ignoring a React Flow change is the same as forbidding it. Selection did nothing at all until its `select` changes were routed through the bus.

Deciding what a pointer hit needs the element under the pointer, not `event.target`. The first click of a double-click changes the selection and re-renders, so the two clicks can land on different elements and the browser reports their common ancestor.

Layering is explicit: a selected element lifts above its neighbours, connection labels sit above nodes so a line's details are readable, and waypoint handles sit above the label that would otherwise swallow them.

## Rejected

**tldraw.** Better direct-manipulation feel than what we will build. It owns its own document store, so its state and ours would both be writable and replay would have to reconcile them. That cost lands directly on the requirement the project rests on.

**Hand-rolled SVG.** Total control, and weeks on hit-testing, panning, and drag before the first interesting feature.

## What would reverse this

Custom edge routing fighting the library badly enough to need a fork.
