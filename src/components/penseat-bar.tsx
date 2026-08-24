"use client";

import { useState, useCallback, useRef, useEffect, createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
// Inline SVG icons (from Lucide) — zero dependencies
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const Undo2Icon = <svg {...iconProps}><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>;
const Trash2Icon = <svg {...iconProps}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>;
const XIcon = <svg {...iconProps} width={20} height={20}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;
const CopyIcon = <svg {...iconProps}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>;
const CheckIcon = <svg {...iconProps} strokeWidth={3}><path d="M20 6 9 17l-5-5"/></svg>;
const CursorIcon = <svg {...iconProps}><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/></svg>;
const PenToolIcon = <svg {...iconProps}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>;

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
    <kbd style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '20px',
      height: '20px',
      borderRadius: '4px',
      backgroundColor: '#3f3f46',
      border: '1px solid #52525b',
      fontSize: '13px',
      fontFamily: 'monospace',
      lineHeight: 1,
      color: '#d4d4d8',
    }}>
      {content}
    </kbd>
  );
}

function WithTooltip({ label, shortcut, children, pressed, forceShow }: { label: string; shortcut?: string[]; children: ReactNode; pressed?: boolean; forceShow?: boolean }) {
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

  // Force-show: compute position on mount when forceShow is true
  useEffect(() => {
    if (forceShow) computePos();
  }, [forceShow, computePos]);

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
      style={{
        display: 'flex',
        alignItems: 'center',
        alignSelf: 'stretch',
        transition: 'transform 100ms',
        transform: pressed ? 'scale(0.95)' : undefined,
      }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {children}
      {(hoverShow || forceShow) && pos && createPortal(
        <div
          data-penseat="tooltip"
          style={{
            position: 'fixed',
            zIndex: 99999,
            pointerEvents: 'none',
            left: pos.x,
            top: below ? pos.bottom + TOOLTIP_GAP : pos.top - TOOLTIP_GAP,
            translate: below ? "-50% 0" : "-50% -100%",
            opacity: 1,
            animation: below ? "tooltip-in-below 150ms ease-out" : "tooltip-in-above 150ms ease-out",
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderRadius: '8px',
            backgroundColor: '#18181b',
            paddingLeft: '12px',
            paddingTop: '6px',
            paddingBottom: '6px',
            paddingRight: shortcut && shortcut.length > 0 ? '6px' : '12px',
          }}>
            <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#e4e4e7' }}>{label}</span>
            {shortcut && shortcut.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
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
  tool: "pen" | "cursor";
  onToolChange: (tool: "pen" | "cursor") => void;
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

function ToolBtn({ active, onClick, pressed, icon, label, shortcut }: { active: boolean; onClick: () => void; pressed: boolean; icon: ReactNode; label: string; shortcut?: string[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <WithTooltip label={label} shortcut={shortcut} pressed={pressed}>
        <button
          tabIndex={-1}
          // Skip the shared hover override when active so the accent color holds
          {...(active ? {} : { "data-penseat-btn": "" })}
          aria-label={label}
          onClick={onClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            flexShrink: 0,
            cursor: 'pointer',
            transition: 'all 150ms',
            transform: pressed ? 'scale(0.9)' : undefined,
            color: active ? '#f4f4f5' : '#a1a1aa',
            backgroundColor: active ? 'rgba(63,63,70,1)' : 'rgba(63,63,70,0)',
            border: 'none',
            outline: 'none',
            borderRadius: '6px',
            padding: 0,
          }}
        >
          {icon}
        </button>
      </WithTooltip>
    </div>
  );
}

function EraserDot({ active, onClick }: { active: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        width: '20px',
        height: '20px',
        borderRadius: '9999px',
        cursor: 'pointer',
        transition: 'transform 150ms',
        transform: hovered ? 'scale(1.1)' : 'scale(1)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: active ? "0 0 0 2px #18181b, 0 0 0 3px #a1a1aa" : "none",
      }}
    >
      <svg viewBox="0 0 20 20" style={{ width: '20px', height: '20px' }}>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', flexShrink: 0 }}>
      {colors.map((c, i) => {
        if (c.name === "Eraser") {
          return (
            <WithTooltip key={c.value} label={c.name} shortcut={["E"]} pressed={pressedId === "eraser"}>
              <EraserDot active={active === c.value} onClick={() => onChange(c.value)} />
            </WithTooltip>
          );
        }
        return (
          <ColorDot key={c.value} color={c} index={i} active={active === c.value} onChange={onChange} pressedId={pressedId} />
        );
      })}
    </div>
  );
}

function ColorDot({ color: c, index: i, active, onChange, pressedId }: { color: typeof COLORS[number]; index: number; active: boolean; onChange: (c: string) => void; pressedId: string | null }) {
  const [hovered, setHovered] = useState(false);
  return (
    <WithTooltip label={c.name} shortcut={[String(i + 1)]} pressed={pressedId === `color-${i + 1}`}>
      <div
        onClick={() => onChange(c.value)}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={{
          width: '20px',
          height: '20px',
          borderRadius: '9999px',
          cursor: 'pointer',
          transition: 'transform 150ms',
          transform: hovered ? 'scale(1.1)' : 'scale(1)',
          flexShrink: 0,
          backgroundColor: c.value,
          boxShadow: active ? `0 0 0 2px #18181b, 0 0 0 3px ${c.value}` : "none",
        }}
      />
    </WithTooltip>
  );
}

function ActionButton({ icon, ariaLabel, onClick, pressed }: { icon: ReactNode; ariaLabel: string; onClick: () => void; pressed: boolean }) {
  return (
    <button
      tabIndex={-1}
      data-penseat-btn
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '32px',
        height: '32px',
        flexShrink: 0,
        cursor: 'pointer',
        transition: 'all 150ms',
        transform: pressed ? 'scale(0.9)' : undefined,
        color: pressed ? '#f4f4f5' : '#a1a1aa',
        backgroundColor: pressed ? 'rgba(63,63,70,1)' : 'rgba(63,63,70,0)',
        border: 'none',
        outline: 'none',
        borderRadius: '6px',
        padding: 0,
      }}
    >
      {icon}
    </button>
  );
}

// Undo lives with the pen's sub-tools; clear-all stays global
function UndoBtn({ onUndo, pressedId }: { onUndo: () => void; pressedId: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', paddingRight: '4px' }}>
      <WithTooltip label="Undo" shortcut={["command", "Z"]} pressed={pressedId === "undo"}>
        <ActionButton
          icon={Undo2Icon}
          ariaLabel="Undo"
          onClick={onUndo}
          pressed={pressedId === "undo"}
        />
      </WithTooltip>
    </div>
  );
}

function Actions({ onClear, pressedId }: { onClear: () => void; pressedId: string | null }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '0 4px',
      opacity: 1,
    }}>
      <WithTooltip label="Clear all" shortcut={["X"]} pressed={pressedId === "clear"}>
        <ActionButton
          icon={Trash2Icon}
          ariaLabel="Clear all"
          onClick={onClear}
          pressed={pressedId === "clear"}
        />
      </WithTooltip>
    </div>
  );
}

// Penseat logo — tinted by the wrapper's color
const LOGO_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" style={{ width: '22px', height: '22px' }} fill="none">
    <path d="M206.917 39.8401C248.595 21.7799 282.988 25.5116 307.033 43.802C330.035 61.2996 340.023 89.5913 338.984 113.752L338.977 113.915L338.967 114.078C336.525 153.633 304.585 215.748 235.264 226.322C207.544 230.551 178.944 228.285 153.483 223.437C150.701 271.62 154.848 319.864 158.747 351.908C159.915 361.502 153.083 370.226 143.49 371.394C133.896 372.561 125.171 365.731 124.003 356.137C119.84 321.922 115.211 268.433 118.954 214.957C100.21 209.329 84.5221 202.932 74.225 197.825C65.5664 193.531 62.0285 183.031 66.3226 174.372C70.6169 165.714 81.1172 162.176 89.7757 166.47C97.158 170.131 108.676 174.942 122.79 179.496C126.697 153.514 133.202 128.042 143.62 105.681C156.873 77.239 176.971 52.8169 206.917 39.8401ZM285.843 71.6584C274.409 62.9603 254.155 57.515 220.833 71.9543C200.992 80.5521 186.171 97.2286 175.346 120.462C166.27 139.941 160.373 163.307 156.861 188.431C180.481 193.201 206.157 195.358 229.987 191.723C278.568 184.312 302.213 140.043 304.022 112.088C304.596 97.5387 298.274 81.1148 285.843 71.6584Z" fill="currentColor" />
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
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: 'pointer',
        backgroundColor: 'rgba(63,63,70,0)',
        borderRadius: '9999px',
        border: 'none',
        outline: 'none',
        padding: 0,
        width: BAR_HEIGHT - 4,
        height: BAR_HEIGHT - 4,
        transform: pressed ? "scale(0.9)" : undefined,
        transition: "transform 100ms, background-color 150ms",
      }}
    >
      {/* Logo — visible when collapsed */}
      <span
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff',
          transition: 'all 200ms ease-in-out',
          opacity: expanded ? 0 : 1,
          transform: expanded ? "scale(0.5)" : "scale(1)",
          filter: expanded ? "blur(4px)" : "blur(0px)",
          pointerEvents: expanded ? "none" : "auto",
          transitionDelay: expanded ? "0ms" : "60ms",
        }}
      >
        {LOGO_ICON}
      </span>
      {/* Close icon — spins in from the toolbar direction */}
      <span
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#a1a1aa',
          transition: 'all 300ms ease-in-out',
          opacity: expanded ? 1 : 0,
          transform: expanded ? "scale(1) rotate(0deg)" : `scale(0.5) rotate(${-spinDeg}deg)`,
          filter: expanded ? "blur(0px)" : "blur(4px)",
          pointerEvents: expanded ? "auto" : "none",
          transitionDelay: expanded ? "0ms" : "60ms",
        }}
      >
        {XIcon}
      </span>
    </button>
  );
}

function DoneBtn({ onClick, disabled, capturing, copied, pressed, shake }: { onClick: () => void; disabled: boolean; capturing: boolean; copied: boolean; pressed: boolean; shake?: boolean }) {
  const isDown = pressed && !shake;
  const anim = copied ? "copy-bounce 600ms ease-out" : shake ? "nope-shake 320ms ease-out" : undefined;
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      alignSelf: 'stretch',
      animation: anim,
    }}>
      <WithTooltip label={copied ? "Copied!" : "Copy"} shortcut={copied ? undefined : ["command", "C"]} pressed={pressed} forceShow={copied}>
        <button
          tabIndex={-1}
          data-penseat-btn
          onClick={onClick}
          disabled={disabled && !copied}
          aria-label="Done"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            flexShrink: 0,
            cursor: 'pointer',
            transition: 'all 200ms',
            transform: isDown ? 'scale(0.9)' : undefined,
            border: 'none',
            outline: 'none',
            padding: 0,
            borderRadius: '6px',
            backgroundColor: isDown ? 'rgba(63,63,70,1)' : 'rgba(63,63,70,0)',
            color: isDown ? '#f4f4f5' : '#a1a1aa',
            opacity: (disabled && !copied) ? 0.5 : 1,
          }}
        >
          {capturing ? (
            <span style={{
              width: '12px',
              height: '12px',
              borderRadius: '9999px',
              border: '2px solid rgba(161,161,170,0.3)',
              borderTopColor: '#a1a1aa',
              animation: 'penseat-spin 1s linear infinite',
            }} />
          ) : (
            <span style={{ position: 'relative', width: '16px', height: '16px' }}>
              <span style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 180ms ease-out',
                opacity: copied ? 0 : 1,
                transform: copied ? "scale(0.5)" : "scale(1)",
              }}>{CopyIcon}</span>
              <span style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 180ms ease-out',
                opacity: copied ? 1 : 0,
                transform: copied ? "scale(1)" : "scale(0.5)",
              }}>{CheckIcon}</span>
            </span>
          )}
        </button>
      </WithTooltip>
      {/* Always rendered — these are the shared icon-button hover/active
          effects, not just the transient copy animations */}
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
        @keyframes penseat-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        [data-penseat-btn]:active {
          transform: scale(0.9) !important;
        }
        [data-penseat-btn]:hover {
          background-color: rgba(63,63,70,1) !important;
          color: #f4f4f5 !important;
        }
        [data-penseat="trigger"]:hover {
          background-color: rgba(63,63,70,1) !important;
        }
      `}</style>
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
  tool,
  onToolChange,
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
        else if (e.key === "v") id = "cursor";
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

  // Pen tray — the pen's sub-tools float in their own bar next to the
  // toolbar (above at bottom corners, below at top ones) instead of
  // stretching the toolbar itself. Anchored off the bar's resting edges,
  // which stay fixed while the width animates; hidden mid-drag/flight
  // and re-anchored after the bar lands.
  const barBodyRef = useRef<HTMLDivElement>(null);
  const [trayPos, setTrayPos] = useState<{ [k: string]: number } | null>(null);
  const trayVisible = expanded && tool === "pen" && !isDragging && !isFlying;
  useEffect(() => {
    if (!trayVisible) {
      setTrayPos(null);
      return;
    }
    const r = barBodyRef.current?.getBoundingClientRect();
    if (!r) return;
    const atTop = corner === "lt" || corner === "rt";
    const atRight = corner === "rb" || corner === "rt";
    setTrayPos({
      ...(atTop
        ? { top: r.bottom + 8 }
        : { bottom: window.innerHeight - r.top + 8 }),
      ...(atRight ? { right: window.innerWidth - r.right } : { left: r.left }),
    });
  }, [trayVisible, corner]);


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
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9998,
            pointerEvents: 'none',
            width: '100%',
            height: '100%',
          }}
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

      {/* Pen tray — the pen's sub-tools in their own floating bar */}
      {trayVisible && trayPos && (
        <div
          data-penseat="pen-tray"
          style={{
            position: 'fixed',
            zIndex: 9999,
            ...trayPos,
            display: 'flex',
            alignItems: 'center',
            height: BAR_HEIGHT,
            padding: '0 8px',
            userSelect: 'none',
            borderRadius: '14px',
            backgroundColor: '#18181b',
            border: '1.5px solid rgba(255,255,255,0.25)',
            boxShadow: '0 0 0 0.5px rgba(255,255,255,0.06), 0 1px 3px rgba(0,0,0,0.15), inset 0 0.5px 0 rgba(255,255,255,0.06)',
            animation: 'penseat-tray-in 160ms ease-out',
          }}
        >
          <style>{`@keyframes penseat-tray-in { from { opacity: 0; transform: translateY(${corner === "lt" || corner === "rt" ? -6 : 6}px); } }`}</style>
          <ColorDots colors={COLORS} active={color} onChange={onColorChange} pressedId={pressedId} />
          <UndoBtn onUndo={onUndo} pressedId={pressedId} />
        </div>
      )}

      <div
        data-penseat="bar"
        ref={barBodyRef}
        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") e.preventDefault(); }}
        style={{
          position: 'fixed',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          overflow: 'hidden',
          userSelect: 'none',
          // Full round cap on the anchor end only — the content end squares
          // off (small radius) so the square tool buttons fit un-clipped
          borderRadius: expanded
            ? rightExpand
              ? '22px 14px 14px 22px'
              : '14px 22px 22px 14px'
            : '9999px',
          backgroundColor: '#18181b',
          border: '1.5px solid rgba(255,255,255,0.25)',
          boxShadow: '0 0 0 0.5px rgba(255,255,255,0.06), 0 1px 3px rgba(0,0,0,0.15), inset 0 0.5px 0 rgba(255,255,255,0.06)',
          opacity: isDragging ? 0.8 : 1,
          transform: isDragging ? 'scale(1.05)' : isFlying ? 'scale(0.95)' : undefined,
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
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'stretch',
            alignSelf: 'stretch',
            flexShrink: 0,
            gap: '4px',
            // Tighter on the content's outer (squared) end, roomier on the
            // anchor side — flips with the expand direction
            padding: rightExpand ? '0 5px 0 8px' : '0 8px 0 5px',
            pointerEvents: expanded ? 'auto' : 'none',
          }}
        >
          <ToolBtn icon={PenToolIcon} label="Pen" active={tool === "pen"} onClick={() => onToolChange("pen")} pressed={pressedId === "pen"} />
          <ToolBtn icon={CursorIcon} label="Inspect element" shortcut={["V"]} active={tool === "cursor"} onClick={() => onToolChange("cursor")} pressed={pressedId === "cursor"} />
          <Actions onClear={onClear} pressedId={pressedId} />
          <DoneBtn onClick={onDone} disabled={capturing || !!copied} capturing={capturing} copied={!!copied} pressed={pressedId === "copy"} shake={shake} />
        </div>
      </div>
    </TooltipBelowCtx.Provider>
  );
}
