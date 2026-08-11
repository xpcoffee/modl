# 018: Reflow re-spaces the board in one command

**Status**: accepted · **Date**: 2026-08-11

## Context

Issue #43. A board populated by an agent, or worked over in a hurry, ends up with elements sitting on top of each other and line labels buried under boxes. The ask is a button that re-spaces the board for legibility while keeping the overall layout, taking connectors, the text over their lines, and other layers (pinned comment cards) into account. The move has to animate, and it has to undo as one action.

Two constraints shape everything here. Undo refolds the command log (decision 008), so whatever the button dispatches will be re-applied verbatim on every undo and replay. And the core is headless (decision 005), so the geometry has to be computable without a canvas to measure text on.

## Decision

**The plan is computed up front, and the command carries the result.** `planReflow` (`packages/core/src/query/reflow.ts`) is pure geometry: given the document and which groups are expanded, it returns new positions, translated bends, and grown container sizes. The button dispatches one `reflow-layout` command holding exactly that. A command that re-ran the algorithm on replay would put elements somewhere new every time the algorithm improved, silently rewriting saved traces; a payload of explicit geometry replays identically forever. One command is also one history entry, so one ctrl+Z takes the whole tidy-up back, the same shape as `duplicate-elements` (decision 013).

**Pairs separate along their own axis, in the order they started with.** The arrangement is the reader's mental map, so the solver never invents a layout: it walks every pair of boxes and, where two sit closer than the gap (64px horizontally, 48px vertically), pushes them apart along the axis of their starting offset. Two elements side by side spread sideways; two stacked spread vertically. Orientation and axis are measured once, before anything moves, so a push from a third element can never flip two others past each other. Each push overshoots the gap by one pixel, so the rounding applied when the plan lands cannot leave a pair a fraction short and give a second press work. Passes repeat until one moves nothing, with a ceiling that scales with the square of the box count (a pile of n boxes on one spot untangles in about n² passes). Afterwards the set's top-left corner goes back where it was, so the board spreads in place.

**Label room is estimated from character count.** A labelled pair needs its gap to hold the label: the connection's title at the line's midpoint, or a junction's answer near its end. The core estimates 7.2px per character plus the pill's padding and 24px of clearance, and widens the pair's horizontal gap to match. The pair is the two boxes the solver actually separates: a label on a line crossing a container boundary climbs each anchor to its ancestor in the scope the two share, so the gap widens between the container and the far box. The estimate keeps the plan testable without a browser, and the clearance absorbs a label a few pixels wider than its estimate. The base vertical gap already clears a one-line label, so labels only widen horizontal requirements.

**Scopes go deepest-first: expanded groups, then the root.** Members re-space inside their container, and the container grows (position and `expanded` size) only when a member would poke out of it; a box the reader sized on purpose is otherwise left alone. Each expanded group then takes part in its parent scope as one box of its container size. A collapsed group moves as one box with every descendant carried along, and a connection's hand-placed bends shift by the average of how far its endpoints moved, so a drawn route keeps its shape. A pinned comment card takes part in the scope of the innermost expanded container drawn around it, or at the root, with the same clearance as any box; a card pinned beside a member re-spaces with the members rather than being pushed out of the container. Hidden elements draw muted but stay on the board, so they keep their room like anything else.

**The glide lives beside the other animations, off a dedicated event.** The reducer emits `layout-reflowed` alongside the per-element moves, `animations.ts` flags it, and the canvas tweens React Flow's local node positions over 300ms with the same ease the camera uses. Edges follow their endpoints frame by frame for free. A state change mid-glide (a click selecting a node, a filter preview) re-aims the glide at the fresh targets rather than cancelling it, and a node the pointer is holding belongs to the drag: glide frames skip it, so the drop dispatches the position the reader chose. The motion preference (decision 010) gates it at both ends: under reduced motion nothing glides and elements land at once, and asking for stillness mid-glide snaps the frame to the end.

## Rejected

**A full auto-layout (layered or force-directed).** It produces a defensible layout and destroys the one the reader knows. The issue asks for re-spacing that keeps the overall arrangement; `autoLayout` already exists for elements with no position at all.

**Recomputing the plan inside the reducer, with an empty payload.** The smallest command, and the reducer stays the single place layout changes. But undo-by-refold re-runs reducers against saved history, so improving the algorithm would move elements in old traces and sessions. The algorithm can only be free to change if its output travels in the command.

**Measuring label text in the app and passing widths in.** Real metrics beat an estimate by a few pixels, and in exchange the plan needs a rendered board, which the CLI and the core tests do not have. The clearance margin covers the difference.

**Composing the reflow from `move-element` commands.** No new command, but one entry per moved element in the history: undoing a twenty-element tidy-up would take twenty presses of ctrl+Z, which is exactly what the issue rules out.

**A CSS transition on node transforms.** React Flow positions nodes with inline transforms and owns them during drags, so a blanket transition would also animate every drag and pan. The rAF tween touches only the one sync that asked for it.

**Separating every pair along the cheaper axis.** Half the movement, and a dense pile always resolves vertically (boxes are wider than they are tall), so a clustered board turned into one long column and elements swapped places on the way. Keeping each pair's own axis and starting order costs more distance and keeps the picture recognisable.

## What would reverse this

- A true reading-order normalisation (snap everything into rows and columns) would be a second command with its own name; it answers a different question than "give my layout room".
- Comment cards land at once today; only nodes glide. Cards joining the glide means the overlay reading positions from the tween rather than from state.
- The solver visits every pair, so boards in the thousands of elements would need a sweep structure before the button feels instant.
- If the label estimate proves wrong in practice (unusual fonts, zoom-dependent sizing), the app can measure the drawn labels and carry real widths in the command payload; the command shape already allows it.
