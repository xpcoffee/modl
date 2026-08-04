import type { ElementStyle } from '@modl/core';
import type { StylePatch } from '@modl/core';

/**
 * The style the reader chose last, applied to whatever they create next.
 *
 * A UI mode rather than domain state, like the placement picker: it stays out
 * of the document and the trace, because the create command it feeds carries
 * the style explicitly and a replay needs nothing else.
 */
let last: ElementStyle = {};

/** Folds an edit into the memory. `null` cleared the field, so forget it too. */
export function rememberStyle(patch: StylePatch): void {
  const next = { ...last };
  for (const field of ['fill', 'stroke', 'strokeStyle', 'arrowhead'] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value === null) delete next[field];
    else next[field] = value as never;
  }
  last = next;
}

/** What a new entity or connection node should wear, or undefined for the default look. */
export function lastEntityStyle(): ElementStyle | undefined {
  const { fill, stroke, strokeStyle } = last;
  const style = {
    ...(fill === undefined ? {} : { fill }),
    ...(stroke === undefined ? {} : { stroke }),
    ...(strokeStyle === undefined ? {} : { strokeStyle }),
  };
  return Object.keys(style).length === 0 ? undefined : style;
}

/** What a new connection should wear, or undefined for the default look. */
export function lastConnectionStyle(): ElementStyle | undefined {
  const { stroke, strokeStyle, arrowhead } = last;
  const style = {
    ...(stroke === undefined ? {} : { stroke }),
    ...(strokeStyle === undefined ? {} : { strokeStyle }),
    ...(arrowhead === undefined ? {} : { arrowhead }),
  };
  return Object.keys(style).length === 0 ? undefined : style;
}

/** Test seam: a fresh session forgets the last choice. */
export function forgetStyle(): void {
  last = {};
}
