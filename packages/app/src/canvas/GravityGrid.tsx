import { useEffect, useRef } from 'react';
import { useViewport } from '@xyflow/react';
import {
  activeRipples,
  motionReduced,
  ripplesStarted,
  subscribeAnimations,
  RIPPLE_MS,
  type Ripple,
} from './animations.js';

/** Flow pixels between dots, matching the React Flow grid this replaces. */
const GAP = 20;
/** Dot radius in flow pixels. */
const DOT_RADIUS = 0.75;
const DOT_COLOR = 'rgb(139 147 167 / 45%)';
/** Spatial width of the travelling wavefront, in flow pixels. */
const WAVE_WIDTH = 30;

/**
 * The dot grid, drawn on a canvas so gravity-wave ripples can displace the
 * dots. React Flow's own Background is an SVG pattern, which repeats one tile
 * and so cannot bend around a point.
 *
 * Sits where the Background sat: behind the pane, ignoring the pointer.
 */
export function GravityGrid() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewport = useViewport();
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const frameRef = useRef<number | null>(null);
  const drawRef = useRef<(now: number) => void>(() => undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = (now: number): void => {
      const context = canvas.getContext('2d');
      if (!context) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const scale = window.devicePixelRatio || 1;
      if (canvas.width !== width * scale || canvas.height !== height * scale) {
        canvas.width = width * scale;
        canvas.height = height * scale;
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, height);

      const { x: viewX, y: viewY, zoom } = viewportRef.current;
      // Zoomed far out the dots pack together; widening the gap keeps the
      // number of dots bounded.
      let gap = GAP;
      while (gap * zoom < 8) gap *= 2;

      const left = -viewX / zoom;
      const top = -viewY / zoom;
      const right = left + width / zoom;
      const bottom = top + height / zoom;
      const ripples = activeRipples(now);

      context.fillStyle = DOT_COLOR;
      context.beginPath();
      const radius = Math.max(0.4, DOT_RADIUS * zoom);
      for (let gridX = Math.floor(left / gap) * gap; gridX <= right; gridX += gap) {
        for (let gridY = Math.floor(top / gap) * gap; gridY <= bottom; gridY += gap) {
          let x = gridX;
          let y = gridY;
          for (const ripple of ripples) {
            const [dx, dy] = displacement(gridX, gridY, ripple, now);
            x += dx;
            y += dy;
          }
          const screenX = x * zoom + viewX;
          const screenY = y * zoom + viewY;
          context.moveTo(screenX + radius, screenY);
          context.arc(screenX, screenY, radius, 0, Math.PI * 2);
        }
      }
      context.fill();

      canvas.dataset['ripples'] = String(ripples.length);
      canvas.dataset['ripplesStarted'] = String(ripplesStarted());
    };

    const loop = (): void => {
      draw(performance.now());
      frameRef.current =
        activeRipples(performance.now()).length > 0 ? requestAnimationFrame(loop) : null;
    };

    const wake = (): void => {
      if (frameRef.current === null && activeRipples(performance.now()).length > 0) {
        frameRef.current = requestAnimationFrame(loop);
      }
    };

    drawRef.current = draw;
    draw(performance.now());
    const observer = new ResizeObserver(() => draw(performance.now()));
    observer.observe(canvas);
    const unsubscribe = subscribeAnimations(wake);

    return () => {
      observer.disconnect();
      unsubscribe();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, []);

  // A pan or zoom moves the grid under the dots, so redraw for it here; while
  // a wave is running the animation loop already redraws every frame.
  useEffect(() => {
    if (frameRef.current === null) drawRef.current(performance.now());
  }, [viewport]);

  return (
    <canvas
      ref={canvasRef}
      className="gravity-grid"
      data-testid="gravity-grid"
      data-motion={motionReduced() ? 'reduced' : 'full'}
      data-ripples="0"
      data-ripples-started="0"
    />
  );
}

/**
 * How far a dot moves as one wave passes: a Gaussian pulse at the travelling
 * wavefront, damped over time and over distance so the wave stays local and
 * dies out. Dots displace along the radial line, outward for a wave leaving a
 * new element and inward for the field closing over a deleted one.
 */
function displacement(x: number, y: number, ripple: Ripple, now: number): [number, number] {
  const t = (now - ripple.start) / RIPPLE_MS;
  if (t <= 0 || t >= 1) return [0, 0];

  const dx = x - ripple.centre.x;
  const dy = y - ripple.centre.y;
  const distance = Math.hypot(dx, dy) || 1;
  if (distance > ripple.reach + WAVE_WIDTH * 3) return [0, 0];

  const front = ripple.kind === 'outward' ? ripple.reach * t : ripple.reach * (1 - t);
  const pulse = Math.exp(-((distance - front) ** 2) / (2 * WAVE_WIDTH ** 2));
  const fade = 1 - t;
  const falloff = Math.exp(-distance / ripple.reach);
  const sign = ripple.kind === 'outward' ? 1 : -1;
  const strength = sign * ripple.amplitude * pulse * fade * falloff;
  return [(dx / distance) * strength, (dy / distance) * strength];
}
