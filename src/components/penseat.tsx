"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import DrawingCanvas, { type DrawingCanvasHandle } from "./drawing-canvas";
import PenseatToolbar from "./penseat-toolbar";
import PenseatTrigger from "./penseat-trigger";
import { captureAndCopy } from "@/lib/capture";

type Mode = "idle" | "drawing" | "capturing";

export default function Penseat() {
  const [mode, setMode] = useState<Mode>("idle");
  const [color, setColor] = useState("#ef4444");
  const [promptText, setPromptText] = useState("");
  const canvasRef = useRef<DrawingCanvasHandle>(null);

  const enterDrawing = useCallback(() => {
    setMode("drawing");
    setPromptText("");
  }, []);

  const cancel = useCallback(() => {
    canvasRef.current?.clear();
    setMode("idle");
    setPromptText("");
  }, []);

  const handleDone = useCallback(async () => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;

    // Need either strokes or text
    if (!canvasRef.current?.hasStrokes() && !promptText.trim()) {
      toast.error("Draw something or add a note first");
      return;
    }

    setMode("capturing");

    try {
      await captureAndCopy(canvas, promptText);
      toast.success("Copied to clipboard! Paste into your LLM.", {
        duration: 3000,
      });
    } catch (err) {
      console.error("Capture failed:", err);
      toast.error("Failed to capture. Try again.");
      setMode("drawing");
      return;
    }

    canvasRef.current?.clear();
    setMode("idle");
    setPromptText("");
  }, [promptText]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+Shift+D to toggle drawing mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "d") {
        e.preventDefault();
        if (mode === "idle") {
          enterDrawing();
        } else if (mode === "drawing") {
          cancel();
        }
      }

      // Escape to cancel drawing
      if (e.key === "Escape" && mode === "drawing") {
        cancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, enterDrawing, cancel]);

  return (
    <>
      <DrawingCanvas
        ref={canvasRef}
        active={mode === "drawing"}
        color={color}
      />

      {mode === "idle" && <PenseatTrigger onClick={enterDrawing} />}

      {(mode === "drawing" || mode === "capturing") && (
        <PenseatToolbar
          color={color}
          onColorChange={setColor}
          promptText={promptText}
          onPromptChange={setPromptText}
          onUndo={() => canvasRef.current?.undo()}
          onClear={() => canvasRef.current?.clear()}
          onDone={handleDone}
          onCancel={cancel}
          capturing={mode === "capturing"}
        />
      )}
    </>
  );
}
