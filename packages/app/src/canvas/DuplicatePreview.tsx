import { ViewportPortal } from '@xyflow/react';
import type { Point } from '@modl/core';
import type { CopyRect } from './duplication.js';

/**
 * Where an alt+drag would drop its copies. The originals stay drawn where
 * they are, so the board only changes once the gesture is released.
 */
export function DuplicatePreview({ rects, offset }: { rects: readonly CopyRect[]; offset: Point }) {
  return (
    <ViewportPortal>
      {rects.map((rect, index) => (
        <div
          key={index}
          className="duplicate-preview"
          data-testid="duplicate-preview"
          style={{
            transform: `translate(${rect.x + offset.x}px, ${rect.y + offset.y}px)`,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
    </ViewportPortal>
  );
}
