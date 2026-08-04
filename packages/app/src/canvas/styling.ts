import type { CSSProperties } from 'react';
import type { ElementStyle } from '@modl/core';

/**
 * A fill is a tint, not a coat of paint: the issue asked for "mostly
 * transparent", so a coloured box stays legible on the dark canvas and the
 * title keeps its contrast.
 */
export const FILL_ALPHA = 0.16;

/** `#rrggbb` to `rgba(r, g, b, alpha)`. The reducer guarantees the format. */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Inline CSS for a box-shaped element. Empty when the style is the default. */
export function boxCss(style: ElementStyle | undefined): CSSProperties {
  if (!style) return {};
  return {
    ...(style.fill === undefined ? {} : { background: withAlpha(style.fill, FILL_ALPHA) }),
    ...(style.stroke === undefined ? {} : { borderColor: style.stroke }),
    ...(style.strokeStyle === undefined || style.strokeStyle === 'solid'
      ? {}
      : { borderStyle: style.strokeStyle }),
  };
}

/** Inline CSS for a connection's path. Empty when the style is the default. */
export function lineCss(style: ElementStyle | undefined): CSSProperties {
  return {
    ...(style?.stroke === undefined ? {} : { stroke: style.stroke }),
    ...(style?.strokeStyle === 'dashed' ? { strokeDasharray: '7 5' } : {}),
    ...(style?.strokeStyle === 'dotted'
      ? { strokeDasharray: '1.5 4', strokeLinecap: 'round' as const }
      : {}),
  };
}

/**
 * An SVG marker cannot read the colour of the line that references it, so
 * every (glyph, colour) pair a document uses gets its own def. This names the
 * def a connection should point at; ArrowMarkers draws the matching set.
 */
export function arrowMarkerId(style: ElementStyle | undefined): string | null {
  const glyph = style?.arrowhead ?? 'triangle';
  const colour = style?.stroke;
  // The plain triangle keeps its original ids, drawn once and styled by CSS.
  if (glyph === 'triangle' && colour === undefined) return null;
  return `modl-arrow-${glyph}-${colour === undefined ? 'default' : colour.slice(1)}`;
}

export function markerRefs(style: ElementStyle | undefined): { start: string; end: string } {
  const id = arrowMarkerId(style);
  if (id === null) return { start: 'url(#modl-arrow-start)', end: 'url(#modl-arrow-end)' };
  return { start: `url(#${id})`, end: `url(#${id})` };
}
