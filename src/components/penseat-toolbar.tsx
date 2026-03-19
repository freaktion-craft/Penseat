"use client";

import { Undo2, Trash2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Yellow", value: "#eab308" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "White", value: "#ffffff" },
];

interface PenseatToolbarProps {
  color: string;
  onColorChange: (color: string) => void;
  promptText: string;
  onPromptChange: (text: string) => void;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
  onCancel: () => void;
  capturing: boolean;
}

export default function PenseatToolbar({
  color,
  onColorChange,
  promptText,
  onPromptChange,
  onUndo,
  onClear,
  onDone,
  onCancel,
  capturing,
}: PenseatToolbarProps) {
  return (
    <div
      data-penseat="toolbar"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 rounded-xl bg-zinc-900/95 px-3 py-2 shadow-2xl backdrop-blur-sm border border-zinc-700/50"
    >
      {/* Color dots */}
      <div className="flex items-center gap-1.5">
        {COLORS.map((c) => (
          <div
            key={c.value}
            role="button"
            tabIndex={0}
            aria-label={c.name}
            onClick={() => onColorChange(c.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onColorChange(c.value);
            }}
            className="size-5 rounded-full cursor-pointer transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            style={{
              backgroundColor: c.value,
              boxShadow:
                color === c.value
                  ? `0 0 0 2px #18181b, 0 0 0 4px ${c.value}`
                  : "none",
            }}
          />
        ))}
      </div>

      <div className="h-5 w-px bg-zinc-700" />

      {/* Actions */}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Undo"
        className="size-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        onClick={onUndo}
      >
        <Undo2 className="size-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Clear all"
        className="size-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        onClick={onClear}
      >
        <Trash2 className="size-4" />
      </Button>

      <div className="h-5 w-px bg-zinc-700" />

      {/* Prompt input */}
      <input
        type="text"
        value={promptText}
        onChange={(e) => onPromptChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onDone();
          }
          if (e.key === "Escape") {
            onCancel();
          }
        }}
        placeholder="Add a note..."
        className="w-48 rounded-md bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 border border-zinc-700 focus:outline-none focus:border-zinc-500 font-mono"
      />

      <div className="h-5 w-px bg-zinc-700" />

      {/* Cancel */}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Cancel"
        className="size-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        onClick={onCancel}
      >
        <X className="size-4" />
      </Button>

      {/* Done */}
      <Button
        onClick={onDone}
        disabled={capturing}
        className="h-8 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {capturing ? (
          <span className="flex items-center gap-1.5">
            <span className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Copying...
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Check className="size-3.5" />
            Done
          </span>
        )}
      </Button>
    </div>
  );
}
