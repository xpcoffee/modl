# 007: Style lives on the element, and the last choice follows the reader

**Status**: accepted · **Date**: 2026-08-04

## Context

Issue #4 asks for fill colours on components, stroke colours and styles on everything, an arrowhead choice on connections, and for the last-used style to apply to whatever the reader creates next. Multi-selections must be editable, with fill offered whenever at least one component is selected.

Two boundaries in this codebase pull against each other here. Decision 002 keeps semantics apart from pixels: `model` holds meaning, `layout` holds rectangles and bends. A colour is presentation, which argues for `layout`. But the domain model already made the opposite call once, for a connection node's `shape`: a choice the author makes about what an element *is* travels with the element, into any tool that ignores geometry.

## Decision

**Style is an optional bag on the element.** `ElementBase` gains `style?: { fill?, stroke?, strokeStyle?, arrowhead? }`. Colours are lowercase `#rrggbb`, one spelling so documents diff cleanly. `layout` stays pure geometry: a producer that regenerates every position never touches a colour the author chose. An element with no `style` field draws the theme default, and the reducer drops the field when the last property is cleared, so `"style": {}` never reaches a file.

**Fill and arrowhead are gated by kind, in the schema and in the reducer.** A connection has no fill; only a connection carries an arrowhead. The `set-style` command patches per field: `undefined` leaves a field alone, `null` clears it. Both loading and dispatching reject a field on the wrong kind rather than dropping it silently.

**The arrowhead is a glyph, not a direction.** `direction` (format 3) still says which ends carry heads and stays semantic. `style.arrowhead` only picks the drawing: `triangle` (default), `open`, or `diamond`. One meaning per field, so there is no second way to say "no arrowhead".

**Fill renders mostly transparent.** The document stores the pure colour; the renderer applies it at 16% alpha, so a coloured box stays legible on the canvas and the choice of alpha can change without a migration.

**`formatVersion` goes to 5.** The field is additive, but a version 4 build saving a version 5 file would strip every colour without a word. The bump turns silent loss into a refusal, the same trade format 2 made when elements gained `sources`. The 4 to 5 migration rewrites nothing.

**The remembered style is UI state, following the placement picker.** A module in the app holds the last-used values; `create-entity`, `create-connection-node`, and `create-connection` accept an optional `style` the UI fills in from it. The trace stays self-contained because the command carries the style explicitly, and a replay needs no session memory. `window.__modl.reset()` forgets it.

**A multi-selection edits per capability.** One panel serves the whole selection: fill applies to the selected components and nodes, arrowheads to the selected connections, stroke and line style to everything. The UI dispatches one `set-style` per element, so the trace shows exactly which elements changed.

## Consequences

A consumer reading `model` alone now sees presentation fields. They are optional and ignorable, which is the same bargain `shape` already struck.

Markers cannot inherit the stroke colour of the line that references them, so the app draws one SVG marker def per (glyph, colour) pair in use. The plain triangle keeps its original ids, so nothing that referenced them moved.

The editor offers a six-colour palette, but the format accepts any `#rrggbb`. The palette is a UI choice and can grow without touching the model.

## Rejected

**Style in `layout`.** Loading a document without layout, or re-running the automatic placer, would cost the author their colours. Geometry is recomputable; a colour choice is not.

**A `set-style` command taking `ids: Id[]`.** Every other mutation targets one element, and a batch command would be the only one whose failure is partial. The UI loops instead.

**Storing the rendered alpha, or letting the user pick it.** "Mostly transparent" is a rendering policy. Storing it would freeze today's canvas contrast into every document.

**No version bump for an additive field.** Cheaper now, and it hands an old build permission to destroy new data on save.

**Remembering the last style in `AppState` via the reducer.** It would put a UI convenience into every trace twice: once as the edit, once again inside the create. The placement picker set the pattern for keeping armed-mode state out of the document.

## What would reverse this

Colour acquiring meaning the model must read, for example "red means deprecated" driving validation or filtering. At that point colour stops being presentation, and it should become a tag that a theme maps to a colour, with `style` reserved for hand overrides.
