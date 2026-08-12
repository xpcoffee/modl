# 020: Compact packs each scope into banded rows, through the reflow command

**Status**: accepted · **Date**: 2026-08-12

## Context

Issues #55 and #58, both from an agent session over a real ~190-element document. `modl layout` only places entities that have no position and leaves everything placed alone, so a board whose placed elements collide had no CLI remedy short of a one-off script importing `planReflow` from core. And reflow itself misbehaves at board scale: it requires the gap between two connected boxes to hold the widest label drawn between them (decision 018), which reads well inside a scope, and at the root a few long titles between big expanded groups stretched that session's board into a single row 31,000px wide.

Reflow's constraints from decision 018 still bind: a plan is explicit geometry carried by one `reflow-layout` command, so a saved trace replays identically after the algorithm changes, and one undo takes the whole move back.

## Decision

**The CLI exposes reflow as `modl reflow <file>`, defaulting to no expanded groups.** Reflow runs over the session's expanded set, and a file has no session. The default matches how the app and `modl render` first draw a loaded document: every group collapsed, so only the top level re-spaces and the insides of containers stay untouched. `--expand-all` opens every container so members re-space inside the container that holds them, which is what a generated document with placed members needs. The plan lands through `applyAll` and the `reflow-layout` command, so the reducer validates the file's ids the same way it validates a session's.

**Compact is a second plan, `planCompact`, applied by the same command.** It gives up per-pair label gaps and packs each scope into left-aligned rows, bottom-up: members pack inside their container, the container refits exactly around them (shrinking as well as growing, which reflow never does), and the packed containers pack again as single boxes in the scope above. Rows wrap at sqrt(total box area × 1.6), so a block of uniform boxes comes out near a screen's shape rather than one long strip. Boxes pack in the reading order of their current positions, which is also the order the pack itself produces, so the plan is a fixed point: compacting a compacted board computes nothing. On a 132-element trial with 40 long-titled cross-group connections, reflow with every group expanded settled at 158,034 x 2,230 while compact settled at 2,488 x 2,304 with zero layout issues.

**The flag lives on `reflow`, not on `layout`.** Issue #58 sketched `modl layout --compact`, but `layout` promises to place what has no position and leave everything else alone; a flag that flips it into moving every placed element would make that contract conditional. Both reflow and compact re-space what is already placed, so they share a command, and `--compact` composes with `--expand-all` the way the trial above used them.

## Consequences

Compact keeps reading order and discards the arrangement's geometry: a hand-shaped board loses its shape, and a label between two rows may cross boxes it would have cleared under reflow. Compact trades label room for a board a camera can frame; plain `modl reflow` stays the label-aware pass, and running it after compact re-stretches the board, so the two do not compose.

The app has no compact button. The plan shape and command already allow one; decision 018's undo and animation behaviour would apply unchanged.

## Rejected

**Teaching `planReflow` a bounded-width mode.** The solver's vocabulary is pairwise separation along starting offsets; a width bound is a global constraint it cannot express without fighting every gap it just satisfied. A separate ~200-line pack is simpler than a mode inside an 850-line solver, and each stays a fixed point on its own output.

**A new command type for the pack.** Decision 018 expected a reading-order normalisation to be "a second command with its own name", but the name is all a second command would add: the payload is the same explicit geometry, validated the same way, one history entry either way. A new type costs schema, reducer, and trace churn for no behavioural difference. The plan function is the unit that varies; the command stays the carrier.

**Defaulting `modl reflow` to every group expanded.** It is the common case for generated documents, and it silently rewrites the insides of every container in a document whose author wanted only the top level re-spaced. The default mirrors what a reader first sees; the deep tidy is one explicit flag.

**Shelf or skyline bin packing.** Tighter blocks, and both reorder boxes by size, so the board's top-to-bottom story dissolves. Rows in reading order waste some row height and keep the story.

## What would reverse this

- Reflow learning a global width budget would fold compact back into one plan, and the CLI flag would become a parameter of it.
- Macro packing that respects connectivity (connected boxes clustered into the same row) would replace the greedy row pack; the plan shape and command survive.
- A per-document persisted expansion set would replace the CLI's collapsed default with the document's own record of what is open.
