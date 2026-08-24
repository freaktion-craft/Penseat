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
  // Cursor tool active: keep ink visible but pass pointer input through
  penDisabled?: boolean;
}

// ── Constants ──
const FIBERS = 5;
const DRY_ALPHA = 1.0;            // fully opaque settled marker
const FIBER_CUT_ALPHA = 0;         // fiber streaks disabled
const ERASER_COLOR = "#ffffff";
const ERASER_RADIUS = 12;

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas({ active, color, strokeWidth = 5, penDisabled = false }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cacheCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const strokesRef = useRef<Stroke[]>([]);
    const currentStrokeRef = useRef<Stroke | null>(null);
    const isDrawingRef = useRef(false);
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
      compositeToScreen();
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

      // Fiber gaps — thin transparent lines cut through for streak texture.
      // Skipped entirely while disabled: zero-alpha strokes still cost a
      // full rasterization pass each
      if (FIBER_CUT_ALPHA > 0) {
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
        drawFibers(ctx, stroke);
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

    // ── Live stroke renderer ──
    //
    // The in-progress stroke redraws every frame in its final settled
    // look — no trailing "wet" effects: anything that re-shapes already
    // drawn ink reads as jitter under the pen. Drawn on a scratch canvas
    // and blitted, so per-frame redraws never double-composite alpha.

    function drawLiveStroke(
      destCtx: CanvasRenderingContext2D,
      stroke: Stroke,
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
      const pad = stroke.width * 2;
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
      drawFibersCore(tmpCtx, pts, stroke.color, stroke.width);
      tmpCtx.restore();
      tmpCtx.setTransform(1, 0, 0, 1, 0, 0);

      destCtx.drawImage(tmp, bx, by, bw, bh, bx, by, bw, bh);
    }

    // ── Compositing ──

    function compositeToScreen() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(getCacheCanvas(), 0, 0);

      const live = currentStrokeRef.current;
      if (live && live.points.length >= 2) {
        drawLiveStroke(ctx, live, dpr);
      }
    }

    // ── Animation loop — runs only while the pointer is down ──

    function startAnimLoop() {
      if (animRafRef.current) return;

      function tick() {
        compositeToScreen();
        animRafRef.current = isDrawingRef.current
          ? requestAnimationFrame(tick)
          : 0;
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
        rebuildCache();
        compositeToScreen();
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
        appendToCache(currentStrokeRef.current);
      }
      currentStrokeRef.current = null;
      compositeToScreen();
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
        <canvas
          ref={canvasRef}
          data-penseat="canvas"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: active && !penDisabled ? "auto" : "none",
            cursor: active
              ? color === ERASER_COLOR
                ? "none"
                : "crosshair"
              : "default",
            zIndex: active ? 9998 : -1,
            touchAction: "none",
          }}
        />
        {active && isEraser && !penDisabled && (
          <div
            ref={eraserCursorRef}
            style={{
              position: "fixed",
              zIndex: 99999,
              pointerEvents: "none",
              transform: "translate(-50%, -50%)",
              borderRadius: "9999px",
              border: "2px solid #ffffff",
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
