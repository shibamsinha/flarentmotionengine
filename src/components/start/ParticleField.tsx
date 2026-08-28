/**
 * The constellation background from flarent.online, ported.
 *
 * White dots drift over the field and bounce off its edges; any pair closer
 * than a threshold is joined by a line whose opacity fades with distance, so
 * the web tightens and loosens as they move. Dots are pushed away from the
 * cursor, which carves a travelling bubble through the field.
 *
 * Canvas 2D and one `requestAnimationFrame` — no library, and nothing here is
 * shared with the Remotion renderer. This is editor chrome; it never touches a
 * reel.
 *
 * Two things are deliberate and easy to break:
 *
 * **It measures its parent, not the window.** `resize()` reads
 * `canvas.parentElement` through a `ResizeObserver`, so the field is correct
 * inside any sized box rather than requiring full-page fixed positioning. The
 * parent must therefore be positioned and have a real height.
 *
 * **The mouse listener is on `window`, not the canvas.** The canvas is
 * `pointer-events: none` so clicks reach the cards on top of it; a listener on
 * the canvas would never fire. Listening on the window keeps repulsion working
 * while the pointer is over that content.
 */

import React, { useEffect, useRef } from 'react';

/** Hard cap on dot count regardless of area. */
const MAX_PARTICLES = 140;
/** Opacity of the strongest connection line. Higher = a more visible web. */
const LINK_OPACITY = 0.16;
/** Repulsion radius around the cursor, in CSS px. */
const MOUSE_RADIUS = 140;
/** Area in px² per particle. Smaller = denser. */
const AREA_PER_PARTICLE = 12000;
/**
 * Connection distance is `(width / DIVISOR) * (height / DIVISOR)` as a squared
 * threshold, so the web keeps its proportions at any size. A larger divisor
 * means shorter lines.
 */
const LINK_DIVISOR = 7;
/** Backing-store scale. Capped so a 3× phone does not get a huge buffer. */
const MAX_DPR = 2;

export type Mouse = { x: number | null; y: number | null; radius: number };

/** Exported so the drift/bounce/repulsion maths can be tested without a DOM. */
export class Particle {
  constructor(
    public x: number,
    public y: number,
    public dx: number,
    public dy: number,
    public size: number,
  ) {}

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
  }

  step(width: number, height: number, mouse: Mouse): void {
    if (this.x > width || this.x < 0) this.dx *= -1;
    if (this.y > height || this.y < 0) this.dy *= -1;

    if (mouse.x !== null && mouse.y !== null) {
      const dx = mouse.x - this.x;
      const dy = mouse.y - this.y;
      const distance = Math.hypot(dx, dy);
      if (distance < mouse.radius + this.size) {
        // 0 at the edge of the radius, →1 at the cursor. The dot is not pulled
        // back afterwards: the deformation persists until it drifts out.
        const force = (mouse.radius - distance) / mouse.radius;
        this.x -= (dx / distance) * force * 4;
        this.y -= (dy / distance) * force * 4;
      }
    }

    this.x += this.dx;
    this.y += this.dy;
  }
}

export const ParticleField: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const section = canvas?.parentElement;
    if (!canvas || !section) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mouse: Mouse = { x: null, y: null, radius: MOUSE_RADIUS };
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

    let particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let rafId = 0;

    const resize = (): void => {
      const rect = section.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      // Draw in CSS pixels, render at device resolution.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(
        MAX_PARTICLES,
        Math.floor((width * height) / AREA_PER_PARTICLE),
      );
      particles = Array.from({ length: count }, () => {
        const size = Math.random() * 1.4 + 0.6;
        return new Particle(
          Math.random() * width,
          Math.random() * height,
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.3,
          size,
        );
      });
    };

    /**
     * Naive O(n²) pass. At ≤140 particles that is under 10k comparisons a
     * frame, far cheaper than the spatial index that would replace it.
     */
    const connect = (): void => {
      const maxDistSq = (width / LINK_DIVISOR) * (height / LINK_DIVISOR);
      for (let a = 0; a < particles.length; a++) {
        for (let b = a + 1; b < particles.length; b++) {
          const dx = particles[a].x - particles[b].x;
          const dy = particles[a].y - particles[b].y;
          // Squared throughout, so no sqrt in the inner loop.
          const distSq = dx * dx + dy * dy;
          if (distSq < maxDistSq) {
            const opacity = (1 - distSq / maxDistSq) * LINK_OPACITY;
            ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            ctx.stroke();
          }
        }
      }
    };

    const renderFrame = (): void => {
      ctx.clearRect(0, 0, width, height);
      for (const particle of particles) {
        particle.step(width, height, mouse);
        particle.draw(ctx);
      }
      connect();
    };

    const animate = (): void => {
      rafId = requestAnimationFrame(animate);
      renderFrame();
    };

    const handleMouseMove = (event: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const inBounds = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      mouse.x = inBounds ? x : null;
      mouse.y = inBounds ? y : null;
    };

    // No relatedTarget means the pointer left the document entirely.
    const handleMouseOut = (event: MouseEvent): void => {
      if (!event.relatedTarget) {
        mouse.x = null;
        mouse.y = null;
      }
    };

    resize();
    renderFrame();

    const observer = new ResizeObserver(resize);
    observer.observe(section);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseout', handleMouseOut);

    // Reduced motion gets the one frame already drawn above and no loop.
    if (!reduced) animate();

    return () => {
      observer.disconnect();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseout', handleMouseOut);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return <canvas ref={canvasRef} className="particle-field" aria-hidden="true" />;
};
