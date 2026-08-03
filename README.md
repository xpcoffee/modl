# domain-mapper

> currently an AI PoC

A visual tool for structuring, visualizing and extending domains/mental models.

## Problem

Teams share knowledge about a system with tools that record none of its structure. A collaborative whiteboard handles ad-hoc brainstorming well, and the drawing it produces is hard to reuse or extend, so the next session redraws the system from scratch. These tools also lack tagging and filtering, so one diagram cannot be focused on one aspect of a model. They offer one level of detail, so zooming into part of a mental model means drawing a second diagram that immediately drifts from the first.

## Goal

Let users draw a domain while the tool records a structure underneath: stable ids, typed relations, groups that act as zoom levels, and tags that drive filtering and highlighting. The drawing becomes one view of that structure. Other systems read the same structure as a pseudo-source of truth, and can generate it without opening the whiteboard.

## General development specs

- all functionality (including visual actions) MUST be drivable and testable by agents during development
- functionality (including visual actions) MAY be drivable and testable by agents at runtime
- all actions in the whiteboard MUST be traceable across a user session so that we can track what happened for debugging and analytics
- a series of users actions MUST be able to be provided to the whiteboard (programmatic API) to replay events (for debugging)
- each feature MUST be e2e testable by an agent, locally
- testing MUST run through scripts that spend no tokens and report enough detail for an agent to know what broke and why

## Docs

| File | What it holds |
|---|---|
| [docs/vision.md](docs/vision.md) | The full picture: three paradigms, groups as zoom, forks |
| [docs/domain-model.md](docs/domain-model.md) | The structure, the file format, validation rules. Enough to generate a document from another source |
| [docs/decisions/001-first-iteration-path.md](docs/decisions/001-first-iteration-path.md) | Architecture choices and what would reverse them |
| [docs/specs/001-bootstrap.md](docs/specs/001-bootstrap.md) | Iteration 1 scope, commands, features, acceptance criteria |

## Running it

### Prerequisites

Node 20.19+ or 22.12+, pinned to 24.18.1 in `.nvmrc`.

Vitest 4 and Vite 8 both refuse older releases. On an older Node, npm skips their native bindings, reports a successful install, and the test run then fails with a message blaming an unrelated npm bug. If you see `Cannot find native binding`, check `node --version` first.

```bash
nvm use          # reads .nvmrc
npm install
```

Already have a terminal open on an older Node? nvm keeps whatever version is on `PATH`, so `nvm use` in the repo, or `nvm use default` anywhere, is what switches it.

### Commands

Run these from the repo root.

| Command | What it does |
|---|---|
| `npm run verify` | Typecheck, then the full test suite. The one to run before calling something done |
| `npm test` | Unit tests across every workspace, headless, about 200ms |
| `npm run typecheck` | `tsc --build` across the project references |
| `npm test --workspace @domain-mapper/core` | Tests for one package |
| `UPDATE_GOLDEN=1 npm test` | Rewrites golden files after a deliberate change. Read the diff before committing it |

Single test file, watched:

```bash
cd packages/core && npx vitest src/serialize/serialize.test.ts
```

`npm run verify` exits non-zero when any part fails, so it works as a gate in a script or a hook.

### The whiteboard

```bash
npm run dev      # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server for the whiteboard |
| `npm run build` | Static production build into `packages/app/dist` |
| `npm run test:e2e` | Playwright suite driving the running app. Starts the dev server itself |

The browser suite needs Chromium once:

```bash
node_modules/.bin/playwright install chromium
```

Use that path rather than `npx playwright install`, which fetches whatever version npm resolves and puts the browser where the pinned Playwright will not look for it.

### What you can do in it

- **Add** on the toolbar, or double-click empty canvas
- **Rename** by double-clicking an element or a connection label. Enter commits, Escape discards
- **Drag** a node to move it. The command is recorded on drop, so the trace holds the position you meant
- **Multi-select** with Control-click or Cmd-click. Dragging moves the whole selection
- **Connect** two components by dragging from the handle on a node's right edge to another node. The connection takes the paradigm of what it points at
- **Select** a node or edge to edit its type, title, description, and tags in the inspector. Tags take hold as you type
- **Hover** an element for its type badge, description, and tags
- **Group** two or more selected elements, then collapse and expand to move between levels of detail. Connections into a collapsed group re-point at the group
- **Filter** with expressions like `team=payments`, `-deprecated`, or `team=payments tier=1`. Non-matching elements dim rather than disappear, and the input suggests recorded values
- **Delete** removes the selection, on either Delete or Backspace
- **Save** and **Load** a `.dmap.json` file, and **Export trace** for the session's command log

### Driving it from an agent

Every build exposes the command bus on `window.__domainMapper`:

```js
window.__domainMapper.dispatchAll([
  { type: 'create-entity', id: crypto.randomUUID(), entityType: 'component',
    title: 'Checkout UI', position: { x: 0, y: 0 } },
]);
window.__domainMapper.getDocument();   // the structure
window.__domainMapper.getTrace();      // every command, applied or rejected
window.__domainMapper.replay(trace);   // fold a trace back into state
```

For a quick visual check with the dev server running:

```bash
node packages/app/e2e/screenshot.mjs /tmp/board.png "team=payments"
```

## Status

Runnable: model, commands, trace and replay, all three paradigms, groups with collapse and expand, filtering, the canvas, the inspector, and save/load. 147 unit tests and 43 browser tests.

Forks, colours, and undo are still open. See [the vision](docs/vision.md).

Every pull request builds a preview to `https://xpcoffee.github.io/modl/pr-<number>/` and links it from a comment.
