<img src="packages/app/public/modl.svg" alt="" width="72" align="left" hspace="12" />

# modl

> currently an AI PoC

A visual tool for structuring, visualizing and extending domains/mental models.

<br clear="left" />

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
| [docs/agents.md](docs/agents.md) | Producing a document from another tool, and checking it reads |
| [docs/domain-model.md](docs/domain-model.md) | The structure, the file format, validation rules. Enough to generate a document from another source |
| [docs/decisions/](docs/decisions/) | One file per architectural decision: the tension, what was rejected, what would reverse it |
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
| `npm test --workspace @modl/core` | Tests for one package |
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

- **Add** opens a list of what you can place: component, state, step, artifact, connection node, decision. Then click the canvas to drop one, or drag to size it. Double-clicking empty canvas still makes a component
- **Convert** an element by clicking its type chip: a component can become a decision and back, keeping its title, tags, and every connection reaching it
- **Re-point** a connection by selecting it and dragging either end onto another element
- **Rename** by double-clicking an element or a connection label. Enter commits, Escape discards
- **Drag** a node to move it, or its corners to resize it. Both are recorded on release, so the trace holds the result you meant
- **Multi-select** with Control-click or Cmd-click. Dragging moves the whole selection
- **Connect** two elements by dragging between the handles on any of their sides. A line attaches to whichever sides are nearest, and the arrowheads say which way it reads: one way, both, or neither. The connection takes the paradigm of what it points at
- **Select** a node or edge to edit it in place: click the type chip to change paradigm, type into the description, click a tag to rename or retype it, `+ tag` to add one. A trash button appears under the selection, for one element or many
- **Hover** an element for its description and tags. A type icon is always visible: a cube for a component, a ring for a state, a footprint for a step
- **Group** any selection, or none, to start a container. Drag elements in and out of it, resize it by its corners, and collapse or expand to move between levels of detail. Connections into a collapsed group re-point at the group
- **Filter** with expressions like `team=payments`, `-deprecated`, or `team=payments tier=1`. Non-matching elements dim rather than disappear, and the input suggests recorded values
- **Reroute** a line by selecting it and clicking a hollow handle to add a bend. Drag a bend to move it, double-click it to remove it. The editor toggles an arrowhead at either end
- **Delete** removes the selection, on either Delete or Backspace, or with the trash button
- **Save** and **Load** a `.modl.json` file, and **Export trace** for the session's command log

### Producing a document from another tool

There is a command line for building documents without the board, meant for an agent generating a diagram as part of some other job:

```bash
npm run build                                     # once, so render has an app to drive
npm run modl -- check  domain.modl.json           # does the layout read?
npm run modl -- layout domain.modl.json           # place anything with no position
npm run modl -- render domain.modl.json -o d.png  # draw it as the app would
```

`check` reports overlapping elements, members outside their container, stranded elements, and missing positions, and exits non-zero when it finds any. `render` drives the real app, so the picture is what the whiteboard draws. See [docs/agents.md](docs/agents.md).

### Driving the running app

Every build exposes the command bus on `window.__modl`:

```js
window.__modl.dispatchAll([
  { type: 'create-entity', id: crypto.randomUUID(), entityType: 'component',
    title: 'Checkout UI', position: { x: 0, y: 0 } },
]);
window.__modl.getDocument();   // the structure
window.__modl.getTrace();      // every command, applied or rejected
window.__modl.replay(trace);   // fold a trace back into state
```

For a quick visual check with the dev server running:

```bash
node packages/app/e2e/screenshot.mjs /tmp/board.png "team=payments"
```

## Status

Runnable: model, commands, trace and replay, all three paradigms, groups with collapse and expand, filtering, the canvas, the inspector, and save/load. 147 unit tests and 43 browser tests.

Colours and undo are still open. See [the vision](docs/vision.md).

Every pull request builds a preview to `https://xpcoffee.github.io/modl/pr-<number>/` and links it from a comment.
