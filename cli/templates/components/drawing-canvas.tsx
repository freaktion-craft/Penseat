"use client";

import {
  useRef,
  useState,
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

// ── Constants ──
const FIBERS = 5;
const DRY_DURATION = 1200;
const DRY_ALPHA = 1.0;            // fully opaque settled marker
const WET_OVERLAY_ALPHA = 0.50;   // extra density at peak wetness
const WET_WIDTH_BOOST = 0.12;     // 12% wider when wet
const WET_COLOR_DARKEN = 0.10;    // 10% darker when wet
const FIBER_CUT_ALPHA = 0;         // fiber streaks disabled
const ERASER_COLOR = "#ffffff";
const ERASER_RADIUS = 12;

// Wetness band edges — 0 = fully dry, 1 = freshest
const WETNESS_BANDS = [0.00, 0.18, 0.40, 0.68, 0.88, 1.00];

// ── Helpers (outside component — no allocations per render) ──

// Smoothstep wetness: 1 = just drawn, 0 = fully dry
function wetness(pointTime: number, now: number): number {
  const x = 1 - (now - pointTime) / DRY_DURATION;
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

// Darken hex color by factor (0 = original, 1 = WET_COLOR_DARKEN% darker)
function darkenHex(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = 1 - factor * WET_COLOR_DARKEN;
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

// Binary search: first index where points[i].time >= t
function lowerBound(points: { time: number }[], t: number): number {
  let lo = 0, hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas({ active, color, strokeWidth = 5 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cacheCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const strokesRef = useRef<Stroke[]>([]);
    const currentStrokeRef = useRef<Stroke | null>(null);
    const isDrawingRef = useRef(false);
    const dryingRef = useRef<Stroke[]>([]);
    const animRafRef = useRef<number>(0);
    const eraserCursorRef = useRef<HTMLDivElement>(null);
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

    // ── Path tracing ──

    function tracePath(
      ctx: CanvasRenderingContext2D,
      points: { x: number; y: number }[]
    ) {
      if (points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const curr = points[i];
        const next = points[i + 1];
        const midX = (curr.x + next.x) / 2;
        const midY = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    }

    function traceOffsetPath(
      ctx: CanvasRenderingContext2D,
      points: { x: number; y: number }[],
      offset: number
    ) {
      if (points.length < 2) return;
      ctx.beginPath();
      const p0 = points[0];
      const p1 = points[1];
      const angle0 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      ctx.moveTo(
        p0.x + Math.cos(angle0 + Math.PI / 2) * offset,
        p0.y + Math.sin(angle0 + Math.PI / 2) * offset
      );
      for (let i = 1; i < points.length - 1; i++) {
        const curr = points[i];
        const next = points[i + 1];
        const angle = Math.atan2(next.y - curr.y, next.x - curr.x);
        const ox = Math.cos(angle + Math.PI / 2) * offset;
        const oy = Math.sin(angle + Math.PI / 2) * offset;
        const midX = (curr.x + next.x) / 2 + ox;
        const midY = (curr.y + next.y) / 2 + oy;
        ctx.quadraticCurveTo(curr.x + ox, curr.y + oy, midX, midY);
      }
      const last = points[points.length - 1];
      const prev = points[points.length - 2];
      const angleLast = Math.atan2(last.y - prev.y, last.x - prev.x);
      ctx.lineTo(
        last.x + Math.cos(angleLast + Math.PI / 2) * offset,
        last.y + Math.sin(angleLast + Math.PI / 2) * offset
      );
    }

    // ── Drawing primitives ──

    // Core: draw base stroke + fiber cuts at given alpha
    function drawFibersCore(
      ctx: CanvasRenderingContext2D,
      points: { x: number; y: number }[],
      strokeColor: string,
      w: number,
      baseAlpha: number = DRY_ALPHA
    ) {
      if (points.length < 2) return;
      ctx.save();

      // Base stroke — round caps for smooth ends
      ctx.globalAlpha = baseAlpha;
      ctx.strokeStyle = strokeColor;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = w;
      tracePath(ctx, points);
      ctx.stroke();

      // Fiber gaps — thin transparent lines cut through for streak texture
      const fiberWidth = w / FIBERS;
      for (let f = 1; f < FIBERS; f++) {
        const offset = (f - FIBERS / 2) * fiberWidth;
        ctx.globalCompositeOperation = "destination-out";
        ctx.globalAlpha = FIBER_CUT_ALPHA;
        ctx.lineCap = "butt";
        ctx.lineJoin = "round";
        ctx.lineWidth = fiberWidth * 0.3;
        traceOffsetPath(ctx, points, offset);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.restore();
    }

    // Convenience: draw fibers for a full Stroke at dry alpha
    function drawFibers(ctx: CanvasRenderingContext2D, stroke: Stroke) {
      drawFibersCore(ctx, stroke.points, stroke.color, stroke.width);
    }

    // ── Cache management ──

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

    // ── Drying renderer ──
    //
    // Two-pass approach:
    //   1. Draw dry base (with fibers) — the settled marker look
    //   2. Layer wet overlay bands on top (no fibers, wider, darker)
    //
    // Fresh ink covers the fiber streaks naturally.
    // As wetness recedes, fibers are gradually revealed — the "drying" wave.

    function drawDryingStroke(
      destCtx: CanvasRenderingContext2D,
      stroke: Stroke,
      now: number,
      dpr: number
    ) {
      const pts = stroke.points;
      if (pts.length < 2) return;

      const tmp = getTmpCanvas();
      const tmpCtx = tmp.getContext("2d")!;

      // Bounding box for efficient clear/blit
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const maxW = stroke.width * (1 + WET_WIDTH_BOOST);
      const pad = maxW * 2;
      const bx = Math.max(0, Math.floor((minX - pad) * dpr));
      const by = Math.max(0, Math.floor((minY - pad) * dpr));
      const bx2 = Math.min(tmp.width, Math.ceil((maxX + pad) * dpr));
      const by2 = Math.min(tmp.height, Math.ceil((maxY + pad) * dpr));
      const bw = bx2 - bx;
      const bh = by2 - by;
      if (bw <= 0 || bh <= 0) return;

      tmpCtx.clearRect(bx, by, bw, bh);
      tmpCtx.save();
      tmpCtx.scale(dpr, dpr);

      // Pass 1: dry base with fibers
      drawFibersCore(tmpCtx, pts, stroke.color, stroke.width);

      // Pass 2: wet overlay bands — older to newer so the tip ends on top
      for (let b = 0; b < WETNESS_BANDS.length - 1; b++) {
        const uLo = WETNESS_BANDS[b];
        const uHi = WETNESS_BANDS[b + 1];
        const uMid = (uLo + uHi) / 2;
        if (uMid < 0.01) continue;

        // Convert wetness edges to time boundaries
        // (linear approx for smoothstep — close enough for band splits)
        const tLo = now - DRY_DURATION * (1 - uLo);
        const tHi = now - DRY_DURATION * (1 - uHi);

        // Find index range via binary search (timestamps are monotonic)
        const idxLo = lowerBound(pts, tLo);
        const idxHi = Math.min(pts.length - 1, lowerBound(pts, tHi));
        if (idxHi <= idxLo) continue;

        // Overlap by 1 sample on each side to hide seams
        const bandFrom = Math.max(0, idxLo - 1);
        const bandTo = Math.min(pts.length - 1, idxHi + 1);
        if (bandTo - bandFrom < 1) continue;

        const bandPoints = pts.slice(bandFrom, bandTo + 1);
        if (bandPoints.length < 2) continue;

        // Wet style: wider, darker, NO fibers — covers the dry streaks
        tmpCtx.globalAlpha = WET_OVERLAY_ALPHA * uMid;
        tmpCtx.globalCompositeOperation = "source-over";
        tmpCtx.strokeStyle = darkenHex(stroke.color, uMid);
        tmpCtx.lineCap = "round";
        tmpCtx.lineJoin = "round";
        tmpCtx.lineWidth = stroke.width * (1 + WET_WIDTH_BOOST * uMid);
        tracePath(tmpCtx, bandPoints);
        tmpCtx.stroke();
      }

      tmpCtx.restore();
      tmpCtx.setTransform(1, 0, 0, 1, 0, 0);

      // Blit scratch to destination
      destCtx.drawImage(tmp, bx, by, bw, bh, bx, by, bw, bh);
    }

    // ── Compositing ──

    function compositeToScreen(now: number) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(getCacheCanvas(), 0, 0);

      for (const stroke of dryingRef.current) {
        drawDryingStroke(ctx, stroke, now, dpr);
      }

      const live = currentStrokeRef.current;
      if (live && live.points.length >= 2) {
        drawDryingStroke(ctx, live, now, dpr);
      }
    }

    // ── Animation loop ──

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

        if (stillDrying.length > 0 || isDrawingRef.current) {
          animRafRef.current = requestAnimationFrame(tick);
        } else {
          animRafRef.current = 0;
        }
      }

      animRafRef.current = requestAnimationFrame(tick);
    }

    // ── Input handling ──

    function getDocCoords(e: PointerEvent): { x: number; y: number } {
      return { x: e.pageX, y: e.pageY };
    }

    function updateEraserCursor(e: PointerEvent) {
      if (!eraserCursorRef.current) return;
      eraserCursorRef.current.style.left = `${e.clientX}px`;
      eraserCursorRef.current.style.top = `${e.clientY}px`;
      const bar = document.querySelector("[data-penseat='bar']");
      if (bar) {
        const rect = bar.getBoundingClientRect();
        const overBar =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        eraserCursorRef.current.style.opacity = overBar ? "0" : "1";
      }
    }

    function eraseAtPoint(x: number, y: number) {
      const r = ERASER_RADIUS;
      const rSq = r * r;
      const before = strokesRef.current.length;
      strokesRef.current = strokesRef.current.filter((stroke) => {
        for (const p of stroke.points) {
          const dx = p.x - x;
          const dy = p.y - y;
          if (dx * dx + dy * dy <= rSq) return false;
        }
        return true;
      });
      if (strokesRef.current.length < before) {
        dryingRef.current = dryingRef.current.filter((s) =>
          strokesRef.current.includes(s)
        );
        rebuildCache();
        compositeToScreen(performance.now());
      }
    }

    const isEraser = color === ERASER_COLOR;
    const isEraserRef = useRef(isEraser);
    isEraserRef.current = isEraser;

    const handlePointerDown = useCallback(
      (e: PointerEvent) => {
        if (!active) return;
        e.preventDefault();
        isDrawingRef.current = true;

        if (isEraserRef.current) {
          updateEraserCursor(e);
          const { x, y } = getDocCoords(e);
          eraseAtPoint(x, y);
        } else {
          currentStrokeRef.current = {
            points: [{ ...getDocCoords(e), time: performance.now() }],
            color,
            width: strokeWidth,
          };
        }
        startAnimLoop();
      },
      [active, color, strokeWidth]
    );

    const handlePointerMove = useCallback((e: PointerEvent) => {
      updateEraserCursor(e);

      if (!isDrawingRef.current) return;
      e.preventDefault();

      if (isEraserRef.current) {
        const { x, y } = getDocCoords(e);
        eraseAtPoint(x, y);
      } else if (currentStrokeRef.current) {
        currentStrokeRef.current.points.push({
          ...getDocCoords(e),
          time: performance.now(),
        });
      }
    }, []);

    const handlePointerUp = useCallback(() => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;

      if (
        !isEraserRef.current &&
        currentStrokeRef.current &&
        currentStrokeRef.current.points.length >= 2
      ) {
        strokesRef.current = [...strokesRef.current, currentStrokeRef.current];
        dryingRef.current = [...dryingRef.current, currentStrokeRef.current];
        startAnimLoop();
      }
      currentStrokeRef.current = null;
    }, []);

    const handlePointerLeave = useCallback(() => {
      if (eraserCursorRef.current) {
        eraserCursorRef.current.style.opacity = "0";
      }
      handlePointerUp();
    }, [handlePointerUp]);

    const handlePointerEnter = useCallback((e: PointerEvent) => {
      if (isEraserRef.current && eraserCursorRef.current) {
        eraserCursorRef.current.style.opacity = "1";
        eraserCursorRef.current.style.left = `${e.clientX}px`;
        eraserCursorRef.current.style.top = `${e.clientY}px`;
      }
    }, []);

    // ── Effects ──

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (active) {
        canvas.addEventListener("pointerdown", handlePointerDown);
        canvas.addEventListener("pointermove", handlePointerMove);
        canvas.addEventListener("pointerup", handlePointerUp);
        canvas.addEventListener("pointerleave", handlePointerLeave);
        canvas.addEventListener("pointerenter", handlePointerEnter);
      }

      return () => {
        canvas.removeEventListener("pointerdown", handlePointerDown);
        canvas.removeEventListener("pointermove", handlePointerMove);
        canvas.removeEventListener("pointerup", handlePointerUp);
        canvas.removeEventListener("pointerleave", handlePointerLeave);
        canvas.removeEventListener("pointerenter", handlePointerEnter);
      };
    }, [
      active,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handlePointerLeave,
      handlePointerEnter,
    ]);

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
            cursor: active
              ? color === ERASER_COLOR
                ? "none"
                : "crosshair"
              : "default",
            zIndex: active ? 9998 : -1,
            touchAction: "none",
          }}
        />
        {active && isEraser && (
          <div
            ref={eraserCursorRef}
            className="fixed z-[99999] pointer-events-none -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
            style={{
              width: ERASER_RADIUS * 2,
              height: ERASER_RADIUS * 2,
              mixBlendMode: "difference",
            }}
          />
        )}
      </>
    );
  }
);

export default DrawingCanvas;
