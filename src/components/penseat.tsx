"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import DrawingCanvas, { type DrawingCanvasHandle } from "./drawing-canvas";
import PenseatBar from "./penseat-bar";
import { captureAndCopy } from "@/lib/capture";

type Mode = "idle" | "drawing" | "capturing";

export default function Penseat() {
  const [mode, setMode] = useState<Mode>("idle");
  const [color, setColor] = useState("#ef4444");
  const [promptText, setPromptText] = useState("");
  const canvasRef = useRef<DrawingCanvasHandle>(null);

  const toggle = useCallback(() => {
    if (mode === "idle") {
      setMode("drawing");
      setPromptText("");
    } else {
      canvasRef.current?.clear();
      setMode("idle");
      setPromptText("");
    }
  }, [mode]);

  const handleDone = useCallback(async () => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;

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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "d") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape" && mode === "drawing") {
        toggle();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, toggle]);

  return (
    <>
      <DrawingCanvas
        ref={canvasRef}
        active={mode === "drawing"}
        color={color}
      />

      <PenseatBar
        expanded={mode !== "idle"}
        color={color}
        onColorChange={setColor}
        promptText={promptText}
        onPromptChange={setPromptText}
        onToggle={toggle}
        onUndo={() => canvasRef.current?.undo()}
        onClear={() => canvasRef.current?.clear()}
        onDone={handleDone}
        capturing={mode === "capturing"}
      />
    </>
  );
}
