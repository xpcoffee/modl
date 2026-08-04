# 010: Motion speaks the language of gravity waves

**Status**: accepted · **Date**: 2026-08-04

## Context

The board gave no feedback on the actions that change it. A first click on empty canvas looked like a miss, with nothing hinting that a second click creates an element there. Elements appeared and vanished in a single frame. Issue #13 asks for animation with a stated art direction, recorded here so later animation work speaks the same language.

## Decision

The canvas is a field, in the space-time sense: the dot grid is its visible medium, and events on the board disturb it. Every animation derives from that one idea.

**The vocabulary.**

- A **ripple** is a radial wave through the dot grid, carried by displacement and light together: a narrow wavefront travels out from (or in toward) a point, each dot shifts along the radial line as the front passes and tints toward the accent blue (#5b8def) under a soft halo, and both effects share the same damping in time and distance. Displacement alone was too subtle to read on the dark background. It is still a distortion of the medium, not water rings: no drawn circles, no fading outlines, only the grid's own dots moving and lighting.
- A **warp** is an element entering or leaving the field: scale and blur over 0.3s, as if condensing out of it or dissolving back in.

**The grammar.**

- A lone click on empty canvas: a small outward ripple, a tap on the field rather than a splash. Roughly a third the reach and amplitude of an element wave, and dimmer. The board heard you; clicking again creates here.
- Creating an element: warp-in, then an outward ripple from its centre. The ripple starts only after the warp ends, so the mass arrives before it bends the field.
- Deleting an element: warp-out, then an inward ripple, the field closing over the gap. The model drops the element immediately, so a ghost drawn at its old rectangle plays the exit.

**The timing rules.**

- Warp in/out: 0.3s.
- Ripple: 0.5s, always outliving the warp.
- Ripple follows warp, never overlaps it.

**Where it lives.** Animation is presentation and stays in `packages/app`, never in `packages/core`. State changes remain pure `apply(state, command)`; animations hang off the domain events a command emits (`element-created`, `element-deleted`), so a replayed trace animates exactly as the original session did. A whole document arriving (`document-loaded`) is a scene change and animates nothing.

**Accessibility and tests.** `prefers-reduced-motion: reduce` disables warps, ghosts, and ripples, in JavaScript (no triggers fire) and in CSS (no keyframes run). The Playwright suite runs with reduced motion by default so animation timing cannot shift what a spec measures; the animation specs opt back in.

## Consequences

React Flow's `Background` is an SVG pattern, one tile repeated, which cannot bend around a point. The dot grid is therefore drawn on a canvas (`GravityGrid`) that replaces it, tracking the viewport transform and displacing dots per frame while a wave runs. When no wave runs it draws once per pan or zoom.

The grid exposes `data-ripples` and `data-ripples-started` so specs assert on counters rather than pixels.

## Rejected

**Water-style ripples** (expanding rings drawn as strokes). Cheaper, and the wrong metaphor: they add ink on top of the board instead of moving the medium the board already has.

**Distorting the built-in Background** via SVG filters or pattern offsets. A pattern shifts uniformly; a localized wave needs per-dot displacement.

**Animation state in the core.** Would put presentation timing into the document and the trace, breaking pure replay.

## What would reverse this

The per-frame canvas redraw costing noticeable jank on large boards during waves, or a later art direction replacing the field metaphor wholesale.
