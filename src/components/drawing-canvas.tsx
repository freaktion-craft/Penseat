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

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas({ active, color, strokeWidth = 5 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const strokesRef = useRef<Stroke[]>([]);
    const currentStrokeRef = useRef<Stroke | null>(null);
    const isDrawingRef = useRef(false);
    const rafRef = useRef<number>(0);

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

      // Redraw all strokes after resize
      redrawAll();
    }, []);

    // Redraw all strokes onto the canvas
    const redrawAll = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      for (const stroke of strokesRef.current) {
        drawStroke(ctx, stroke);
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }, []);

    // Draw a single stroke with marker-like feel
    function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
      if (stroke.points.length < 2) return;

      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = stroke.color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = stroke.width;

      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

      // Smooth bezier curves through points
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const curr = stroke.points[i];
        const next = stroke.points[i + 1];
        const midX = (curr.x + next.x) / 2;
        const midY = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
      }

      // Last point
      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
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

        // Draw current stroke in real-time
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          const canvas = canvasRef.current;
          if (!canvas || !currentStrokeRef.current) return;
          const ctx = canvas.getContext("2d")!;
          const dpr = window.devicePixelRatio || 1;

          // Redraw everything + current stroke
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.scale(dpr, dpr);
          for (const stroke of strokesRef.current) {
            drawStroke(ctx, stroke);
          }
          drawStroke(ctx, currentStrokeRef.current);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        });
      },
      []
    );

    const handlePointerUp = useCallback(() => {
      if (!isDrawingRef.current || !currentStrokeRef.current) return;
      isDrawingRef.current = false;

      if (currentStrokeRef.current.points.length >= 2) {
        strokesRef.current = [...strokesRef.current, currentStrokeRef.current];
      }
      currentStrokeRef.current = null;
      redrawAll();
    }, [redrawAll]);

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
        redrawAll();
      },
      clear() {
        strokesRef.current = [];
        redrawAll();
      },
      getCanvas() {
        return canvasRef.current;
      },
      hasStrokes() {
        return strokesRef.current.length > 0;
      },
    }));

    return (
      <canvas
        ref={canvasRef}
        data-backseat="canvas"
        className="absolute top-0 left-0"
        style={{
          pointerEvents: active ? "auto" : "none",
          cursor: active ? "crosshair" : "default",
          zIndex: active ? 9998 : -1,
          touchAction: "none",
        }}
      />
    );
  }
);

export default DrawingCanvas;
