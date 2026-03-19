"use client";

import { useState, useCallback, useRef } from "react";
import { Undo2, Trash2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Yellow", value: "#eab308" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "White", value: "#ffffff" },
];

const BAR_HEIGHT = 44;
const OFFSET = 16; // px from browser corner

export type Corner = "lb" | "rb" | "lt" | "rt";

interface PenseatBarProps {
  expanded: boolean;
  corner: Corner;
  onCornerChange: (corner: Corner) => void;
  color: string;
  onColorChange: (color: string) => void;
  onToggle: () => void;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
  capturing: boolean;
}

// Position styles for each corner
function getPositionStyle(corner: Corner) {
  switch (corner) {
    case "rb":
      return { bottom: OFFSET, right: OFFSET };
    case "lb":
      return { bottom: OFFSET, left: OFFSET };
    case "rt":
      return { top: OFFSET, right: OFFSET };
    case "lt":
      return { top: OFFSET, left: OFFSET };
  }
}

// Whether expanded content should go to the right of colors
function expandsRight(corner: Corner) {
  return corner === "lb" || corner === "lt";
}

export default function PenseatBar({
  expanded,
  corner,
  onCornerChange,
  color,
  onColorChange,
  onToggle,
  onUndo,
  onClear,
  onDone,
  capturing,
}: PenseatBarProps) {
  // Drag state: null = not dragging, { x, y } = current position
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const isDragging = dragPos !== null;
  const wasDragRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (expanded) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const el = (e.currentTarget as HTMLElement).closest("[data-penseat='bar']") as HTMLElement;
    const rect = el.getBoundingClientRect();
    // Offset from pointer to element center
    const offsetX = startX - (rect.left + rect.width / 2);
    const offsetY = startY - (rect.top + rect.height / 2);
    let moved = false;

    function onMove(ev: PointerEvent) {
      if (!moved && (Math.abs(ev.clientX - startX) > 6 || Math.abs(ev.clientY - startY) > 6)) {
        moved = true;
      }
      if (moved) {
        setDragPos({
          x: ev.clientX - offsetX,
          y: ev.clientY - offsetY,
        });
      }
    }

    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragPos(null);

      if (!moved) return;

      wasDragRef.current = true;
      requestAnimationFrame(() => { wasDragRef.current = false; });

      const midX = window.innerWidth / 2;
      const midY = window.innerHeight / 2;
      const isLeft = ev.clientX < midX;
      const isTop = ev.clientY < midY;

      const newCorner: Corner = isTop
        ? isLeft ? "lt" : "rt"
        : isLeft ? "lb" : "rb";

      onCornerChange(newCorner);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [expanded, corner, onCornerChange]);

  const posStyle = isDragging
    ? { left: dragPos.x - BAR_HEIGHT / 2, top: dragPos.y - BAR_HEIGHT / 2 }
    : getPositionStyle(corner);
  const rightExpand = expandsRight(corner);

  // Flex direction: if expanding right, colors first then actions
  // If expanding left, reverse so it grows leftward
  const flexDir = rightExpand ? "flex-row" : "flex-row-reverse";

  return (
    <div
      data-penseat="bar"
      className={`fixed z-[9999] flex items-center overflow-hidden rounded-full bg-zinc-900 border-2 border-zinc-500/30 shadow-[0_0_0_0.5px_rgba(255,255,255,0.06),0_1px_3px_rgba(0,0,0,0.15),inset_0_0.5px_0_rgba(255,255,255,0.06)] ${flexDir} ${isDragging ? "opacity-80 scale-105" : "transition-all duration-300 ease-in-out"}`}
      style={{
        ...posStyle,
        height: BAR_HEIGHT,
        width: expanded ? "auto" : BAR_HEIGHT,
      }}
    >
      {!expanded ? (
        <button
          data-penseat="trigger"
          onClick={() => { if (!wasDragRef.current) onToggle(); }}
          onPointerDown={handlePointerDown}
          className="flex items-center justify-center text-white cursor-pointer transition-colors [&:hover]:bg-zinc-800"
          style={{ width: BAR_HEIGHT, height: BAR_HEIGHT }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-5" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M20.1507 2.76256C19.4673 2.07914 18.3593 2.07915 17.6759 2.76256L16.0006 4.43796L16.0001 4.4375L14.9395 5.49816L18.9091 9.46783C19.202 9.76072 19.202 10.2356 18.9091 10.5285L16.9698 12.4678C16.6769 12.7607 16.6769 13.2356 16.9698 13.5285C17.2627 13.8214 17.7375 13.8214 18.0304 13.5285L19.9698 11.5892C20.8485 10.7105 20.8485 9.28585 19.9698 8.40717L19.5612 7.99862L21.2365 6.32322C21.9199 5.63981 21.9199 4.53177 21.2365 3.84835L20.1507 2.76256ZM17.6159 9.94413L14.0552 6.38347L8.49985 11.9392L12.0605 15.4999L17.6159 9.94413ZM3.83613 16.6032L7.43923 12.9999L10.9999 16.5605L7.39683 20.1639C7.06636 20.4943 6.65711 20.7351 6.20775 20.8635L3.20606 21.7211C2.94416 21.796 2.66229 21.7229 2.46969 21.5303C2.27709 21.3377 2.20405 21.0559 2.27888 20.794L3.1365 17.7923C3.26489 17.3429 3.50567 16.9337 3.83613 16.6032Z" fill="currentColor" />
          </svg>
        </button>
      ) : (
        <div className="flex items-center gap-1.5 px-3 shrink-0">
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
        <div className="flex items-center gap-1 px-2 animate-in fade-in duration-200">
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
