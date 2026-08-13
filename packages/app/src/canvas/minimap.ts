import type { ElementStyle } from '@modl/core';
import { withAlpha } from './styling.js';

/**
 * Minimap colours, picked by WCAG luminance ratio against the minimap
 * background (#171a21). The previous flat fill sat at 1.8:1 and its dimmed
 * variant at 1.2:1, so shapes merged on dense boards (issue #75).
 */
export const MINIMAP_BG = '#171a21';
/** 4.9:1 against the background. */
const FILL = '#7e88a0';
/** 8.6:1, so nested and adjacent boxes keep a visible seam. */
const STROKE = '#aeb7c9';
/** 2.0:1: visible, and clearly fainter than a match at 4.9:1. */
const DIMMED_FILL = '#454c5c';
/** 2.9:1. */
const DIMMED_STROKE = '#5a6275';

/**
 * How much of an author's colour survives dimming, sitting an authored
 * dimmed fill near the 2.0:1 of the plain dimmed fill.
 */
const DIMMED_BLEND = 0.35;

/**
 * An expanded container paints before its members, so a solid fill would
 * bury them; a tint this faint leaves them readable on top.
 */
const CONTAINER_FILL_ALPHA = 0.15;

/** `#rrggbb` mixed over the minimap background at the given opacity. */
function dimOver(hex: string, alpha: number): string {
  const channel = (source: string, at: number) => parseInt(source.slice(at, at + 2), 16);
  const mixed = [1, 3, 5]
    .map((at) => Math.round(alpha * channel(hex, at) + (1 - alpha) * channel(MINIMAP_BG, at)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `#${mixed}`;
}

interface MiniMapElement {
  dimmed: boolean;
  openContainer: boolean;
  style: ElementStyle | undefined;
}

/** The fields the minimap needs, read out of a React Flow node's data. */
export function miniMapElementOf(data: Record<string, unknown>): MiniMapElement {
  return {
    dimmed: data['dimmed'] === true,
    openContainer: data['isContainer'] === true && data['expanded'] === true,
    style: data['style'] as ElementStyle | undefined,
  };
}

/** Fill for one minimap rectangle, honouring dimming and authored colour. */
export function miniMapFill(element: MiniMapElement): string {
  const authored = element.style?.fill;
  const solid =
    authored === undefined
      ? element.dimmed
        ? DIMMED_FILL
        : FILL
      : element.dimmed
        ? dimOver(authored, DIMMED_BLEND)
        : authored;
  return element.openContainer ? withAlpha(solid, CONTAINER_FILL_ALPHA) : solid;
}

/** Stroke for one minimap rectangle, honouring dimming and authored colour. */
export function miniMapStroke(element: MiniMapElement): string {
  const authored = element.style?.stroke;
  if (authored === undefined) return element.dimmed ? DIMMED_STROKE : STROKE;
  return element.dimmed ? dimOver(authored, DIMMED_BLEND) : authored;
}
