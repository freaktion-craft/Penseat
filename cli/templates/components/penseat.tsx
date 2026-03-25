"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import DrawingCanvas, { type DrawingCanvasHandle } from "./drawing-canvas";
import PenseatBar, { type Corner } from "./penseat-bar";
import { captureAndCopy } from "@/lib/capture";

type Mode = "idle" | "drawing" | "capturing";

export default function Penseat() {
  const [mode, setMode] = useState<Mode>("idle");
  const [color, setColor] = useState("#ef4444");
  const [corner, setCorner] = useState<Corner>("rb");
  const [shake, setShake] = useState(false);
  const [copied, setCopied] = useState(false);
  const shakeTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const canvasRef = useRef<DrawingCanvasHandle>(null);

  const triggerShake = useCallback(() => {
    if (shakeTimer.current) return; // previous shake still running
    setShake(true);
    shakeTimer.current = setTimeout(() => {
      setShake(false);
      shakeTimer.current = null;
    }, 400);
  }, []);

  const toggle = useCallback(() => {
    if (mode === "idle") {
      setMode("drawing");
    } else {
      canvasRef.current?.clear();
      setMode("idle");
    }
  }, [mode]);

  const handleDone = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;

    if (!canvasRef.current?.hasStrokes()) {
      triggerShake();
      return;
    }

    // Fire clipboard.write IMMEDIATELY — must be synchronous within user activation
    const copyPromise = captureAndCopy(canvas);

    setMode("capturing");

    copyPromise.then(() => {
      setMode("drawing");
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1200);
    }).catch((err) => {
      console.error("Capture failed:", err);
      triggerShake();
      setMode("drawing");
    });
  }, []);

  useEffect(() => {
    const COLORS = ["#ef4444", "#eab308", "#3b82f6", "#22c55e"];

    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "d") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape" && mode === "drawing") {
        toggle();
      }
      if (mode !== "drawing") return;

      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key === "c") {
        handleDone();
      }
      if (isMeta && e.key === "z") {
        e.preventDefault();
        canvasRef.current?.undo();
      }
      if (!isMeta && !e.shiftKey) {
        if (e.key === "x") canvasRef.current?.clear();
        if (e.key === "e" || e.key === "5") setColor("#ffffff");
        const idx = ["1", "2", "3", "4"].indexOf(e.key);
        if (idx !== -1) setColor(COLORS[idx]);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, toggle, handleDone]);

  return (
    <>
      <DrawingCanvas
        ref={canvasRef}
        active={mode === "drawing" || mode === "capturing"}
        color={color}
      />

      <PenseatBar
        expanded={mode !== "idle"}
        corner={corner}
        onCornerChange={setCorner}
        color={color}
        onColorChange={setColor}
        onToggle={toggle}
        onUndo={() => canvasRef.current?.undo()}
        onClear={() => canvasRef.current?.clear()}
        onDone={handleDone}
        capturing={mode === "capturing"}
        copied={copied}
        shake={shake}
      />
    </>
  );
}
