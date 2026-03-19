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
const DRY_DURATION = 1200;

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas({ active, color, strokeWidth = 8 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cacheCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const strokesRef = useRef<Stroke[]>([]);
    const currentStrokeRef = useRef<Stroke | null>(null);
    const isDrawingRef = useRef(false);
    const dryingRef = useRef<Stroke[]>([]);
    const animRafRef = useRef<number>(0);
    const fpsRef = useRef({ frames: 0, lastTime: performance.now(), fps: 0 });
    const fpsElRef = useRef<HTMLDivElement>(null);
    const tmpCanvasRef = useRef<HTMLCanvasElement | null>(null);

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

    function getTmpCanvas(): HTMLCanvasElement {
      const main = canvasRef.current!;
      if (
        !tmpCanvasRef.current ||
        tmpCanvasRef.current.width !== main.width ||
        tmpCanvasRef.current.height !== main.height
      ) {
        const c = document.createElement("canvas");
        c.width = main.width;
        c.height = main.height;
        tmpCanvasRef.current = c;
      }
      return tmpCanvasRef.current;
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
      tmpCanvasRef.current = null;
      rebuildCache();
      compositeToScreen(performance.now());
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
        if (!dryingRef.current.includes(stroke)) {
          drawFibers(ctx, stroke);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function appendToCache(stroke: Stroke) {
      const cache = getCacheCanvas();
      const ctx = cache.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      ctx.scale(dpr, dpr);
      drawFibers(ctx, stroke);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Draw stroke with per-point drying brightness
    // Strategy: render full stroke into tmp canvas ONCE,
    // then blit base + overdraw wet regions with "lighter" blend
    function drawStrokeWithDrying(
      destCtx: CanvasRenderingContext2D,
      stroke: Stroke,
      now: number,
      dpr: number
    ) {
      if (stroke.points.length < 2) return;

      // 1. Render full stroke into tmp canvas (no SVG filter — just fibers)
      const tmp = getTmpCanvas();
      const tmpCtx = tmp.getContext("2d")!;
      tmpCtx.clearRect(0, 0, tmp.width, tmp.height);
      tmpCtx.scale(dpr, dpr);
      drawFibers(tmpCtx, stroke);
      tmpCtx.setTransform(1, 0, 0, 1, 0, 0);

      // 2. Bounding box for efficient blit
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of stroke.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const pad = stroke.width * 2;
      const bx = Math.max(0, (minX - pad) * dpr);
      const by = Math.max(0, (minY - pad) * dpr);
      const bx2 = Math.min(tmp.width, (maxX + pad) * dpr);
      const by2 = Math.min(tmp.height, (maxY + pad) * dpr);
      const bw = bx2 - bx;
      const bh = by2 - by;
      if (bw <= 0 || bh <= 0) return;

      // 3. Base: blit at normal brightness
      destCtx.drawImage(tmp, bx, by, bw, bh, bx, by, bw, bh);

      // 4. Overdraw wet regions with "lighter" blend for brightness boost
      // Find the wet zone (points younger than DRY_DURATION)
      let wetMinX = Infinity, wetMinY = Infinity, wetMaxX = -Infinity, wetMaxY = -Infinity;
      let maxBoost = 0;

      for (const p of stroke.points) {
        const age = now - p.time;
        if (age < DRY_DURATION) {
          const t = age / DRY_DURATION; // 0 = just drawn, 1 = fully dry
          const boost = (1 - t) * 0.5; // max 0.5 extra brightness at tip
          if (boost > maxBoost) maxBoost = boost;
          if (p.x < wetMinX) wetMinX = p.x;
          if (p.y < wetMinY) wetMinY = p.y;
          if (p.x > wetMaxX) wetMaxX = p.x;
          if (p.y > wetMaxY) wetMaxY = p.y;
        }
      }

      if (maxBoost > 0.02 && wetMaxX > wetMinX) {
        const wx = Math.max(0, (wetMinX - pad) * dpr);
        const wy = Math.max(0, (wetMinY - pad) * dpr);
        const wx2 = Math.min(tmp.width, (wetMaxX + pad) * dpr);
        const wy2 = Math.min(tmp.height, (wetMaxY + pad) * dpr);
        const ww = wx2 - wx;
        const wh = wy2 - wy;

        if (ww > 0 && wh > 0) {
          destCtx.save();
          destCtx.globalCompositeOperation = "lighter";
          destCtx.globalAlpha = maxBoost;
          destCtx.drawImage(tmp, wx, wy, ww, wh, wx, wy, ww, wh);
          destCtx.restore();
        }
      }
    }

    // Core fiber drawing — marker texture from parallel sub-strokes
    function drawFibers(ctx: CanvasRenderingContext2D, stroke: Stroke) {
      if (stroke.points.length < 2) return;

      ctx.save();
      const fiberWidth = stroke.width / FIBERS;

      for (let f = 0; f < FIBERS; f++) {
        const offset = (f - (FIBERS - 1) / 2) * fiberWidth * 0.8;

        ctx.globalAlpha = f === 0 || f === FIBERS - 1 ? 0.6 : 1;
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

    function compositeToScreen(now: number) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(getCacheCanvas(), 0, 0);

      for (const stroke of dryingRef.current) {
        drawStrokeWithDrying(ctx, stroke, now, dpr);
      }

      const live = currentStrokeRef.current;
      if (live && live.points.length >= 2) {
        drawStrokeWithDrying(ctx, live, now, dpr);
      }
    }

    function startAnimLoop() {
      if (animRafRef.current) return;

      function tick() {
        const now = performance.now();

        const stillDrying: Stroke[] = [];
        const fullyDried: Stroke[] = [];

        for (const stroke of dryingRef.current) {
          const newestAge = now - stroke.points[stroke.points.length - 1].time;
          if (newestAge >= DRY_DURATION) {
            fullyDried.push(stroke);
          } else {
            stillDrying.push(stroke);
          }
        }

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
