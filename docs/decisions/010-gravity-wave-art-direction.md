# 010: Motion speaks the language of gravity waves

**Status**: accepted · **Date**: 2026-08-04 · **Revised**: 2026-08-09

## Context

The board gave no feedback on the actions that change it. A first click on empty canvas looked like a miss, with nothing hinting that a second click creates an element there. Elements appeared and vanished in a single frame. Issue #13 asks for animation with a stated art direction, recorded here so later animation work speaks the same language.

Issue #30 then reported the animations missing on the deployed board. The triggers were firing and the waves were painting; two things had made them unreadable. Zoomed out, a wave measured in flow pixels shrank with the board. And `prefers-reduced-motion` had switched the whole language off with nothing on screen admitting it. Both answers are recorded below, in the sections they belong to.

## Decision

The canvas is a field, in the space-time sense: the dot grid is its visible medium, and events on the board disturb it. Every animation derives from that one idea.

**The vocabulary.**

- A **ripple** is a radial wave through the dot grid, carried by displacement and light together: a narrow wavefront travels out from (or in toward) a point, each dot shifts along the radial line as the front passes and tints toward the accent blue (#5b8def) under a soft halo, and both effects share the same damping in time and distance. Displacement alone was too subtle to read on the dark background. It is still a distortion of the medium, not water rings: no drawn circles, no fading outlines, only the grid's own dots moving and lighting.
- A **warp** is an element entering or leaving the field: scale and blur, as if condensing out of it or dissolving back in. The ghost that plays a deleted element's exit wears the element's own fill, stroke, and muted opacity, so nothing changes its look in the moment it leaves.

**The grammar.**

- A lone click on empty canvas: a small outward ripple, a tap on the field rather than a splash. Two-thirds the reach of an element wave, a third of its amplitude, and dimmer. The board heard you; clicking again creates here.
- Creating an element: warp-in, then an outward ripple from its centre, reaching about one element-width past its edge. The ripple starts only after the warp ends, so the mass arrives before it bends the field.
- Deleting an element: warp-out, then an inward ripple whose wavefront starts on the shape's own boundary and collapses to its centre, the field closing over exactly the gap the element left. The model drops the element immediately, so a ghost drawn at its old rectangle plays the exit.
- Only **solid** elements ripple: entities, connection nodes, and collapsed groups. An expanded group is an outline around its members, not a mass, so creating or deleting one moves no dots and leaves no ghost; it keeps its warp-in, and its members animate individually as ever. Ripple eligibility is read when the wave would start, because the toolbar expands a new group in the dispatch after creating it.

**The timing rules.**

- Warp-in: 0.3s. Warp-out: 0.2s, revised down from 0.3s on PR #15 review; leaving reads faster than arriving.
- Ripple: 0.3s. Issue #13 proposed ~0.5s ripples that outlive the warp; at 0.5s the wave lingered after the element had settled, so review on PR #15 revised it down.
- Ripple follows warp, never overlaps it.

**Where it lives.** Animation is presentation and stays in `packages/app`, never in `packages/core`. State changes remain pure `apply(state, command)`; animations hang off the domain events a command emits (`element-created`, `element-deleted`), so a replayed trace animates exactly as the original session did. A whole document arriving (`document-loaded`) is a scene change and animates nothing.

**A wave holds its size on screen.** Wave geometry is measured in flow pixels, which pins a wave to the board: an element's wave stays element-sized however the camera moves. Zoomed out, that made the wave shrink along with everything else until there was nothing left to read — at 25% a press wave spanned about 30 pixels and moved a dot by one (issue #30). Below 100% the whole shape — reach, wavefront width, and displacement together — is spread by the inverse of the zoom, so the wave keeps its size on screen while it keeps its proportions. At or above 100% nothing changes: the wave stays pinned to the board, which is where the element-relative reaches above are meant to be read.

**Accessibility.** `prefers-reduced-motion: reduce` disables warps, ghosts, and ripples, in JavaScript (no triggers fire) and in CSS (no keyframes run). It is the default answer and not the final one: it is a single whole-OS switch, so a reader who turned Windows' animation effects off for unrelated reasons lost the entire visual language with nothing on screen to say so. Three choices — follow the system, always, never — override it, and the panel says which way the system is currently pointing.

This is the reader's preference, not the board's. It says nothing about the domain being drawn, it follows the person across every document they open, and it must not enter the model or the trace. So it lives with the reader: a preferences panel behind the gear at the end of the toolbar, held in `localStorage` rather than in the command bus, and read through `packages/app/src/preferences/`. Board and view state stays where board state belongs — the filter bar and the control cluster. One attribute on the document root (`data-motion`) carries the answer, so the CSS keyframes and the JavaScript triggers read the same source rather than the media query twice.

**Tests.** The Playwright suite runs with reduced motion by default so animation timing cannot shift what a spec measures; the animation specs opt back in.

## Consequences

React Flow's `Background` is an SVG pattern, one tile repeated, which cannot bend around a point. The dot grid is therefore drawn on a canvas (`GravityGrid`) that replaces it, tracking the viewport transform and displacing dots per frame while a wave runs. When no wave runs it draws once per pan or zoom.

The grid exposes `data-ripples` and `data-ripples-started` so specs assert on counters rather than pixels, and `data-motion` so a reader (or a spec) can tell a still board from a broken one. The zoom rule is the exception the counters cannot cover: its spec measures the on-screen radius of the disturbed pixels at two zoom levels, because a wave that starts and finishes correctly while being invisible is exactly the bug it guards.

## Rejected

**Water-style ripples** (expanding rings drawn as strokes). Cheaper, and the wrong metaphor: they add ink on top of the board instead of moving the medium the board already has.

**Distorting the built-in Background** via SVG filters or pattern offsets. A pattern shifts uniformly; a localized wave needs per-dot displacement.

**Animation state in the core.** Would put presentation timing into the document and the trace, breaking pure replay.

**Waves measured in screen pixels throughout.** Would hold every wave the same size at every zoom, and cost the grammar its element-relative reaches: a creation wave is supposed to reach about one element-width past the element's edge. Spreading only below 100% keeps that reading where the board is legible and rescues it where it is not.

**Taking the reader's override from the system preference alone**, with no control. Honest about the OS setting, and it leaves a reader who wants motion back with no way to ask, and no hint that the board has a visual language at all.

**The motion control in the board's cluster**, beside undo and redo. Where the eye already is on PR #32 review, and the wrong shelf: that cluster acts on the board in front of you, and this preference belongs to the person, outliving the board and every other board they open. It moved to the preferences panel, which is also the shelf the next reader preference will want.

**Motion as a command on the bus**, like `set-selection-highlight`. Consistent, and it would write the reader's accessibility setting into the document and replay it onto whoever opened that file next.

## What would reverse this

The per-frame canvas redraw costing noticeable jank on large boards during waves, or a later art direction replacing the field metaphor wholesale. The motion override would go back to following the system alone if the board grew a settings panel that holds reader preferences properly, or if `localStorage` turned out to be the wrong home for them.
