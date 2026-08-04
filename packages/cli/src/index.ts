#!/usr/bin/env node
/**
 * modl command line, for building and checking documents without the board.
 *
 *   modl check   <file>                report structure and layout problems
 *   modl layout  <file> [-o out]       fill in missing positions
 *   modl render  <file> [-o out.png]   draw the document as the app would
 *   modl schema  [-o out.json]         emit the format as JSON Schema
 *
 * Written for an agent producing a document as part of some other job: it can
 * emit structure, ask whether the layout reads, and look at the result.
 */
import { readFile, writeFile } from 'node:fs/promises';
import {
  autoLayout,
  documentJsonSchema,
  inspectLayout,
  parseDocument,
  serializeDocument,
} from '@modl/core';
import type { Document } from '@modl/core';
import { renderDocument } from './render.ts';

const USAGE = `modl <command> <file> [options]

  check    <file>               structure and layout problems (alias: validate)
  layout   <file> [-o <file>]   place entities that have no position
  render   <file> [-o <file>]   draw the document to a PNG
  schema   [-o <file>]          print the document format as JSON Schema

Options
  -o, --out <file>   where to write (default: alongside the input)
  --width <px>       render width (default 1600)
  --height <px>      render height (default 1000)
`;

interface Args {
  command: string;
  file: string;
  out: string | undefined;
  width: number;
  height: number;
}

function parseArgs(argv: string[]): Args | null {
  const [command, second, ...more] = argv;
  if (!command) return null;

  // `schema` takes no file, so the second word is already an option.
  const takesFile = command !== 'schema';
  const file = (takesFile ? second : '') ?? '';
  const rest = takesFile ? more : [second, ...more].filter((x): x is string => x !== undefined);
  if (takesFile && !file) return null;

  let out: string | undefined;
  let width = 1600;
  let height = 1000;

  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    if ((flag === '-o' || flag === '--out') && value) {
      out = value;
      i += 1;
    } else if (flag === '--width' && value) {
      width = Number(value);
      i += 1;
    } else if (flag === '--height' && value) {
      height = Number(value);
      i += 1;
    }
  }
  return { command, file, out, width, height };
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
  process.exit(1);
}

/** Fills in positions the producer did not supply. */
async function layout(args: Args): Promise<void> {
  const document = await load(args.file);
  const placed = autoLayout(document);
  const out = args.out ?? args.file;
  await writeFile(out, serializeDocument(placed), 'utf8');
  console.log(`wrote ${out}`);
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
  layout,
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
