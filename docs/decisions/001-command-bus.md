# 001: Every state change goes through a pure command reducer

**Status**: accepted · **Date**: 2026-08-03

## Context

Two requirements shape this project more than any feature: every action must be drivable and testable by an agent, and every action must be traceable and replayable.

A conventional React app mutates state inside event handlers. An agent cannot reach into a handler, and a trace cannot record what happened there. Meeting both requirements by bolting an automation API onto the side creates a second way to change state that drifts from the first.

## Decision

State changes only through `apply(state, command)`, a pure function returning new state plus events. The UI dispatches commands and never writes state.

```
user gesture ──► Command ──► apply() ──► new state ──► render
                    │              │
                    └──► trace ◄───┘
```

Three properties follow, and each was chosen deliberately:

**Commands carry explicit ids.** The caller generates the id before dispatching. Generating ids inside the reducer would make it impure and force a seeded random source through every call. At the edge, a trace is self-describing and replays deterministically. `crypto.randomUUID()` lives in the UI and in test helpers, never in `packages/core`.

**Rejections are return values.** `apply` never throws; it returns `{ok: false, error}` with a code. An agent reading a failure needs something to assert on, and exceptions crossing a React render boundary give a stack trace instead. Invalid commands are also ordinary: a user can ask for something the model forbids.

**Ephemeral focus stays out.** Which element is being renamed is not a command. It changes no state a reader would save, and tracing it would bury the log in noise. The rename itself arrives as `set-metadata` when the edit commits.

## Consequences

Adding a feature means adding a command, its reducer case, and its tests, before any UI. That order is the point.

Replay is a fold over the trace, so no separate automation API can drift from what the mouse does.

Some gestures produce several commands. Dragging a container moves every member, and each move is its own command. The trace is longer than the gesture.

## Rejected

**Mutating state in handlers with a separate scripting API.** Two paths into the same state, and the second one rots.

**Recording DOM events rather than commands.** Replay then depends on layout and hit-testing, so a trace stops reproducing once anything moves.

## What would reverse this

A trace growing fast enough to slow a session. The format carries a sequence number, so compaction is possible without changing the model.
