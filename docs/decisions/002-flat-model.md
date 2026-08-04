# 002: The model is flat, with layout held separately

**Status**: accepted · **Date**: 2026-08-03

## Context

The point of this tool is that other systems read its output as a pseudo-source of truth, and can generate that output without opening the whiteboard. A codebase scan should be able to emit structure it has, and omit what it does not.

Diagrams tempt you into a tree: a group holds its members, which hold theirs. That reads well and is miserable to query, patch, and generate.

## Decision

**One flat map.** All elements live in `model.elements` keyed by id. Relationships are fields holding ids: `connection.from[]`, `connection.to[]`, `element.groupId`. Nothing nests.

**Semantics apart from pixels.** `model` holds meaning, `layout` holds rectangles and bends, keyed by the same ids. A consumer that wants structure reads `model` and ignores the rest. A producer with no coordinates omits `layout` entirely and every entity gets a computed position.

**Ids are authoritative, names are derived.** A readable `adjective-noun` name is a pure function of the id (FNV-1a into two frozen 256-word lists) and is never stored. Ids accept any UUID version, so a producer can mint v5 from its own keys and re-import the same source without churning the diff.

**Invalid structure is representable.** A document that breaks a paradigm rule still loads and still round-trips. Errors make a file unloadable; warnings mark elements and let the work continue.

**Serialization is byte-deterministic.** Sorted keys, fixed declaration order. The same document always produces the same bytes, so golden-file tests work and `git diff` stays readable.

## Consequences

Reading a group's members means scanning for `groupId`, which is a linear pass rather than a lookup. At the sizes a hand-drawn domain reaches this has not mattered.

Arrowheads live in `layout`, not the model: `from` and `to` already carry direction, so a head is presentation.

Tags hold a list of values per key. They were single-valued at first, on the argument that `key=value` is the common case and one value keeps hand-authored JSON simple. A producer generating a real document hit the limit immediately: a connection in two flows, a step in two subdomains, could say only one thing, and the rest went into prose where a filter cannot see it. Widening cost a `formatVersion` bump and a migration, which is the price of having guessed wrong.

## Rejected

**Nesting groups in the document.** Every query, patch, and generator pays for the tree.

**Positions inline on each element.** Simpler to write, and it forces every programmatic producer to invent coordinates it does not have.

**Separate files for model and layout.** Cleaner in theory; the user saves and loads one thing.

**Ids are opaque strings**, not necessarily UUIDs. Requiring a UUID meant only a program could write a document, since every `from` and `to` was unreadable. Generated documents should still use v5 for stable diffs.

**Elements carry `sources`.** A generated document is worth trusting only if its claims can be traced back, and a reference buried in prose cannot be queried.

## What would reverse this

A format where the flat map costs more than it saves: a document large enough that scanning for members shows up in profiling.
