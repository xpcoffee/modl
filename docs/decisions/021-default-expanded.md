# 021: A document hint seeds first-open expansion

**Status**: accepted · **Date**: 2026-08-12

## Context

A dense document opens as a handful of collapsed boxes, and a reader building context expands every group by hand on every load. The review round behind issue #50 asked to "keep the board expanded by default" for one specific document, which is authorial intent about first presentation. Expansion itself is session state, deliberately: which groups a reader has open is their view of the domain, and two people reading the same file must not fight over it (docs/domain-model.md). The file therefore had no way to say how it should first open.

## Decision

`view` gains an optional `defaultExpanded`: `true` opens every group, an array of group ids opens exactly those, and a missing field keeps today's collapsed open. `view` already carries a presentation default (the camera), and "open expanded" is the same kind of statement.

The hint seeds the expanded set when a document loads, in core, so the app and the CLI draw the same first state. Every later expand and collapse is the reader's session, exactly as before, and never writes back to the file.

The field is optional and additive, so no document is rewritten; `formatVersion` moves 7 → 8 so a version-7 build refuses the file instead of silently stripping the hint on save (the pattern in docs/domain-model.md's version table).

## Consequences

An author states first presentation once, and readers still own everything after the first frame. A stale id in the list is ignored at load rather than rejected: the hint is presentation, and a deleted group should not brick the file.

## Rejected

**An app preference to open every document expanded.** The ask was about one document; a global toggle changes all of them, and a small board gains nothing from it.

**Persisting the expanded set per document in browser storage.** Helps only the returning reader on the same machine; the first open, which the review complained about, stays collapsed. It composes with the hint later (a stored set, when present, beats the hint for that reader) and can ship when returning-reader friction shows up.

## What would reverse this

Authors and readers fighting over first-open state in practice: the per-reader stored set would then take over, and the hint would demote to a fallback for first visits.
