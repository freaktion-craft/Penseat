"use client";

import {
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";

export interface Stroke {
  points: { x: number; y: number; time: number }[];
  color: string;
  width: number;
}

export interface DrawingCanvasHandle {
  undo: () => void;
  clear: () => void;
  getCanvas: () => HTMLCanvasElement | null;
  hasStrokes: () => boolean;
}

interface DrawingCanvasProps {
  active: boolean;
  color: string;
  strokeWidth?: number;
}

const FIBERS = 5;

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas({ active, color, strokeWidth = 8 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // Offscreen canvas caches all finalized strokes (with filter applied)
    const cacheCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const strokesRef = useRef<Stroke[]>([]);
    const currentStrokeRef = useRef<Stroke | null>(null);
    const isDrawingRef = useRef(false);
    const rafRef = useRef<number>(0);
    const fpsRef = useRef({ frames: 0, lastTime: performance.now(), fps: 0 });
    const fpsElRef = useRef<HTMLDivElement>(null);

    // Get or create the offscreen cache canvas, synced to main canvas size
    function getCacheCanvas(): HTMLCanvasElement {
      const main = canvasRef.current!;
      if (
        !cacheCanvasRef.current ||
        cacheCanvasRef.current.width !== main.width ||
        cacheCanvasRef.current.height !== main.height
      ) {
        const c = document.createElement("canvas");
        c.width = main.width;
        c.height = main.height;
        cacheCanvasRef.current = c;
      }
      return cacheCanvasRef.current;
    }

    // Resize canvas to match full document
    const resizeCanvas = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const dpr = window.devicePixelRatio || 1;
      const docWidth = Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
        window.innerWidth
      );
      const docHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        window.innerHeight
      );

      canvas.width = docWidth * dpr;
      canvas.height = docHeight * dpr;
      canvas.style.width = `${docWidth}px`;
      canvas.style.height = `${docHeight}px`;

      // Invalidate cache and redraw
      cacheCanvasRef.current = null;
      rebuildCache();
      compositeToScreen();
    }, []);

    // Rebuild the offscreen cache from all finalized strokes
    function rebuildCache() {
      const main = canvasRef.current;
      if (!main) return;
      const cache = getCacheCanvas();
      const ctx = cache.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, cache.width, cache.height);
      ctx.scale(dpr, dpr);
      for (const stroke of strokesRef.current) {
        drawStroke(ctx, stroke);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Append a single stroke to the cache (avoids full rebuild)
    function appendToCache(stroke: Stroke) {
      const cache = getCacheCanvas();
      const ctx = cache.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;

      ctx.scale(dpr, dpr);
      drawStroke(ctx, stroke);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Composite: cache + live stroke → screen
    function compositeToScreen(liveStroke?: Stroke) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Blit cached strokes
      const cache = getCacheCanvas();
      ctx.drawImage(cache, 0, 0);

      // Draw live stroke on top (same filter — consistent look)
      if (liveStroke && liveStroke.points.length >= 2) {
        ctx.scale(dpr, dpr);
        drawStroke(ctx, liveStroke);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }

    // Update FPS counter
    function updateFps() {
      const f = fpsRef.current;
      f.frames++;
      const now = performance.now();
      const delta = now - f.lastTime;
      if (delta >= 500) {
        f.fps = Math.round((f.frames * 1000) / delta);
        f.frames = 0;
        f.lastTime = now;
        if (fpsElRef.current) {
          fpsElRef.current.textContent = `${f.fps} fps`;
        }
      }
    }

    // Draw a single stroke with marker texture
    // SVG filter always applied — consistent look live and finalized
    function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
      if (stroke.points.length < 2) return;

      ctx.save();
      ctx.filter = "url(#penseat-marker-filter)";

      const fiberWidth = stroke.width / FIBERS;

      for (let f = 0; f < FIBERS; f++) {
        const offset = (f - (FIBERS - 1) / 2) * fiberWidth * 0.8;

        // Edge fibers slightly transparent for soft edges
        ctx.globalAlpha = f === 0 || f === FIBERS - 1 ? 0.7 : 1;
        ctx.strokeStyle = stroke.color;
        ctx.lineCap = "butt";
        ctx.lineJoin = "round";
        ctx.lineWidth = fiberWidth;

        ctx.beginPath();

        const p0 = stroke.points[0];
        const p1 = stroke.points[1];
        const angle0 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        ctx.moveTo(
          p0.x + Math.cos(angle0 + Math.PI / 2) * offset,
          p0.y + Math.sin(angle0 + Math.PI / 2) * offset
        );

        for (let i = 1; i < stroke.points.length - 1; i++) {
          const curr = stroke.points[i];
          const next = stroke.points[i + 1];
          const angle = Math.atan2(next.y - curr.y, next.x - curr.x);
          const ox = Math.cos(angle + Math.PI / 2) * offset;
          const oy = Math.sin(angle + Math.PI / 2) * offset;
          const midX = (curr.x + next.x) / 2 + ox;
          const midY = (curr.y + next.y) / 2 + oy;
          ctx.quadraticCurveTo(curr.x + ox, curr.y + oy, midX, midY);
        }

        const last = stroke.points[stroke.points.length - 1];
        const prev = stroke.points[stroke.points.length - 2];
        const angleLast = Math.atan2(last.y - prev.y, last.x - prev.x);
        ctx.lineTo(
          last.x + Math.cos(angleLast + Math.PI / 2) * offset,
          last.y + Math.sin(angleLast + Math.PI / 2) * offset
        );

        ctx.stroke();
      }

      ctx.restore();
    }

    // Get document-space coordinates from pointer event
    function getDocCoords(e: PointerEvent): { x: number; y: number } {
      return {
        x: e.pageX,
        y: e.pageY,
      };
    }

    // Pointer handlers
    const handlePointerDown = useCallback(
      (e: PointerEvent) => {
        if (!active) return;
        e.preventDefault();
        isDrawingRef.current = true;
        const pos = getDocCoords(e);
        currentStrokeRef.current = {
          points: [{ ...pos, time: Date.now() }],
          color,
          width: strokeWidth,
        };
      },
      [active, color, strokeWidth]
    );

    const handlePointerMove = useCallback(
      (e: PointerEvent) => {
        if (!isDrawingRef.current || !currentStrokeRef.current) return;
        e.preventDefault();
        const pos = getDocCoords(e);
        currentStrokeRef.current.points.push({ ...pos, time: Date.now() });

        // Only composite: cached strokes + live stroke
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          if (!currentStrokeRef.current) return;
          compositeToScreen(currentStrokeRef.current);
          updateFps();
        });
      },
      []
    );

    const handlePointerUp = useCallback(() => {
      if (!isDrawingRef.current || !currentStrokeRef.current) return;
      isDrawingRef.current = false;

      if (currentStrokeRef.current.points.length >= 2) {
        strokesRef.current = [...strokesRef.current, currentStrokeRef.current];
        // Append to cache instead of full rebuild
        appendToCache(currentStrokeRef.current);
      }
      currentStrokeRef.current = null;
      compositeToScreen();
    }, []);

    // Attach/detach pointer listeners on the canvas
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (active) {
        canvas.addEventListener("pointerdown", handlePointerDown);
        canvas.addEventListener("pointermove", handlePointerMove);
        canvas.addEventListener("pointerup", handlePointerUp);
        canvas.addEventListener("pointerleave", handlePointerUp);
      }

      return () => {
        canvas.removeEventListener("pointerdown", handlePointerDown);
        canvas.removeEventListener("pointermove", handlePointerMove);
        canvas.removeEventListener("pointerup", handlePointerUp);
        canvas.removeEventListener("pointerleave", handlePointerUp);
      };
    }, [active, handlePointerDown, handlePointerMove, handlePointerUp]);

    // Resize observer
    useEffect(() => {
      resizeCanvas();

      const observer = new ResizeObserver(() => resizeCanvas());
      observer.observe(document.body);
      window.addEventListener("resize", resizeCanvas);

      return () => {
        observer.disconnect();
        window.removeEventListener("resize", resizeCanvas);
      };
    }, [resizeCanvas]);

    // Expose imperative methods
    useImperativeHandle(ref, () => ({
      undo() {
        strokesRef.current = strokesRef.current.slice(0, -1);
        rebuildCache();
        compositeToScreen();
      },
      clear() {
        strokesRef.current = [];
        cacheCanvasRef.current = null;
        getCacheCanvas();
        compositeToScreen();
      },
      getCanvas() {
        return canvasRef.current;
      },
      hasStrokes() {
        return strokesRef.current.length > 0;
      },
    }));

    return (
      <>
        {/* SVG filter for marker edge texture */}
        <svg width="0" height="0" className="absolute">
          <defs>
            <filter id="penseat-marker-filter" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence
                type="turbulence"
                baseFrequency="0.04"
                numOctaves="4"
                seed="2"
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="2"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>
        <canvas
          ref={canvasRef}
          data-penseat="canvas"
          className="absolute top-0 left-0"
          style={{
            pointerEvents: active ? "auto" : "none",
            cursor: active ? "crosshair" : "default",
            zIndex: active ? 9998 : -1,
            touchAction: "none",
          }}
        />
        {active && (
          <div
            ref={fpsElRef}
            data-penseat="fps"
            className="fixed bottom-5 left-5 z-[9999] rounded-md bg-zinc-900/90 px-2 py-1 font-mono text-xs text-zinc-400"
          >
            -- fps
          </div>
        )}
      </>
    );
  }
);

export default DrawingCanvas;
