# 029: Focus mode compacts whenever it is on, so collapse reflows the view

**Status**: accepted · **Date**: 2026-08-13 · Amends [027](027-filter-focus-compaction.md)

## Context

Issue #84: collapsing groups on a large board leaves the space their open footprints held, and the board reads as mostly gap. The issue asks for compaction on collapse with restore on expand, driven by the focus mode toggle.

Decision 027 built the machinery: `planFocusLayout` packs the visible elements into a transient view that never writes the document. It gated the pack on the filter removing something, so with no filter the mode drew nothing and a collapse only swapped the group's box, leaving the hole.

## Decision

**Focus mode packs the visible board whenever the mode is on.** The gate in `planFocusLayout` moves from "the filter removed something" to "the mode is on". The pack already reads the session's expansion set: a collapsed group takes its node-sized box, so collapsing closes the space it held and expanding opens it again, with each state drawing the same pack every time because the pack is deterministic on the document and the expansion set. A filter still prunes non-matches before the pack, exactly as 027 describes.

The existing derivation already restores: the overlay is computed on render, so turning the mode off puts every element back at its saved position, and the saved geometry stayed as it was throughout.

The collapse-driven move glides the same way the filter-driven one does: `expansion-changed` joins `filter-changed` as a glide trigger while the mode runs.

## Consequences

Toggling focus mode on with no filter now compacts the whole board. Before this change the toggle did nothing without a filter; the toggle's labels now say so.

The geometry-gesture pause from 027 widens with the gate: drags, bend edits, and resizes pause whenever the mode is on and the pack moved anything, which on a spread-out board means whenever the mode is on. 027's reasoning holds unchanged: a gesture on a compacted view would write compacted coordinates into the document.

Everything else in 027 stands: derived on render, comments stay pinned, no undo entries, and the known gap that search's go-to pans to saved positions.
