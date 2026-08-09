import { useEffect, useRef } from 'react';
import { useViewport } from '@xyflow/react';
import {
  activeRipples,
  ripplesStarted,
  subscribeAnimations,
  RIPPLE_MS,
  type Ripple,
} from './animations.js';
import { useMotionReduced } from '../preferences/motion.js';

/** Flow pixels between dots, matching the React Flow grid this replaces. */
const GAP = 20;
/** Dot radius in flow pixels. */
const DOT_RADIUS = 0.75;
/** Resting dot, --muted at low alpha. */
const DOT_RGB = [139, 147, 167] as const;
const DOT_ALPHA = 0.45;
/** The light pulse tints toward --accent (#5b8def). */
const GLOW_RGB = [91, 141, 239] as const;
/** Spatial width of the travelling wavefront, in flow pixels. */
const WAVE_WIDTH = 30;
/** Below this a dot draws as resting, keeping the shared path fast. */
const GLOW_FLOOR = 0.03;

/**
 * The dot grid, drawn on a canvas so gravity-wave ripples can displace the
 * dots. React Flow's own Background is an SVG pattern, which repeats one tile
 * and so cannot bend around a point.
 *
 * Sits where the Background sat: behind the pane, ignoring the pointer.
 */
export function GravityGrid() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionReduced = useMotionReduced();
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
      // A wave is measured in flow pixels, so zooming out shrinks it on
      // screen: at 25% a press wave spanned about 30 pixels and moved a dot
      // by one, which is nothing to see (issue #30). Below 100% the wave is
      // spread by the inverse of the zoom, holding its size on screen. At or
      // above 100% it stays pinned to the board, where an element's wave is
      // meant to be element-sized.
      const spread = 1 / Math.min(zoom, 1);

      const radius = Math.max(0.4, DOT_RADIUS * zoom);
      const lit: { x: number; y: number; glow: number }[] = [];

      context.fillStyle = `rgb(${DOT_RGB.join(' ')} / ${DOT_ALPHA})`;
      context.beginPath();
      for (let gridX = Math.floor(left / gap) * gap; gridX <= right; gridX += gap) {
        for (let gridY = Math.floor(top / gap) * gap; gridY <= bottom; gridY += gap) {
          let x = gridX;
          let y = gridY;
          let glow = 0;
          for (const ripple of ripples) {
            const [dx, dy, light] = waveAt(gridX, gridY, ripple, now, spread);
            x += dx;
            y += dy;
            glow = Math.max(glow, light);
          }
          const screenX = x * zoom + viewX;
          const screenY = y * zoom + viewY;
          if (glow > GLOW_FLOOR) {
            lit.push({ x: screenX, y: screenY, glow: Math.min(glow, 1) });
          } else {
            context.moveTo(screenX + radius, screenY);
            context.arc(screenX, screenY, radius, 0, Math.PI * 2);
          }
        }
      }
      context.fill();

      // Dots the wavefront is passing: tinted toward the accent blue under a
      // soft halo, so the wave reads as light as well as motion. Only the
      // narrow band around each front lands here, so per-dot fills stay cheap.
      for (const dot of lit) {
        const mix = (index: 0 | 1 | 2): number =>
          Math.round(DOT_RGB[index] + (GLOW_RGB[index] - DOT_RGB[index]) * dot.glow);

        context.fillStyle = `rgb(${GLOW_RGB.join(' ')} / ${0.22 * dot.glow})`;
        context.beginPath();
        context.arc(dot.x, dot.y, radius * (3 + 2 * dot.glow), 0, Math.PI * 2);
        context.fill();

        context.fillStyle = `rgb(${mix(0)} ${mix(1)} ${mix(2)} / ${DOT_ALPHA + 0.5 * dot.glow})`;
        context.beginPath();
        context.arc(dot.x, dot.y, radius * (1 + 0.7 * dot.glow), 0, Math.PI * 2);
        context.fill();
      }

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
      data-motion={motionReduced ? 'reduced' : 'full'}
      data-ripples="0"
      data-ripples-started="0"
    />
  );
}

/**
 * What one wave does to a dot as it passes: displacement and light. A
 * Gaussian pulse at the travelling wavefront, damped over time and over
 * distance so the wave stays local and dies out. Dots displace along the
 * radial line, outward for a wave leaving a new element and inward for the
 * field closing over a deleted one; the light pulse rides the same front
 * with the same damping.
 *
 * `spread` scales the whole shape — reach, wavefront width, and displacement
 * together — so a zoomed-out wave keeps its proportions while it keeps its
 * size on screen.
 */
function waveAt(
  x: number,
  y: number,
  ripple: Ripple,
  now: number,
  spread: number,
): [number, number, number] {
  const t = (now - ripple.start) / RIPPLE_MS;
  if (t <= 0 || t >= 1) return [0, 0, 0];

  const reach = ripple.reach * spread;
  const width = WAVE_WIDTH * spread;

  const dx = x - ripple.centre.x;
  const dy = y - ripple.centre.y;
  const distance = Math.hypot(dx, dy) || 1;
  if (distance > reach + width * 3) return [0, 0, 0];

  const front = ripple.kind === 'outward' ? reach * t : reach * (1 - t);
  const pulse = Math.exp(-((distance - front) ** 2) / (2 * width ** 2));
  const fade = 1 - t;
  const falloff = Math.exp(-distance / reach);
  const sign = ripple.kind === 'outward' ? 1 : -1;
  const strength = sign * ripple.amplitude * spread * pulse * fade * falloff;
  const light = ripple.intensity * pulse * fade * falloff;
  return [(dx / distance) * strength, (dy / distance) * strength, light];
}
