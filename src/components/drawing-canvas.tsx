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
const DRY_DURATION = 1200; // ms per point to fully dry
const BRIGHT_WET = 1.5;
const BRIGHT_DRY = 1.0;

// How many points per segment when drawing with per-point brightness
const SEG_SIZE = 4;

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas({ active, color, strokeWidth = 8 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cacheCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const strokesRef = useRef<Stroke[]>([]);
    const currentStrokeRef = useRef<Stroke | null>(null);
    const isDrawingRef = useRef(false);
    // Strokes still drying (have points younger than DRY_DURATION)
    const dryingRef = useRef<Stroke[]>([]);
    const animRafRef = useRef<number>(0);
    const fpsRef = useRef({ frames: 0, lastTime: performance.now(), fps: 0 });
    const fpsElRef = useRef<HTMLDivElement>(null);

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

      cacheCanvasRef.current = null;
      rebuildCache();
      compositeToScreen();
    }, []);

    function rebuildCache() {
      const main = canvasRef.current;
      if (!main) return;
      const cache = getCacheCanvas();
      const ctx = cache.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, cache.width, cache.height);
      ctx.scale(dpr, dpr);
      for (const stroke of strokesRef.current) {
        // Only cache strokes not currently drying
        if (!dryingRef.current.includes(stroke)) {
          drawStrokeDried(ctx, stroke);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function appendToCache(stroke: Stroke) {
      const cache = getCacheCanvas();
      const ctx = cache.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      ctx.scale(dpr, dpr);
      drawStrokeDried(ctx, stroke);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Draw a fully dried stroke (brightness = 1.0)
    function drawStrokeDried(ctx: CanvasRenderingContext2D, stroke: Stroke) {
      drawFiberPath(ctx, stroke, "url(#penseat-marker-filter)");
    }

    // Draw a stroke with per-point drying brightness
    function drawStrokeWithDrying(ctx: CanvasRenderingContext2D, stroke: Stroke, now: number) {
      if (stroke.points.length < 2) return;

      // Split points into segments by similar brightness to batch draws
      let segStart = 0;
      while (segStart < stroke.points.length - 1) {
        const segEnd = Math.min(segStart + SEG_SIZE, stroke.points.length - 1);

        // Brightness based on midpoint time
        const midIdx = Math.floor((segStart + segEnd) / 2);
        const age = now - stroke.points[midIdx].time;
        const t = Math.min(age / DRY_DURATION, 1);
        const brightness = BRIGHT_WET + (BRIGHT_DRY - BRIGHT_WET) * t;

        // Extract segment (with 1 point overlap for continuity)
        const segPoints = stroke.points.slice(segStart, segEnd + 1);
        if (segPoints.length >= 2) {
          const segStroke: Stroke = {
            points: segPoints,
            color: stroke.color,
            width: stroke.width,
          };

          const filter =
            brightness > 1.01
              ? `url(#penseat-marker-filter) brightness(${brightness.toFixed(2)})`
              : "url(#penseat-marker-filter)";

          drawFiberPath(ctx, segStroke, filter);
        }

        segStart = segEnd;
      }
    }

    // Core fiber drawing — shared by dried and drying paths
    function drawFiberPath(ctx: CanvasRenderingContext2D, stroke: Stroke, filter: string) {
      if (stroke.points.length < 2) return;

      ctx.save();
      ctx.filter = filter;

      const fiberWidth = stroke.width / FIBERS;

      for (let f = 0; f < FIBERS; f++) {
        const offset = (f - (FIBERS - 1) / 2) * fiberWidth * 0.8;

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

    // Composite: cache + drying strokes + live stroke → screen
    function compositeToScreen(now: number) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Blit cached (fully dried) strokes
      ctx.drawImage(getCacheCanvas(), 0, 0);

      // 2. Draw drying strokes with per-point brightness
      for (const stroke of dryingRef.current) {
        ctx.scale(dpr, dpr);
        drawStrokeWithDrying(ctx, stroke, now);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }

      // 3. Draw live stroke with per-point brightness
      const live = currentStrokeRef.current;
      if (live && live.points.length >= 2) {
        ctx.scale(dpr, dpr);
        drawStrokeWithDrying(ctx, live, now);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }

    // Animation loop — runs while there's anything to animate
    function startAnimLoop() {
      if (animRafRef.current) return;

      function tick() {
        const now = performance.now();

        // Check which drying strokes are fully dried
        const stillDrying: Stroke[] = [];
        const fullyDried: Stroke[] = [];

        for (const stroke of dryingRef.current) {
          const oldest = stroke.points[stroke.points.length - 1].time;
          if (now - oldest >= DRY_DURATION) {
            fullyDried.push(stroke);
          } else {
            stillDrying.push(stroke);
          }
        }

        // Commit fully dried strokes to cache
        for (const stroke of fullyDried) {
          appendToCache(stroke);
        }
        dryingRef.current = stillDrying;

        compositeToScreen(now);
        updateFps();

        if (stillDrying.length > 0 || isDrawingRef.current) {
          animRafRef.current = requestAnimationFrame(tick);
        } else {
          animRafRef.current = 0;
        }
      }

      animRafRef.current = requestAnimationFrame(tick);
    }

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

    function getDocCoords(e: PointerEvent): { x: number; y: number } {
      return { x: e.pageX, y: e.pageY };
    }

    const handlePointerDown = useCallback(
      (e: PointerEvent) => {
        if (!active) return;
        e.preventDefault();
        isDrawingRef.current = true;
        currentStrokeRef.current = {
          points: [{ ...getDocCoords(e), time: performance.now() }],
          color,
          width: strokeWidth,
        };
        startAnimLoop();
      },
      [active, color, strokeWidth]
    );

    const handlePointerMove = useCallback(
      (e: PointerEvent) => {
        if (!isDrawingRef.current || !currentStrokeRef.current) return;
        e.preventDefault();
        currentStrokeRef.current.points.push({
          ...getDocCoords(e),
          time: performance.now(),
        });
      },
      []
    );

    const handlePointerUp = useCallback(() => {
      if (!isDrawingRef.current || !currentStrokeRef.current) return;
      isDrawingRef.current = false;

      if (currentStrokeRef.current.points.length >= 2) {
        strokesRef.current = [...strokesRef.current, currentStrokeRef.current];
        dryingRef.current = [...dryingRef.current, currentStrokeRef.current];
        startAnimLoop();
      }
      currentStrokeRef.current = null;
    }, []);

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

    useEffect(() => {
      resizeCanvas();
      const observer = new ResizeObserver(() => resizeCanvas());
      observer.observe(document.body);
      window.addEventListener("resize", resizeCanvas);
      return () => {
        observer.disconnect();
        window.removeEventListener("resize", resizeCanvas);
        cancelAnimationFrame(animRafRef.current);
      };
    }, [resizeCanvas]);

    useImperativeHandle(ref, () => ({
      undo() {
        const removed = strokesRef.current[strokesRef.current.length - 1];
        strokesRef.current = strokesRef.current.slice(0, -1);
        dryingRef.current = dryingRef.current.filter((s) => s !== removed);
        rebuildCache();
        compositeToScreen(performance.now());
      },
      clear() {
        strokesRef.current = [];
        dryingRef.current = [];
        cacheCanvasRef.current = null;
        getCacheCanvas();
        compositeToScreen(performance.now());
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
