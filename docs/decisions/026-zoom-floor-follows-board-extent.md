# 026: The zoom floor follows the board's extent

**Status**: accepted · **Date**: 2026-08-13

## Context

The canvas kept React Flow's default zoom range, 0.5x to 2x. On a board wider or taller than the window shows at 0.5x, the reader could never see everything at once and had to build the overview by panning (issue #74). The document's `view.zoom` contract in core accepts any zoom above zero, so the limit was purely the render layer's.

## Decision

The canvas computes `minZoom` on every render from the bounds of the drawn nodes and the pane size: the default 0.5 when the board fits at it, and otherwise the zoom at which the board fills 70% of the limiting axis (15% padding per side). `maxZoom` keeps its default. Core is untouched: the floor is a render concern, and `set-view` still accepts any positive zoom.

The floor's 15% padding is chosen against React Flow's fit paths, which clamp their target zoom to `minZoom` from the same store. The fit-on-load call uses 15% padding and the fit control uses React Flow's default 10%, so both targets sit at or above the floor and neither is ever clamped short of framing the board. A padding below 10% would let a reader zoom out less far than the fit control frames, and a much larger one buys nothing: 15% already leaves the whole board visible with room around it.

A floor change never moves the camera. React Flow's `setMinZoom` only rewrites the zoom extent, so lowering or raising the floor cannot pan, zoom, or dispatch `set-view`; it only changes how far the reader's own gestures reach. A board that shrinks (elements deleted) can therefore leave the camera below the new floor until the next zoom gesture, which is deliberate: snapping the camera would fight the pointer, the same reason hand-panning never dispatches `set-view` (decision 009).

## Rejected

**A `set-view`-driven floor in core.** The floor depends on window size and measured node sizes, which core never sees, and persisting it would make one reader's window shape another reader's zoom limit.

**Removing the floor entirely (`minZoom` near zero).** A fixed tiny floor lets a small board zoom out to a speck with no way to say "this is everything"; the adaptive floor makes the stop itself informative.

## What would reverse this

Readers on very large boards needing to zoom out past the fitted frame, for example to compare two boards side by side in separate windows; the padding would then become a preference rather than a constant.
