/**
 * Arrowhead definitions, referenced by connections that opt into them. React
 * Flow's built-in markers are per-edge; one shared pair keeps the SVG small.
 */
export function ArrowMarkers() {
  return (
    <svg className="arrow-markers" aria-hidden>
      <defs>
        <marker
          id="modl-arrow-end"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 9 5 L 0 9 z" />
        </marker>
        {/* Same geometry as the end marker: `auto-start-reverse` turns a start
            marker around on its own, so drawing it pre-reversed cancels out
            and the head disappears into the line. */}
        <marker
          id="modl-arrow-start"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 9 5 L 0 9 z" />
        </marker>
      </defs>
    </svg>
  );
}
