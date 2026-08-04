import { ViewportPortal } from '@xyflow/react';
import type { Point } from '@modl/core';

/** The rectangle a drag is sizing, drawn where the element will land. */
export function PlacementPreview({ from, to }: { from: Point; to: Point }) {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  if (width < 4 || height < 4) return null;

  return (
    <ViewportPortal>
      <div
        className="placement-preview"
        data-testid="placement-preview"
        style={{ transform: `translate(${x}px, ${y}px)`, width, height }}
      />
    </ViewportPortal>
  );
}
