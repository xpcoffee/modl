# 001: First iteration path

**Status**: accepted
**Date**: 2026-08-03

How we get from an empty repository to a working whiteboard, and the choices that shape everything built afterwards.

## The problem this path solves

Two requirements in the README constrain the architecture harder than any feature does:

- every action must be drivable and testable by an agent
- every action must be traceable and replayable

Both demand that user intent exists as data before it becomes a pixel. A conventional React app mutates state inside event handlers, where an agent cannot reach it and a trace cannot record it. So the architecture comes first and the features follow.

## Decisions

### 1. Iteration 1 is a walking skeleton

Build one paradigm end-to-end (components and interactions), flat, with no groups.

In: create, move, edit, delete entities. Connect them. Tag them. Filter by tag. Save and load. The full command, trace, and replay plumbing. The agent test harness.

Out: groups and zoom, forks, the other two paradigms, paradigm warnings, colours.

**Why**: the plumbing carries all the risk and none of the visible payoff. Proving it against a small feature set costs little and makes every later feature a matter of adding commands. Groups are the most interesting idea in the project and also the one most likely to force a rewrite of layout code, so they get their own iteration with the architecture already settled.

**Rejected**: shipping groups in iteration 1. It de-risks the hardest problem earlier, and it delays a runnable app past the point where the command model has been tested against anything real.

**Consequence**: the first demo looks like an ordinary box-and-arrow editor. The value is under it.

### 2. Every mutation is a command

State changes only through `apply(state, command)`, a pure function returning a new state plus events. The UI dispatches commands. It never writes state directly.

```
user gesture ──► Command ──► apply() ──► new state ──► render
                    │              │
                    └──► trace ◄───┘
```

**Why**: this one choice satisfies both hard requirements at once. An agent dispatches the same commands a mouse produces. The trace is the command list. Replay is a fold over that list. No separate automation API to keep in step with the UI.

**Consequence**: adding a feature means adding a command, its reducer case, and its tests, before any UI. That order is the point.

### 3. Commands carry explicit ids

A command that creates an element includes the id. The caller generates it before dispatching.

**Why**: replay must be deterministic. Generating ids inside the reducer makes it impure and forces a seeded random source threaded through every call. Putting id generation at the edge keeps the reducer a pure function of its inputs, and makes a trace fully self-describing.

**Consequence**: `crypto.randomUUID()` lives in the UI layer and in test helpers, never in `packages/core`.

### 4. Rejections are return values

`apply()` never throws. It returns `{ok: true, state, events}` or `{ok: false, error}`.

**Why**: an agent reading a failure needs a code and a message it can assert on. Exceptions crossing a React render boundary produce stack traces instead. Invalid commands are also an expected part of normal use, since a user can ask for something the model forbids.

### 5. React Flow renders the canvas

`@xyflow/react` 12, React 19, TypeScript, Vite 8.

**Why**: React Flow keeps document state outside the library. Nodes and edges are derived from our model on every render, so the model stays the only writable copy and replay needs no reconciliation. Pan, zoom, custom nodes, custom edges, and sub-flows for later group work all come included.

**Rejected**: tldraw, which owns its own document store. Keeping that store and our model in step creates two writable copies of the same information, and deterministic replay has to reconcile both. Its direct-manipulation feel is better than what we will build, and the cost lands on the requirement the whole project rests on.

**Rejected**: hand-rolled SVG. Total visual control, and weeks spent on hit-testing and drag before the first interesting feature.

**Consequence**: connections terminating on a group bounding box and fork glyphs need custom edge and node components in a later iteration. Both are supported extension points.

### 6. Drag commits once, on drop

React Flow moves a node internally during a drag. A `move-element` command fires on drag stop.

**Why**: a command per mouse-move would bury the trace in noise and make replay logs useless for debugging. The committed position is the user's intent, and the intermediate positions are not.

### 7. Layout is separate from the model, in the same file

One `.modl.json` holds `model` and `layout` as sibling sections, keyed by the same ids.

**Why**: a consumer generating structure from a codebase scan has no positions to offer, and a consumer reading structure does not care where a box sits. Separating them lets `layout` be absent entirely. Keeping them in one file means a user saves and loads one thing.

**Rejected**: positions inline on each element. Simpler to write, and it forces every programmatic producer to invent coordinates.

### 8. Tests run headless by default

`packages/core` has no DOM dependency and is tested with Vitest in milliseconds. A small Playwright suite covers what only a browser proves: rendering, dragging, hit-testing.

**Why**: the README requires tests an agent can run repeatedly without spending tokens. A fast, deterministic suite gets run. A slow, flaky one gets skipped. Localising a failure to a single command beats localising it to a page.

**Consequence**: logic that drifts into `packages/app` becomes hard to test, so it belongs in core. Treat a growing app-layer test file as a signal to move code.

### 9. Tags are single-valued

`Record<string, string>`, one value per key.

**Why**: the filter case is `key=value`, and single values keep both the filter grammar and hand-authored JSON simple.

**Consequence**: `owner` cannot hold two people. Widening to `Record<string, string[]>` later breaks every consumer, so it needs a `formatVersion` bump and a migration. Accepted on the expectation that a second key (`owner-secondary`) covers the rare case.

## Build order

Each step ends with a green test suite and is verifiable by an agent with no browser open until step 4.

| # | Step | Proves |
|---|---|---|
| 1 | Model types, serialization, readable names, validation | A document round-trips byte-identically |
| 2 | Commands, reducer, trace, replay | A trace replays to the same state |
| 3 | Filtering and derived queries | Tag expressions select the right elements |
| 4 | App shell rendering state read-only | The model reaches the screen |
| 5 | Create, move, delete entities from the UI | Gestures produce commands |
| 6 | Connections | Many-to-many endpoints hold |
| 7 | Metadata editing and hover display | Titles, descriptions, tags are reachable |
| 8 | Tag filter UI | Filtering works against a real document |
| 9 | Save and load | A file survives a round trip through the browser |
| 10 | Runtime API and Playwright suite | An agent drives the running app |

Steps 1 to 3 need no framework decisions, so they start immediately.

## What would reverse these decisions

- React Flow fighting custom edge routing badly enough that group bounding boxes need a fork of it. Revisit step 5 of the next iteration.
- The trace growing fast enough to slow a session. Add compaction; the format already carries a sequence number.
- A second consumer needing multi-valued tags. Bump `formatVersion` and migrate.
