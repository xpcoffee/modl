#!/usr/bin/env node
/**
 * modl command line, for building and checking documents without the board.
 *
 *   modl check   <file>                report structure and layout problems
 *   modl dump    <file>                print the model as text
 *   modl query   <file> <id>           print one element's neighbourhood
 *   modl layout  <file> [-o out]       fill in missing positions
 *   modl reflow  <file> [-o out]       re-space what is already placed
 *   modl render  <file> [-o out.png]   draw the document as the app would
 *   modl schema  [-o out.json]         emit the format as JSON Schema
 *
 * Written for an agent producing or reviewing a document as part of some
 * other job: it can emit structure, read it back, ask whether the layout
 * reads, and look at the result.
 */
import { readFile, writeFile } from 'node:fs/promises';
import {
  applyAll,
  autoLayout,
  documentJsonSchema,
  dumpDocument,
  groupIds,
  initialState,
  inspectLayout,
  neighbourhoodOf,
  parseDocument,
  planCompact,
  planReflow,
  renderNeighbourhood,
  serializeDocument,
} from '@modl/core';
import type { Document } from '@modl/core';
import { renderDocument } from './render.ts';

const USAGE = `modl <command> <file> [options]

  check    <file>               structure and layout problems (alias: validate)
  dump     <file>               the model as text: an element table and a connection list
  query    <file> <id>          one element's connections, siblings, members, and comments
  layout   <file> [-o <file>]   place entities that have no position
  reflow   <file> [-o <file>]   re-space what is already placed
  render   <file> [-o <file>]   draw the document to a PNG
  schema   [-o <file>]          print the document format as JSON Schema

Options
  -o, --out <file>   where to write (default: alongside the input)
  --expand-all       reflow: open every group, so members re-space inside
                     the container that holds them
  --compact          reflow: pack each scope into rows of bounded width,
                     instead of holding room for every connection label
  --width <px>       render width (default 1600)
  --height <px>      render height (default 1000)
  --json             query only: print the neighbourhood as JSON
`;

interface Args {
  command: string;
  file: string;
  id: string | undefined;
  out: string | undefined;
  expandAll: boolean;
  compact: boolean;
  width: number;
  height: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args | null {
  const [command, second, ...more] = argv;
  if (!command) return null;

  // `schema` takes no file, so the second word is already an option.
  const takesFile = command !== 'schema';
  const file = (takesFile ? second : '') ?? '';
  const rest = takesFile ? more : [second, ...more].filter((x): x is string => x !== undefined);
  if (takesFile && !file) return null;

  let id: string | undefined;
  let out: string | undefined;
  let expandAll = false;
  let compact = false;
  let width = 1600;
  let height = 1000;
  let json = false;

  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    if ((flag === '-o' || flag === '--out') && value) {
      out = value;
      i += 1;
    } else if (flag === '--expand-all') {
      expandAll = true;
    } else if (flag === '--compact') {
      compact = true;
    } else if (flag === '--width' && value) {
      width = Number(value);
      i += 1;
    } else if (flag === '--height' && value) {
      height = Number(value);
      i += 1;
    } else if (flag === '--json') {
      json = true;
    } else if (flag !== undefined && !flag.startsWith('-') && id === undefined) {
      id = flag;
    }
  }
  if (command === 'query' && id === undefined) return null;
  return { command, file, id, out, expandAll, compact, width, height, json };
}

async function load(file: string): Promise<Document> {
  const result = parseDocument(await readFile(file, 'utf8'));
  if (!result.ok) {
    console.error(`${file} could not be read:`);
    for (const error of result.errors) console.error(`  ${error.code}: ${error.message}`);
    process.exit(1);
  }
  for (const warning of result.warnings) {
    console.error(`  warning ${warning.code}: ${warning.message}`);
  }
  return result.document;
}

async function schema(args: Args): Promise<void> {
  const text = `${JSON.stringify(documentJsonSchema(), null, 2)}\n`;
  if (args.out) {
    await writeFile(args.out, text, 'utf8');
    console.log(`wrote ${args.out}`);
    return;
  }
  process.stdout.write(text);
}

/** Reports what a reader would find hard to follow. Exits 1 on any issue. */
async function check(args: Args): Promise<void> {
  const document = await load(args.file);
  const report = inspectLayout(document);

  console.log(`${report.entityCount} entities, ${report.connectionCount} connections`);
  if (report.bounds) {
    const { width, height } = report.bounds;
    console.log(`bounds ${Math.round(width)} x ${Math.round(height)}`);
  }

  if (report.issues.length === 0) {
    console.log('layout reads cleanly');
    return;
  }

  console.log(`\n${report.issues.length} layout issues:`);
  for (const issue of report.issues) {
    console.log(`  ${issue.code}: ${issue.message}`);
  }
  console.log('\n`modl layout` places entities that have no position.');
  console.log('`modl reflow --expand-all` re-spaces overlapping ones inside their containers.');
  process.exit(1);
}

/** Prints the model as text, for a terminal or a PR diff. */
async function dump(args: Args): Promise<void> {
  const document = await load(args.file);
  console.log(dumpDocument(document));
}

/** Prints one element's neighbourhood, so acting on it needs no jq pass. */
async function query(args: Args): Promise<void> {
  const document = await load(args.file);
  const id = args.id ?? '';
  const found = neighbourhoodOf(document, id);
  if (!found) {
    console.error(`no element with id "${id}" in ${args.file}`);
    process.exit(1);
  }
  console.log(args.json ? JSON.stringify(found, null, 2) : renderNeighbourhood(document, id));
}

/** Fills in positions the producer did not supply. */
async function layout(args: Args): Promise<void> {
  const document = await load(args.file);
  const placed = autoLayout(document);
  const out = args.out ?? args.file;
  await writeFile(out, serializeDocument(placed), 'utf8');
  console.log(`wrote ${out}`);
}

/**
 * Re-spaces what is already placed, as the board's reflow button would.
 *
 * The app reflows over the groups the reader has expanded. A file has no
 * reader, so by default every group stays collapsed, which is how the app
 * and `modl render` first draw the document; `--expand-all` opens every
 * container so members re-space inside it, which is what a generated
 * document with placed members needs.
 */
async function reflow(args: Args): Promise<void> {
  const document = await load(args.file);
  const expanded = args.expandAll ? groupIds(document.model.elements) : [];
  const view = { document, expanded };
  const plan = args.compact ? planCompact(view) : planReflow(view);
  const out = args.out ?? args.file;

  if (!plan) {
    if (out !== args.file) await writeFile(out, serializeDocument(document), 'utf8');
    console.log('nothing to move');
    return;
  }

  // The plan lands through the same command the board dispatches, so the
  // reducer's validation covers the file the same way it covers a session.
  const result = applyAll(
    { ...initialState(document.id), document, expanded },
    [{ type: 'reflow-layout', ...plan }],
  );
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  await writeFile(out, serializeDocument(result.state.document), 'utf8');

  const size = (bounds: { width: number; height: number } | null): string =>
    bounds ? `${Math.round(bounds.width)} x ${Math.round(bounds.height)}` : 'empty';
  const before = inspectLayout(document).bounds;
  const after = inspectLayout(result.state.document).bounds;
  console.log(`wrote ${out} (bounds ${size(before)} -> ${size(after)})`);
}

/** Draws the document exactly as the app draws it. */
async function render(args: Args): Promise<void> {
  const document = await load(args.file);
  const out = args.out ?? args.file.replace(/\.modl\.json$|\.json$/, '') + '.png';
  await renderDocument(document, { out, width: args.width, height: args.height });
  console.log(`wrote ${out}`);
}

const args = parseArgs(process.argv.slice(2));
if (!args) {
  console.log(USAGE);
  process.exit(1);
}

const commands: Record<string, (args: Args) => Promise<void>> = {
  check,
  validate: check,
  dump,
  query,
  layout,
  reflow,
  render,
  schema,
};
const run = commands[args.command];
if (!run) {
  console.error(`unknown command "${args.command}"\n`);
  console.log(USAGE);
  process.exit(1);
}

try {
  await run(args);
} catch (cause) {
  // A stack trace says nothing a caller can act on. The message does.
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
}
