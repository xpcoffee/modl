# 005: Logic is tested headless, with a thin browser suite over it

**Status**: accepted · **Date**: 2026-08-03

## Context

The project requires tests an agent can run repeatedly, that spend no tokens, and that say enough for the agent to know what broke. A slow or flaky suite gets skipped, which makes it worse than none.

## Decision

`packages/core` has no DOM dependency and is tested with Vitest in milliseconds. A smaller Playwright suite covers what only a browser proves: rendering, dragging, hit-testing, and layering.

Failures are made readable on purpose. A rejected command prints its code, a golden mismatch prints a unified diff and the command to refresh it (`UPDATE_GOLDEN=1 npm test`), and a replay divergence prints the sequence number with both outcomes.

`npm run verify` runs typecheck, unit tests, and the browser suite, and exits non-zero when any part fails.

## Consequences

Logic that drifts into `packages/app` becomes hard to test, so a growing app-layer test file is a signal to move code into core.

Some defects are invisible to assertions. Edge labels on a white background, invisible zoom controls, a gear icon that reads as a sun: all passed every test and were caught by looking. `packages/app/e2e/screenshot.mjs` exists for that.

The browser suite is where interaction bugs actually surface. Selection doing nothing, nodes dropping out of hit-testing, a handle swallowing a double-click: none of these are reachable from a headless test.

## Rejected

**Playwright for everything.** Highest fidelity, and a slow flaky suite where a failure points at a page rather than a command.

**Unit tests only.** Every layering and hit-testing bug in this project would have shipped.

## What would reverse this

Nothing foreseen. The split has caught defects on both sides.
