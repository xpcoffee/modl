import { ViewportPortal } from '@xyflow/react';
import type { Point } from '@modl/core';

/**
 * The rectangle a begin+end box selection spans so far. React Flow only
 * draws its own selection box for a held drag, so a run between two presses
 * draws this one instead.
 */
export function BoxSelectPreview({ from, to }: { from: Point; to: Point }) {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);

  return (
    <ViewportPortal>
      <div
        className="box-select-preview"
        data-testid="box-select-preview"
        style={{ transform: `translate(${x}px, ${y}px)`, width, height }}
      />
    </ViewportPortal>
  );
}
