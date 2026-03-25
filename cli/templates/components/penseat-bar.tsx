"use client";

import { useState, useCallback, useRef, useEffect, createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Undo2, Trash2, X, Copy, Check } from "lucide-react";
import { Button } from "./ui/button";

const TOOLTIP_DELAY = 360;
const TOOLTIP_GAP = 10;

const TooltipBelowCtx = createContext(false);

const SHIFT_ICON = (
  <svg height="11" width="11" strokeLinejoin="round" style={{ color: "currentColor" }} viewBox="0 0 16 16">
    <path fillRule="evenodd" clipRule="evenodd" d="M8.70711 1.39644C8.31659 1.00592 7.68342 1.00592 7.2929 1.39644L2.21968 6.46966L1.68935 6.99999L2.75001 8.06065L3.28034 7.53032L7.25001 3.56065V14.25V15H8.75001V14.25V3.56065L12.7197 7.53032L13.25 8.06065L14.3107 6.99999L13.7803 6.46966L8.70711 1.39644Z" fill="currentColor" />
  </svg>
);

const CMD_ICON = (
  <svg height="11" width="11" strokeLinejoin="round" style={{ color: "currentColor" }} viewBox="0 0 16 16">
    <path fillRule="evenodd" clipRule="evenodd" d="M1 3.75C1 2.23122 2.23122 1 3.75 1C5.26878 1 6.5 2.23122 6.5 3.75V5H9.5V3.75C9.5 2.23122 10.7312 1 12.25 1C13.7688 1 15 2.23122 15 3.75C15 5.26878 13.7688 6.5 12.25 6.5H11V9.5H12.25C13.7688 9.5 15 10.7312 15 12.25C15 13.7688 13.7688 15 12.25 15C10.7312 15 9.5 13.7688 9.5 12.25V11H6.5V12.25C6.5 13.7688 5.26878 15 3.75 15C2.23122 15 1 13.7688 1 12.25C1 10.7312 2.23122 9.5 3.75 9.5H5V6.5H3.75C2.23122 6.5 1 5.26878 1 3.75ZM11 5H12.25C12.9404 5 13.5 4.44036 13.5 3.75C13.5 3.05964 12.9404 2.5 12.25 2.5C11.5596 2.5 11 3.05964 11 3.75V5ZM9.5 6.5H6.5V9.5H9.5V6.5ZM11 12.25V11H12.25C12.9404 11 13.5 11.5596 13.5 12.25C13.5 12.9404 12.9404 13.5 12.25 13.5C11.5596 13.5 11 12.9404 11 12.25ZM5 11H3.75C3.05964 11 2.5 11.5596 2.5 12.25C2.5 12.9404 3.05964 13.5 3.75 13.5C4.44036 13.5 5 12.9404 5 12.25V11ZM5 3.75V5H3.75C3.05964 5 2.5 4.44036 2.5 3.75C2.5 3.05964 3.05964 2.5 3.75 2.5C4.44036 2.5 5 3.05964 5 3.75Z" fill="currentColor" />
  </svg>
);

function Keycap({ children }: { children: ReactNode }) {
  const content = children === "command" ? CMD_ICON : children === "shift" ? SHIFT_ICON : children;
  return (
    <kbd className="inline-flex items-center justify-center size-5 rounded bg-zinc-700 border border-zinc-600 text-[13px] font-mono leading-none text-zinc-300">
      {content}
    </kbd>
  );
}

function WithTooltip({ label, shortcut, children, pressed }: { label: string; shortcut?: string[]; children: ReactNode; pressed?: boolean }) {
  const below = useContext(TooltipBelowCtx);
  const [hoverShow, setHoverShow] = useState(false);
  const [pos, setPos] = useState<{ x: number; top: number; bottom: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const computePos = useCallback(() => {
    if (wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setPos({ x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom });
    }
  }, []);

  const onEnter = () => {
    timerRef.current = setTimeout(() => {
      computePos();
      setHoverShow(true);
    }, TOOLTIP_DELAY);
  };
  const onLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setHoverShow(false);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div
      ref={wrapRef}
      className="flex items-center self-stretch transition-transform duration-100"
      style={{ transform: pressed ? "scale(0.95)" : undefined }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {children}
      {hoverShow && pos && createPortal(
        <div
          data-penseat="tooltip"
          className="fixed z-[99999] pointer-events-none"
          style={{
            left: pos.x,
            top: below ? pos.bottom + TOOLTIP_GAP : pos.top - TOOLTIP_GAP,
            translate: below ? "-50% 0" : "-50% -100%",
            opacity: 1,
            animation: below ? "tooltip-in-below 150ms ease-out" : "tooltip-in-above 150ms ease-out",
          }}
        >
          <div className={`flex items-center gap-2 rounded-lg bg-[#27272A] pl-3 py-1.5 ${shortcut && shortcut.length > 0 ? "pr-1.5" : "pr-3"}`}>
            <span className="text-xs font-mono text-zinc-200">{label}</span>
            {shortcut && shortcut.length > 0 && (
              <div className="flex items-center gap-0.5">
                {shortcut.map((key, i) => (
                  <Keycap key={i}>{key}</Keycap>
                ))}
              </div>
            )}
          </div>
          <style>{`
            @keyframes tooltip-in-above { from { opacity: 0; translate: -50% calc(-100% + 4px); } }
            @keyframes tooltip-in-below { from { opacity: 0; translate: -50% -4px; } }
          `}</style>
        </div>,
        document.body
      )}
    </div>
  );
}

const COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Yellow", value: "#eab308" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "Eraser", value: "#ffffff" },
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
  copied?: boolean;
  shake?: boolean;
}

function EraserDot({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="size-5 rounded-full cursor-pointer transition-transform hover:scale-110 shrink-0 flex items-center justify-center"
      style={{
        boxShadow: active ? "0 0 0 2px #18181b, 0 0 0 3px #a1a1aa" : "none",
      }}
    >
      <svg viewBox="0 0 20 20" className="size-5">
        <defs>
          <clipPath id="eraser-clip">
            <circle cx="10" cy="10" r="8.5" />
          </clipPath>
        </defs>
        <circle cx="10" cy="10" r="8.5" fill="none" stroke="#71717a" strokeWidth="1.5" />
        <g clipPath="url(#eraser-clip)">
          <line x1="-2" y1="16.34" x2="16.34" y2="-2" stroke="#71717a" strokeWidth="1.2" />
          <line x1="-2" y1="22" x2="22" y2="-2" stroke="#71717a" strokeWidth="1.2" />
          <line x1="3.66" y1="22" x2="22" y2="3.66" stroke="#71717a" strokeWidth="1.2" />
        </g>
      </svg>
    </div>
  );
}

function ColorDots({ colors, active, onChange, pressedId }: { colors: typeof COLORS; active: string; onChange: (c: string) => void; pressedId: string | null }) {
  return (
    <div className="flex items-center gap-2 px-3 shrink-0">
      {colors.map((c, i) => {
        if (c.name === "Eraser") {
          return (
            <WithTooltip key={c.value} label={c.name} shortcut={["E"]} pressed={pressedId === "eraser"}>
              <EraserDot active={active === c.value} onClick={() => onChange(c.value)} />
            </WithTooltip>
          );
        }
        return (
          <WithTooltip key={c.value} label={c.name} shortcut={[String(i + 1)]} pressed={pressedId === `color-${i + 1}`}>
            <div
              onClick={() => onChange(c.value)}
              className="size-5 rounded-full cursor-pointer transition-transform hover:scale-110 shrink-0"
              style={{
                backgroundColor: c.value,
                boxShadow: active === c.value ? `0 0 0 2px #18181b, 0 0 0 3px ${c.value}` : "none",
              }}
            />
          </WithTooltip>
        );
      })}
    </div>
  );
}

function Actions({ onUndo, onClear, pressedId }: { onUndo: () => void; onClear: () => void; pressedId: string | null }) {
  return (
    <div className="flex items-center gap-1 px-1 animate-in fade-in duration-200">
      <WithTooltip label="Undo" shortcut={["command", "Z"]} pressed={pressedId === "undo"}>
        <Button tabIndex={-1} variant="ghost" size="icon" aria-label="Undo" className={`size-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 shrink-0 cursor-pointer active:scale-[0.9] active:translate-y-0 transition-all ${pressedId === "undo" ? "bg-zinc-800 text-zinc-100" : ""}`} onClick={onUndo}>
          <Undo2 className="size-4" />
        </Button>
      </WithTooltip>
      <WithTooltip label="Clear all" shortcut={["X"]} pressed={pressedId === "clear"}>
        <Button tabIndex={-1} variant="ghost" size="icon" aria-label="Clear all" className={`size-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 shrink-0 cursor-pointer active:scale-[0.9] active:translate-y-0 transition-all ${pressedId === "clear" ? "bg-zinc-800 text-zinc-100" : ""}`} onClick={onClear}>
          <Trash2 className="size-4" />
        </Button>
      </WithTooltip>
    </div>
  );
}

const PEN_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-5" fill="none">
    <path fillRule="evenodd" clipRule="evenodd" d="M20.1507 2.76256C19.4673 2.07914 18.3593 2.07915 17.6759 2.76256L16.0006 4.43796L16.0001 4.4375L14.9395 5.49816L18.9091 9.46783C19.202 9.76072 19.202 10.2356 18.9091 10.5285L16.9698 12.4678C16.6769 12.7607 16.6769 13.2356 16.9698 13.5285C17.2627 13.8214 17.7375 13.8214 18.0304 13.5285L19.9698 11.5892C20.8485 10.7105 20.8485 9.28585 19.9698 8.40717L19.5612 7.99862L21.2365 6.32322C21.9199 5.63981 21.9199 4.53177 21.2365 3.84835L20.1507 2.76256ZM17.6159 9.94413L14.0552 6.38347L8.49985 11.9392L12.0605 15.4999L17.6159 9.94413ZM3.83613 16.6032L7.43923 12.9999L10.9999 16.5605L7.39683 20.1639C7.06636 20.4943 6.65711 20.7351 6.20775 20.8635L3.20606 21.7211C2.94416 21.796 2.66229 21.7229 2.46969 21.5303C2.27709 21.3377 2.20405 21.0559 2.27888 20.794L3.1365 17.7923C3.26489 17.3429 3.50567 16.9337 3.83613 16.6032Z" fill="currentColor" />
  </svg>
);

// Morph icon slot: pen and close overlap, crossfade with scale+blur
function AnchorIcon({ expanded, onToggle, onPointerDown, wasDragRef, pressed, rightExpand }: {
  expanded: boolean;
  onToggle: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  wasDragRef: React.RefObject<boolean>;
  pressed?: boolean;
  rightExpand: boolean;
}) {
  // Spin toward the toolbar: clockwise when expanding right, counter-clockwise when left
  const spinDeg = rightExpand ? 90 : -90;
  return (
    <button
      tabIndex={-1}
      data-penseat="trigger"
      onClick={(e) => { (e.currentTarget as HTMLElement).blur(); if (!wasDragRef.current) onToggle(); }}
      onPointerDown={expanded ? undefined : onPointerDown}
      className="relative flex items-center justify-center shrink-0 cursor-pointer transition-colors [&:hover]:bg-zinc-800 rounded-full"
      style={{
        width: BAR_HEIGHT - 4,
        height: BAR_HEIGHT - 4,
        transform: pressed ? "scale(0.9)" : undefined,
        transition: "transform 100ms",
      }}
    >
      {/* Pen icon — visible when collapsed */}
      <span
        className="absolute inset-0 flex items-center justify-center text-white transition-all duration-200 ease-in-out"
        style={{
          opacity: expanded ? 0 : 1,
          transform: expanded ? "scale(0.5)" : "scale(1)",
          filter: expanded ? "blur(4px)" : "blur(0px)",
          pointerEvents: expanded ? "none" : "auto",
          transitionDelay: expanded ? "0ms" : "60ms",
        }}
      >
        {PEN_ICON}
      </span>
      {/* Close icon — spins in from the toolbar direction */}
      <span
        className="absolute inset-0 flex items-center justify-center text-zinc-400 transition-all duration-300 ease-in-out"
        style={{
          opacity: expanded ? 1 : 0,
          transform: expanded ? "scale(1) rotate(0deg)" : `scale(0.5) rotate(${-spinDeg}deg)`,
          filter: expanded ? "blur(0px)" : "blur(4px)",
          pointerEvents: expanded ? "auto" : "none",
          transitionDelay: expanded ? "0ms" : "60ms",
        }}
      >
        <X className="size-5" />
      </span>
    </button>
  );
}

function DoneBtn({ onClick, disabled, capturing, copied, pressed, shake }: { onClick: () => void; disabled: boolean; capturing: boolean; copied: boolean; pressed: boolean; shake?: boolean }) {
  const anim = copied ? "copy-bounce 600ms ease-out" : shake ? "nope-shake 320ms ease-out" : undefined;
  return (
    <div className="flex items-center self-stretch" style={anim ? { animation: anim } : undefined}>
      <WithTooltip key={copied ? "copied" : "copy"} label={copied ? "Copied!" : "Copy"} shortcut={copied ? undefined : ["command", "C"]} pressed={pressed}>
        <Button
          tabIndex={-1}
          variant="ghost"
          size="icon"
          onClick={onClick}
          disabled={disabled && !copied}
          aria-label="Done"
          className={`size-8 shrink-0 animate-in fade-in duration-200 cursor-pointer active:scale-[0.9] active:translate-y-0 transition-all ${
            copied
              ? "bg-blue-500 text-white hover:bg-blue-500 hover:text-white"
              : pressed
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          } disabled:opacity-50`}
          style={{ borderRadius: copied ? 9999 : undefined }}
        >
          {capturing ? (
            <span className="size-3 animate-spin rounded-full border-2 border-zinc-400/30 border-t-zinc-400" />
          ) : (
            <span className="relative size-4">
              <Copy className="size-4 absolute inset-0 transition-all duration-200" style={{ opacity: copied ? 0 : 1, transform: copied ? "scale(0.5)" : "scale(1)" }} />
              <Check className="size-4 absolute inset-0 transition-all duration-200" strokeWidth={3} style={{ opacity: copied ? 1 : 0, transform: copied ? "scale(1)" : "scale(0.5)" }} />
            </span>
          )}
        </Button>
      </WithTooltip>
      {(shake || copied) && (
        <style>{`
          @keyframes nope-shake {
            0%   { transform: translateX(0); }
            20%  { transform: translateX(-3px); }
            50%  { transform: translateX(3px); }
            80%  { transform: translateX(-2px); }
            100% { transform: translateX(0); }
          }
          @keyframes copy-bounce {
            0%   { transform: translateY(0); }
            30%  { transform: translateY(-6px); }
            50%  { transform: translateY(0); }
            70%  { transform: translateY(-2px); }
            100% { transform: translateY(0); }
          }
        `}</style>
      )}
    </div>
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
  copied,
  shake,
}: PenseatBarProps) {
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  // Flying state: animating from release to target corner
  const [flyPos, setFlyPos] = useState<{ x: number; y: number } | null>(null);
  // Projectile preview: target corner while dragging
  const [targetPreview, setTargetPreview] = useState<Corner | null>(null);

  // Keyboard shortcut flash effect
  const [pressedId, setPressedId] = useState<string | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (!expanded) return;

    function handleKeyDown(e: KeyboardEvent) {
      let id: string | null = null;
      const isMeta = e.metaKey || e.ctrlKey;

      if (!isMeta && !e.shiftKey) {
        if (["1", "2", "3", "4"].includes(e.key)) id = `color-${e.key}`;
        else if (e.key === "e" || e.key === "5") id = "eraser";
        else if (e.key === "x") id = "clear";
      }
      if (e.key === "Escape") id = "close";
      if (isMeta && e.key === "z") id = "undo";
      if (isMeta && e.key === "c") id = "copy";

      if (id) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        setPressedId(id);
        pressTimerRef.current = setTimeout(() => setPressedId(null), 80);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    };
  }, [expanded]);
  const isDragging = dragPos !== null;
  const isFlying = flyPos !== null;
  const wasDragRef = useRef(false);
  const flyRafRef = useRef<number>(0);

  // Measure toolbar content width for smooth expansion
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);

  // Measure content scrollWidth (works even when parent clips)
  useEffect(() => {
    if (contentRef.current) {
      setContentWidth(contentRef.current.scrollWidth);
    }
  });
  // Also measure on window resize
  useEffect(() => {
    function measure() {
      if (contentRef.current) setContentWidth(contentRef.current.scrollWidth);
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);


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

      // Animate flight to target corner (faster for low velocity, longer for throws)
      const dest = cornerCenter(target);
      const startPos = clampCenter(releaseX, releaseY);
      const dist = Math.hypot(dest.x - startPos.x, dest.y - startPos.y);
      const duration = isThrow ? FLIGHT_DURATION : Math.max(120, Math.min(250, dist * 0.6));
      const startTime = performance.now();

      function animateFlight() {
        const now = performance.now();
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
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
  const isRight = corner === "rb" || corner === "rt";
  const isTop = corner === "lt" || corner === "rt";
  let posStyle: Record<string, string> = {};

  if (isFlying) {
    posStyle = { left: `${flyPos.x - BAR_HEIGHT / 2}px`, top: `${flyPos.y - BAR_HEIGHT / 2}px` };
  } else if (isDragging) {
    posStyle = { left: `${dragPos.x - BAR_HEIGHT / 2}px`, top: `${dragPos.y - BAR_HEIGHT / 2}px` };
  } else {
    // Always anchor from the corner edge — both collapsed and expanded
    // This ensures the bar grows/shrinks toward the corner
    posStyle = {
      top: isTop ? `${OFFSET}px` : `calc(100% - ${OFFSET}px - ${BAR_HEIGHT}px)`,
      ...(isRight
        ? { right: `${OFFSET}px`, left: "auto" }
        : { left: `${OFFSET}px`, right: "auto" }),
    };
  }

  const rightExpand = expandsRight(corner);
  const isAnimating = isDragging || isFlying;

  // Projectile preview line (clamped to viewport)
  const previewTarget = targetPreview ? clampCenter(cornerCenter(targetPreview).x, cornerCenter(targetPreview).y) : null;

  return (
    <TooltipBelowCtx.Provider value={isTop}>
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
        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") e.preventDefault(); }}
        className={`fixed z-[9999] flex items-center overflow-hidden rounded-full bg-zinc-800 border-[1.5px] border-white/25 shadow-[0_0_0_0.5px_rgba(255,255,255,0.06),0_1px_3px_rgba(0,0,0,0.15),inset_0_0.5px_0_rgba(255,255,255,0.06)] ${isDragging ? "opacity-80 scale-105" : ""} ${isFlying ? "scale-95" : ""}`}
        style={{
          ...posStyle,
          height: BAR_HEIGHT,
          width: expanded ? contentWidth + (BAR_HEIGHT - 4) + 4 : BAR_HEIGHT,
          flexDirection: rightExpand ? "row" : "row-reverse",
          ...(isAnimating ? {} : {
            transitionProperty: "all",
            transitionTimingFunction: expanded ? "cubic-bezier(0.22, 1.12, 0.58, 1)" : "ease-out",
            transitionDelay: expanded ? "120ms" : "0ms",
            transitionDuration: expanded ? "260ms" : "80ms",
          }),
        }}
      >
        {/* Anchor icon (pen/close morph) — always at the corner edge */}
        <AnchorIcon expanded={expanded} onToggle={onToggle} onPointerDown={handlePointerDown} wasDragRef={wasDragRef} pressed={pressedId === "close"} rightExpand={rightExpand} />

        {/* Toolbar content — always in DOM, revealed/hidden by width animation */}
        <div
          ref={contentRef}
          className="flex flex-row items-stretch self-stretch shrink-0 pr-2"
          style={{ pointerEvents: expanded ? "auto" : "none" }}
        >
          <ColorDots colors={COLORS} active={color} onChange={onColorChange} pressedId={pressedId} />
<Actions onUndo={onUndo} onClear={onClear} pressedId={pressedId} />
          <DoneBtn onClick={onDone} disabled={capturing || !!copied} capturing={capturing} copied={!!copied} pressed={pressedId === "copy"} shake={shake} />
        </div>
      </div>
    </TooltipBelowCtx.Provider>
  );
}
