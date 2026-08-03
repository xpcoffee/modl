# 001: Bootstrap

The first iteration. A walking skeleton: one paradigm, flat, end to end, with the command and trace plumbing that every later feature depends on.

Read [the domain model](../domain-model.md) for the structure and [decision 001](../decisions/001-first-iteration-path.md) for why the path looks like this. Deferred material lives in [the vision](../vision.md).

## Scope

**In**

- Entities of type `component` and connections of type `interaction`
- Create, move, edit, delete entities. Connect entities many-to-many.
- Titles, descriptions, key-value tags. Titles always visible; type badge, description, and tags on hover.
- Filter by tag expression, which dims elements that do not match
- Save to and load from a `.dmap.json` file
- Command bus, session trace, replay
- Runtime API and the agent test harness

Added after the first round of review: element types across all three paradigms, groups with collapse and expand, inline rename, and a PR preview deployment.

**Out**

Forks, colours, and undo.

Undo is out because the command log makes it cheap to add later, and it needs inverse commands that are easier to write once the command set stops changing.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node 20.19+ or 22.12+, pinned to 24.18.1 in `.nvmrc` |
| Language | TypeScript 5, strict |
| Canvas | `@xyflow/react` 12.11 |
| UI | React 19 |
| Build | Vite 8 |
| Schema | Zod 4 |
| Unit tests | Vitest 4 |
| Browser tests | Playwright 1.62 |
| Packages | npm workspaces |

## Layout

```
packages/
  core/                 no DOM, no React
    src/
      model/            types, schema, validation
      naming/           readableName, word lists
      commands/         command types, apply(), events
      trace/            trace entries, replay
      query/            tag filtering, derived lookups
      serialize/        document read and write
    fixtures/           documents and traces for golden tests
  app/
    src/
      canvas/           React Flow wiring, node and edge components
      panels/           inspector, filter bar, toolbar
      store/            command dispatch, trace collection
      runtime/          window.__domainMapper
    e2e/                Playwright specs
```

`core` never imports from `app`. Enforced by a lint rule.

## Commands

The complete iteration-1 set. Every state change goes through one.

```ts
type Command =
  | { type: 'create-entity';   id: Id; entityType: EntityType; title: string; position: Point }
  | { type: 'create-connection'; id: Id; connectionType: ConnectionType; from: Id[]; to: Id[]; title: string }
  | { type: 'move-element';    id: Id; position: Point }
  | { type: 'set-metadata';    id: Id; title?: string; description?: string }
  | { type: 'set-tag';         id: Id; key: string; value: string }
  | { type: 'remove-tag';      id: Id; key: string }
  | { type: 'set-endpoints';   id: Id; from: Id[]; to: Id[] }
  | { type: 'delete-element';  id: Id }
  | { type: 'set-selection';   ids: Id[] }
  | { type: 'set-filter';      expression: string }
  | { type: 'set-view';        pan: Point; zoom: number }
  | { type: 'load-document';   document: Document }
```

Applying one:

```ts
type CommandResult =
  | { ok: true;  state: AppState; events: DomainEvent[] }
  | { ok: false; error: { code: string; message: string; commandType: string } };

function apply(state: AppState, command: Command): CommandResult;
```

`apply` is pure and never throws. `AppState` holds the `Document` plus session-only state: the active filter expression and the current selection.

Error codes, all asserted on in tests: `unknown-element`, `duplicate-id`, `invalid-endpoint`, `empty-endpoints`, `self-connection`, `invalid-filter`, `groups-unsupported`, `schema-invalid`, `version-unsupported`, `wrong-kind`.

`set-selection` joined the set during implementation. Selection drives the inspector and the delete button, and a user changing it is an action the trace has to carry like any other.

`wrong-kind` joined it for the same reason: moving a connection or re-pointing an entity are both reachable from the UI and need an error a test can name.

`delete-element` on an entity also deletes connections left with an empty `from` or `to`. The events list names every element removed, so a caller can see the cascade.

## Trace and replay

Every dispatch appends an entry, including rejected commands.

```ts
interface TraceEntry {
  seq: number;              // from 1, no gaps
  at: string;               // ISO 8601, excluded from replay
  command: Command;
  outcome: 'applied' | 'rejected';
  error?: CommandError;
  events: DomainEvent[];
}

function replay(entries: TraceEntry[]): { state: AppState; divergences: Divergence[] };
```

Replay folds `apply` over the commands from an empty state and compares each outcome against the recorded one. A mismatch becomes a `Divergence` naming the sequence number, the command, the recorded outcome, and the actual one. Replay continues past a divergence so one report shows every problem.

A trace exports as JSON and imports back. Timestamps are recorded for humans and ignored by replay, which keeps replay deterministic.

## Runtime API

Always available on the running app, in every build.

```ts
window.__domainMapper = {
  dispatch(command: Command): CommandResult;
  dispatchAll(commands: Command[]): CommandResult[];
  getState(): AppState;
  getDocument(): Document;
  getTrace(): TraceEntry[];
  replay(entries: TraceEntry[]): void;   // resets, then applies
  reset(): void;
  ready: boolean;
};
```

Playwright specs drive the app through this. `ready` turns true after first render, and specs wait on it.

## Features

Each one lands with tests and a green suite. Acceptance criteria are written so an agent verifies them without judgement calls.

### F1: Model and serialization

Types, Zod schemas, validation, readable names, document read and write.

- A fixture document round-trips to byte-identical JSON
- `readableName` returns the documented pair for a fixed set of ids
- Each error code in the validation table fires on a matching malformed fixture
- Every warning code fires on a matching fixture, and the document still loads
- A document with no `layout` section loads, and every entity gets a default position

### F2: Commands, trace, replay

- Every command has a test that applies it to a known state and asserts the resulting document
- Every error code has a test dispatching a command that triggers it
- A fixture trace of 50 commands replays to a document matching its golden file
- A trace with a corrupted command reports a divergence at the right `seq` and keeps going
- `apply` leaves the input state unmutated, asserted by deep-freezing it

### F3: Query and filtering

Filter grammar, kept small on purpose:

```
expression := term (' ' term)*        terms combine with AND
term       := ['-'] key '=' value     leading '-' negates
            | ['-'] key               matches any element carrying the key
value      := literal | '*'           '*' matches any value
```

- Each grammar form selects the right elements from a fixture document
- An unparseable expression returns `invalid-filter` and leaves the previous filter in place
- An empty expression matches everything

### F4: Canvas renders state

React Flow shows entities and connections derived from the document. Read-only.

- Loading a fixture document renders one node per entity and one edge per connection
- Node titles match the document
- Elements failing the active filter render at 25% opacity
- Positions match `layout`

### F5: Direct manipulation

- Double-clicking empty canvas creates an entity and appends one `create-entity` to the trace
- Dragging a node appends exactly one `move-element`, on drop
- Dragging from a node handle to another node appends one `create-connection`
- Selecting a node and pressing Delete appends one `delete-element`
- Every gesture above leaves a trace that replays to the same document

### F6: Inspector

A panel editing the selected element.

- Editing title, description, or a tag appends the matching command
- Hovering an element shows its id and tags
- Tag keys and values reject empty strings before dispatch

### F7: Save and load

- Save downloads a `.dmap.json` matching `getDocument()` byte for byte
- Loading a file replaces the document and appends `load-document`
- Loading a malformed file reports the validation errors and leaves the current document untouched

### F8: Agent harness

- `npm run verify` runs typecheck, lint, unit tests, and Playwright, and exits non-zero when any part fails
- A Playwright spec builds a document through `dispatchAll`, reads it back, and asserts it
- A Playwright spec exports a trace, replays it into a fresh page, and asserts the documents match

## Test output

An agent reads failures without opening a browser, so failures have to say what broke and why.

- A failed command assertion prints the command, the error code, and a diff of expected against actual document
- A golden-file mismatch prints a unified diff of the JSON
- A replay divergence prints the `seq`, the command, and both outcomes
- Playwright runs with `--reporter=list`, traces on first retry, and screenshots on failure

Scripts:

```
npm test           vitest, headless, the default loop
npm run test:e2e   playwright
npm run verify     typecheck + lint + test + test:e2e
npm run dev        vite dev server
```

## Done when

`npm run verify` passes, and an agent can start the app, build a five-element domain through the runtime API, save it, reload it, filter it by tag, and replay the session trace to an identical document.
