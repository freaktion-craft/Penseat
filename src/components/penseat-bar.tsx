"use client";

import { useRef, useEffect } from "react";
import { Pen, Undo2, Trash2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Yellow", value: "#eab308" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "White", value: "#ffffff" },
];

const BAR_HEIGHT = 44; // px — shared between collapsed and expanded

interface PenseatBarProps {
  expanded: boolean;
  color: string;
  onColorChange: (color: string) => void;
  promptText: string;
  onPromptChange: (text: string) => void;
  onToggle: () => void;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
  capturing: boolean;
}

export default function PenseatBar({
  expanded,
  color,
  onColorChange,
  promptText,
  onPromptChange,
  onToggle,
  onUndo,
  onClear,
  onDone,
  capturing,
}: PenseatBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when expanding
  useEffect(() => {
    if (expanded) {
      // Small delay to let the transition start
      const t = setTimeout(() => inputRef.current?.focus(), 200);
      return () => clearTimeout(t);
    }
  }, [expanded]);

  return (
    <div
      data-penseat="bar"
      className="fixed bottom-5 right-5 z-[9999] flex items-center overflow-hidden rounded-full bg-zinc-900 shadow-xl border border-zinc-700/50 transition-all duration-300 ease-in-out"
      style={{
        height: BAR_HEIGHT,
        // Expanded: auto-width with max; collapsed: pill width
        width: expanded ? 520 : BAR_HEIGHT,
      }}
    >
      {!expanded ? (
        <button
          data-penseat="trigger"
          onClick={onToggle}
          className="flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors"
          style={{ width: BAR_HEIGHT, height: BAR_HEIGHT }}
        >
          <Pen className="size-5" />
        </button>
      ) : (
        <div className="flex items-center gap-1.5 pl-3 shrink-0">
          {COLORS.map((c) => (
            <div
              key={c.value}
              role="button"
              tabIndex={0}
              aria-label={c.name}
              onClick={() => onColorChange(c.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  onColorChange(c.value);
              }}
              className="size-5 rounded-full cursor-pointer transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 shrink-0"
              style={{
                backgroundColor: c.value,
                boxShadow:
                  color === c.value
                    ? `0 0 0 2px #18181b, 0 0 0 3px ${c.value}`
                    : "none",
              }}
            />
          ))}
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="flex items-center gap-1 pl-2 pr-2 animate-in fade-in duration-200">
          <div className="h-5 w-px bg-zinc-700 shrink-0" />

          <Button
            variant="ghost"
            size="icon"
            aria-label="Undo"
            className="size-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 shrink-0"
            onClick={onUndo}
          >
            <Undo2 className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            aria-label="Clear all"
            className="size-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 shrink-0"
            onClick={onClear}
          >
            <Trash2 className="size-4" />
          </Button>

          <div className="h-5 w-px bg-zinc-700 shrink-0" />

          <input
            ref={inputRef}
            type="text"
            value={promptText}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onDone();
              }
              if (e.key === "Escape") {
                onToggle();
              }
            }}
            placeholder="Add a note..."
            className="w-36 rounded-md bg-zinc-800 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-500 border border-zinc-700 focus:outline-none focus:border-zinc-500 font-mono shrink-0"
          />

          <div className="h-5 w-px bg-zinc-700 shrink-0" />

          <Button
            variant="ghost"
            size="icon"
            aria-label="Cancel"
            className="size-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 shrink-0"
            onClick={onToggle}
          >
            <X className="size-4" />
          </Button>

          <Button
            onClick={onDone}
            disabled={capturing}
            className="h-7 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 shrink-0"
          >
            {capturing ? (
              <span className="flex items-center gap-1.5">
                <span className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Check className="size-3.5" />
                Done
              </span>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
