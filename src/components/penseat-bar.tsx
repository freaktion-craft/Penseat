"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Undo2, Trash2, X, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

const COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Yellow", value: "#eab308" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "White", value: "#ffffff" },
];

const BAR_HEIGHT = 44;
const OFFSET = 16;
const MIN_THROW_SPEED = 800; // px/s — needs a real flick to trigger directional throw
const FLIGHT_DURATION = 350; // ms

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

function ColorDots({ colors, active, onChange }: { colors: typeof COLORS; active: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 px-3 shrink-0">
      {colors.map((c) => (
        <div
          key={c.value}
          role="button"
          tabIndex={0}
          aria-label={c.name}
          onClick={() => onChange(c.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onChange(c.value); }}
          className="size-5 rounded-full cursor-pointer transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 shrink-0"
          style={{
            backgroundColor: c.value,
            boxShadow: active === c.value ? `0 0 0 2px #18181b, 0 0 0 3px ${c.value}` : "none",
          }}
        />
      ))}
    </div>
  );
}

function Actions({ onUndo, onClear }: { onUndo: () => void; onClear: () => void }) {
  return (
    <div className="flex items-center gap-1 px-1 animate-in fade-in duration-200">
      <Button variant="ghost" size="icon" aria-label="Undo" className="size-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 shrink-0" onClick={onUndo}>
        <Undo2 className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Clear all" className="size-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 shrink-0" onClick={onClear}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" aria-label="Cancel" className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 shrink-0 rounded-full animate-in fade-in duration-200" style={{ width: BAR_HEIGHT, height: BAR_HEIGHT }} onClick={onClick}>
      <X className="size-4" />
    </Button>
  );
}

function DoneBtn({ onClick, disabled, capturing }: { onClick: () => void; disabled: boolean; capturing: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label="Done"
      className="size-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-50 shrink-0 animate-in fade-in duration-200"
    >
      {capturing ? (
        <span className="size-3 animate-spin rounded-full border-2 border-zinc-400/30 border-t-zinc-400" />
      ) : (
        <Copy className="size-4" />
      )}
    </Button>
  );
}

// Clamp center position so the full button stays inside the viewport
function clampCenter(x: number, y: number): { x: number; y: number } {
  const half = BAR_HEIGHT / 2;
  return {
    x: Math.max(half, Math.min(window.innerWidth - half, x)),
    y: Math.max(half, Math.min(window.innerHeight - half, y)),
  };
}

// Corner pixel positions (center of button)
function cornerCenter(c: Corner): { x: number; y: number } {
  const half = BAR_HEIGHT / 2;
  const w = window.innerWidth;
  const h = window.innerHeight;
  switch (c) {
    case "lt": return { x: OFFSET + half, y: OFFSET + half };
    case "rt": return { x: w - OFFSET - half, y: OFFSET + half };
    case "lb": return { x: OFFSET + half, y: h - OFFSET - half };
    case "rb": return { x: w - OFFSET - half, y: h - OFFSET - half };
  }
}

function getPositionStyle(corner: Corner): { left: string; top: string } {
  const size = `${BAR_HEIGHT}px`;
  switch (corner) {
    case "rb":
      return { left: `calc(100% - ${OFFSET}px - ${size})`, top: `calc(100% - ${OFFSET}px - ${size})` };
    case "lb":
      return { left: `${OFFSET}px`, top: `calc(100% - ${OFFSET}px - ${size})` };
    case "rt":
      return { left: `calc(100% - ${OFFSET}px - ${size})`, top: `${OFFSET}px` };
    case "lt":
      return { left: `${OFFSET}px`, top: `${OFFSET}px` };
  }
}

function expandsRight(corner: Corner) {
  return corner === "lb" || corner === "lt";
}

// Pick the corner most aligned with the drag direction from current position
function cornerFromDirection(fromX: number, fromY: number, dx: number, dy: number): Corner {
  const dragAngle = Math.atan2(dy, dx);
  let best: Corner = "rb";
  let bestDot = -Infinity;

  for (const c of CORNERS) {
    const cc = cornerCenter(c);
    const toX = cc.x - fromX;
    const toY = cc.y - fromY;
    const dist = Math.hypot(toX, toY);
    if (dist < 1) continue; // already at this corner
    // Dot product of normalized vectors = cos(angle between)
    const dot = (dx * toX + dy * toY) / (Math.hypot(dx, dy) * dist);
    if (dot > bestDot) {
      bestDot = dot;
      best = c;
    }
  }
  return best;
}

// All 4 corners
const CORNERS: Corner[] = ["lt", "rt", "lb", "rb"];

// Closest corner to a point
function closestCorner(x: number, y: number): Corner {
  let best: Corner = "rb";
  let bestDist = Infinity;
  for (const c of CORNERS) {
    const cc = cornerCenter(c);
    const d = Math.hypot(cc.x - x, cc.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
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
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  // Flying state: animating from release to target corner
  const [flyPos, setFlyPos] = useState<{ x: number; y: number } | null>(null);
  // Projectile preview: target corner while dragging
  const [targetPreview, setTargetPreview] = useState<Corner | null>(null);
  const isDragging = dragPos !== null;
  const isFlying = flyPos !== null;
  const wasDragRef = useRef(false);
  const flyRafRef = useRef<number>(0);

  // Track velocity from recent pointer positions
  const historyRef = useRef<{ x: number; y: number; t: number }[]>([]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (expanded) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const el = (e.currentTarget as HTMLElement).closest("[data-penseat='bar']") as HTMLElement;
    const rect = el.getBoundingClientRect();
    const offsetX = startX - (rect.left + rect.width / 2);
    const offsetY = startY - (rect.top + rect.height / 2);
    let moved = false;
    historyRef.current = [{ x: startX, y: startY, t: performance.now() }];

    function onMove(ev: PointerEvent) {
      if (!moved && (Math.abs(ev.clientX - startX) > 6 || Math.abs(ev.clientY - startY) > 6)) {
        moved = true;
      }
      if (moved) {
        const clamped = clampCenter(ev.clientX - offsetX, ev.clientY - offsetY);
        const cx = clamped.x;
        const cy = clamped.y;
        setDragPos({ x: cx, y: cy });

        // Track movement history (keep last 200ms for direction)
        const now = performance.now();
        historyRef.current.push({ x: ev.clientX, y: ev.clientY, t: now });
        while (historyRef.current.length > 2 && now - historyRef.current[0].t > 200) {
          historyRef.current.shift();
        }

        // Direction = displacement over the last 200ms window
        const h = historyRef.current;
        if (h.length >= 2) {
          const oldest = h[0];
          const newest = h[h.length - 1];
          const dt = (newest.t - oldest.t) / 1000;
          if (dt > 0.016) {
            const dx = newest.x - oldest.x;
            const dy = newest.y - oldest.y;
            const speed = Math.hypot(dx, dy) / dt;
            if (speed > MIN_THROW_SPEED) {
              setTargetPreview(cornerFromDirection(cx, cy, dx, dy));
            } else {
              setTargetPreview(null);
            }
          }
        }
      }
    }

    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragPos(null);
      setTargetPreview(null);

      if (!moved) return;

      wasDragRef.current = true;
      requestAnimationFrame(() => { wasDragRef.current = false; });

      // Compute release direction from displacement over 200ms window
      const h = historyRef.current;
      let dx = 0, dy = 0, speed = 0;
      if (h.length >= 2) {
        const oldest = h[0];
        const newest = h[h.length - 1];
        const dt = (newest.t - oldest.t) / 1000;
        if (dt > 0.016) {
          dx = newest.x - oldest.x;
          dy = newest.y - oldest.y;
          speed = Math.hypot(dx, dy) / dt;
        }
      }

      // Determine target from movement direction
      const releaseX = ev.clientX - offsetX;
      const releaseY = ev.clientY - offsetY;
      const isThrow = speed > MIN_THROW_SPEED;
      const target = isThrow
        ? cornerFromDirection(releaseX, releaseY, dx, dy)
        : closestCorner(releaseX, releaseY);

      // Low velocity: just snap back with CSS transition (straight line)
      if (!isThrow) {
        onCornerChange(target);
        return;
      }

      // Fast throw: straight line flight with ease-out
      const dest = cornerCenter(target);
      const startPos = clampCenter(releaseX, releaseY);
      const startTime = performance.now();

      function animateFlight() {
        const now = performance.now();
        const elapsed = now - startTime;
        const t = Math.min(elapsed / FLIGHT_DURATION, 1);
        const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

        const rawX = startPos.x + (dest.x - startPos.x) * ease;
        const rawY = startPos.y + (dest.y - startPos.y) * ease;
        const clamped = clampCenter(rawX, rawY);

        setFlyPos(clamped);

        if (t < 1) {
          flyRafRef.current = requestAnimationFrame(animateFlight);
        } else {
          setFlyPos(null);
          onCornerChange(target);
        }
      }

      flyRafRef.current = requestAnimationFrame(animateFlight);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [expanded, corner, onCornerChange]);

  // Cleanup flight animation on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(flyRafRef.current);
  }, []);

  // Position: flying > dragging > corner
  // When expanded on right side, anchor from right edge so it grows left
  const isRight = corner === "rb" || corner === "rt";
  const isTop = corner === "lt" || corner === "rt";
  let posStyle: Record<string, string> = {};

  if (isFlying) {
    posStyle = { left: `${flyPos.x - BAR_HEIGHT / 2}px`, top: `${flyPos.y - BAR_HEIGHT / 2}px` };
  } else if (isDragging) {
    posStyle = { left: `${dragPos.x - BAR_HEIGHT / 2}px`, top: `${dragPos.y - BAR_HEIGHT / 2}px` };
  } else if (expanded) {
    // Expanded: anchor from the corner edge so toolbar grows inward
    posStyle = {
      top: isTop ? `${OFFSET}px` : `calc(100% - ${OFFSET}px - ${BAR_HEIGHT}px)`,
      ...(isRight
        ? { right: `${OFFSET}px`, left: "auto" }
        : { left: `${OFFSET}px`, right: "auto" }),
    };
  } else {
    posStyle = getPositionStyle(corner);
  }

  const rightExpand = expandsRight(corner);
  const isAnimating = isDragging || isFlying;

  // Projectile preview line (clamped to viewport)
  const previewTarget = targetPreview ? clampCenter(cornerCenter(targetPreview).x, cornerCenter(targetPreview).y) : null;

  return (
    <>
      {/* Projectile preview line */}
      {isDragging && previewTarget && dragPos && (
        <svg
          data-penseat="projectile"
          className="fixed inset-0 z-[9998] pointer-events-none"
          style={{ width: "100%", height: "100%" }}
        >
          <line
            x1={dragPos.x}
            y1={dragPos.y}
            x2={previewTarget.x}
            y2={previewTarget.y}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="2"
            strokeDasharray="6 4"
          />
          {/* Target indicator */}
          <circle
            cx={previewTarget.x}
            cy={previewTarget.y}
            r="8"
            fill="none"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="1.5"
          />
        </svg>
      )}

      <div
        data-penseat="bar"
        className={`fixed z-[9999] flex flex-row items-center overflow-hidden rounded-full bg-zinc-900 border-2 border-zinc-400/40 shadow-[0_0_0_0.5px_rgba(255,255,255,0.06),0_1px_3px_rgba(0,0,0,0.15),inset_0_0.5px_0_rgba(255,255,255,0.06)] ${isAnimating ? "" : "transition-all duration-300 ease-in-out"} ${isDragging ? "opacity-80 scale-105" : ""} ${isFlying ? "scale-95" : ""}`}
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
          <>
            <ColorDots colors={COLORS} active={color} onChange={onColorChange} />
            <Actions onUndo={onUndo} onClear={onClear} />
            <DoneBtn onClick={onDone} disabled={capturing} capturing={capturing} />
            <CloseBtn onClick={onToggle} />
          </>
        )}
      </div>
    </>
  );
}
