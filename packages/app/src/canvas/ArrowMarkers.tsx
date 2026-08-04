import { isConnection, type Arrowhead } from '@modl/core';
import { useAppState } from '../store/useStore.js';
import { arrowMarkerId } from './styling.js';

/** Marker geometry shared by every def: a 10x10 box with the tip at the ref. */
const FRAME = {
  viewBox: '0 0 10 10',
  refX: 9,
  refY: 5,
  markerWidth: 6,
  markerHeight: 6,
  orient: 'auto-start-reverse',
} as const;

function glyphPath(glyph: Arrowhead, colour: string) {
  if (glyph === 'open') {
    return <path d="M 1 1 L 9 5 L 1 9" fill="none" style={{ stroke: colour }} strokeWidth="1.6" />;
  }
  if (glyph === 'diamond') {
    return <path d="M 1 5 L 5 1 L 9 5 L 5 9 z" style={{ fill: colour }} />;
  }
  return <path d="M 0 1 L 9 5 L 0 9 z" style={{ fill: colour }} />;
}

/**
 * Arrowhead definitions, referenced by connections that opt into them. React
 * Flow's built-in markers are per-edge; shared defs keep the SVG small.
 *
 * The plain triangle pair is always present. Beyond it, one def per
 * (glyph, colour) pair the document uses, because a marker cannot inherit the
 * stroke of the line that references it.
 */
export function ArrowMarkers() {
  const state = useAppState();

  const variants = new Map<string, { glyph: Arrowhead; colour: string }>();
  for (const element of Object.values(state.document.model.elements)) {
    if (!isConnection(element)) continue;
    const id = arrowMarkerId(element.style);
    if (id === null || variants.has(id)) continue;
    variants.set(id, {
      glyph: element.style?.arrowhead ?? 'triangle',
      colour: element.style?.stroke ?? 'var(--muted)',
    });
  }

  return (
    <svg className="arrow-markers" aria-hidden>
      <defs>
        <marker id="modl-arrow-end" {...FRAME}>
          <path d="M 0 1 L 9 5 L 0 9 z" />
        </marker>
        {/* Same geometry as the end marker: `auto-start-reverse` turns a start
            marker around on its own, so drawing it pre-reversed cancels out
            and the head disappears into the line. */}
        <marker id="modl-arrow-start" {...FRAME}>
          <path d="M 0 1 L 9 5 L 0 9 z" />
        </marker>
        {[...variants.entries()].map(([id, { glyph, colour }]) => (
          <marker key={id} id={id} {...FRAME}>
            {glyphPath(glyph, colour)}
          </marker>
        ))}
      </defs>
    </svg>
  );
}
