"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo, createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
// Inline SVG icons (from Lucide) — zero dependencies
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const Undo2Icon = <svg {...iconProps}><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>;
const XIcon = <svg {...iconProps} width={20} height={20}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;
const CopyIcon = <svg {...iconProps}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>;
const CheckIcon = <svg {...iconProps} strokeWidth={3}><path d="M20 6 9 17l-5-5"/></svg>;
const CursorIcon = <svg {...iconProps}><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/></svg>;
const PenToolIcon = <svg {...iconProps}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>;

// First-hover delay. Long enough that sweeping across the bar doesn't sprout
// labels; once one is up, moving between controls swaps it with no wait.
const TOOLTIP_DELAY = 450;
const TOOLTIP_GAP = 6;
// How long the tooltip stays after the pointer leaves a control. Long enough
// that crossing the gap to the next control never closes it (a swap would
// flicker), and that lifting off a button doesn't snap it away
const TOOLTIP_LEAVE = 400;

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

// ── Tooltip host ──
//
// The toolbar shows one tooltip at a time, so it owns one element. Moving
// between controls swaps its content and slides it to the new anchor rather
// than dismissing and re-serving the open delay: the row reads as a single
// surface with a single label, and only the first hover has to wait.

interface TipBox {
  label: string;
  shortcut?: string[];
  x: number;
  top: number;
  bottom: number;
}

const TooltipHostCtx = createContext<{
  request: (key: string, get: () => TipBox | null, pin?: boolean) => void;
  release: (key: string) => void;
  // Gone this instant, no linger — for a control that was just clicked
  dismiss: (key: string) => void;
} | null>(null);

let tipSeq = 0;

// ── Window motion ──
//
// The window is driven by a frame loop, not CSS transitions. A transition
// needs a painted starting frame before it can begin, and it restarts from
// scratch every time the target changes — sweeping across four buttons meant
// four little stops. Exponential smoothing has neither problem: every frame
// closes a fixed fraction of whatever distance remains, so a new target just
// bends the path with no pause and no restart.
//
// The two edges close at different rates. The edge facing the direction of
// travel is quick, the one behind it lazy, so the window stretches toward the
// next label and gathers itself in behind — one motion, not a slide followed
// by a resize. Time constants in ms; ~95% settled after three of them.
const TIP_TAU_LEAD = 45;
const TIP_TAU_TRAIL = 60;

// The label of a tooltip. Absolutely positioned and max-content wide: the
// window is sized *from* it, never *by* it, so its edges are free to move
// independently. Its translate is written by the frame loop.
function TipContent({ label, shortcut, innerRef }: {
  label: string;
  shortcut?: string[];
  innerRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={innerRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 'max-content',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        paddingLeft: '12px',
        paddingTop: '6px',
        paddingBottom: '6px',
        paddingRight: shortcut && shortcut.length > 0 ? '6px' : '12px',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#e4e4e7' }}>{label}</span>
      {shortcut && shortcut.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {shortcut.map((key, i) => (
            <Keycap key={i}>{key}</Keycap>
          ))}
        </div>
      )}
    </div>
  );
}

interface Box { l: number; r: number; t: number; b: number }

function TooltipHost({ children }: { children: ReactNode }) {
  const below = useContext(TooltipBelowCtx);
  const [tip, setTip] = useState<(TipBox & { key: string }) | null>(null);
  // Which control currently wants the tooltip, and which (if any) holds it
  // open regardless of the pointer — the Copy button's "Copied!" flash
  const activeKey = useRef<string | null>(null);
  const pinnedKey = useRef<string | null>(null);
  const shown = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);
  const tipRef = useRef<(TipBox & { key: string }) | null>(null);
  tipRef.current = tip;

  const pillRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // The window's box on screen right now, and where it is headed. Owned by
  // the frame loop; React never writes geometry, so a re-render (a label
  // swap) cannot snap the window to its destination.
  const cur = useRef<Box | null>(null);
  const target = useRef<(Box & { x: number; w: number }) | null>(null);
  const raf = useRef(0);
  const last = useRef(0);

  const apply = useCallback(() => {
    const pill = pillRef.current;
    const inner = innerRef.current;
    const c = cur.current;
    const tg = target.current;
    if (!pill || !inner || !c || !tg) return;
    pill.style.left = `${c.l}px`;
    pill.style.top = `${c.t}px`;
    pill.style.width = `${c.r - c.l}px`;
    pill.style.height = `${c.b - c.t}px`;
    // The label holds still at its destination: it cancels whatever the
    // window's left and top edges are doing, so only the window moves and
    // the label is uncovered rather than carried
    inner.style.translate = `${tg.x - c.l - tg.w / 2}px ${tg.t - c.t}px`;
  }, []);

  const step = useCallback((now: number) => {
    const c = cur.current;
    const tg = target.current;
    if (!c || !tg) {
      raf.current = 0;
      return;
    }
    // Frame-rate independent: the fraction closed per frame depends on the
    // time the frame actually took (capped so a stalled tab can't teleport)
    const dt = Math.min(64, now - (last.current || now));
    last.current = now;
    const kLead = 1 - Math.exp(-dt / TIP_TAU_LEAD);
    const kTrail = 1 - Math.exp(-dt / TIP_TAU_TRAIL);
    // Which edge leads is re-read every frame, so a reversal mid-flight
    // hands the lead to the other edge instead of fighting it
    const rightward = tg.l + tg.r >= c.l + c.r;
    const downward = tg.t + tg.b >= c.t + c.b;
    c.l += (tg.l - c.l) * (rightward ? kTrail : kLead);
    c.r += (tg.r - c.r) * (rightward ? kLead : kTrail);
    c.t += (tg.t - c.t) * (downward ? kTrail : kLead);
    c.b += (tg.b - c.b) * (downward ? kLead : kTrail);
    const settled =
      Math.abs(tg.l - c.l) < 0.05 &&
      Math.abs(tg.r - c.r) < 0.05 &&
      Math.abs(tg.t - c.t) < 0.05 &&
      Math.abs(tg.b - c.b) < 0.05;
    if (settled) {
      c.l = tg.l;
      c.r = tg.r;
      c.t = tg.t;
      c.b = tg.b;
    }
    apply();
    raf.current = settled ? 0 : requestAnimationFrame(step);
  }, [apply]);

  // After every render: measure the label as it is now, retarget, and make
  // sure the loop is running. Layout effect, so the first placement happens
  // before the window is ever painted.
  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!tip || !inner) {
      cur.current = null;
      target.current = null;
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
      return;
    }
    const w = inner.offsetWidth;
    const h = inner.offsetHeight;
    const t = below ? tip.bottom + TOOLTIP_GAP : tip.top - TOOLTIP_GAP - h;
    target.current = { l: tip.x - w / 2, r: tip.x + w / 2, t, b: t + h, x: tip.x, w };
    if (!cur.current) {
      // First appearance — nothing to travel from
      cur.current = { l: tip.x - w / 2, r: tip.x + w / 2, t, b: t + h };
      apply();
      return;
    }
    // Pin the new label to its destination this very frame; the window
    // catches up over the following ones
    apply();
    if (!raf.current) {
      last.current = 0;
      raf.current = requestAnimationFrame(step);
    }
  });

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
  }, []);

  const put = useCallback((key: string, box: TipBox) => {
    const prev = tipRef.current;
    // Identical request: leave the object alone so a forceShow effect
    // re-running on every render cannot loop
    if (prev && prev.key === key && prev.label === box.label && prev.x === box.x && prev.top === box.top)
      return;
    shown.current = true;
    setTip({ key, ...box });
  }, []);

  const request = useCallback(
    (key: string, get: () => TipBox | null, pin = false) => {
      if (pinnedKey.current && pinnedKey.current !== key) return;
      if (pin) pinnedKey.current = key;
      activeKey.current = key;
      if (timer.current) clearTimeout(timer.current);
      // Warm (already on screen) or pinned: swap in place. Cold: serve delay.
      if (shown.current || pin) {
        const box = get();
        if (box) put(key, box);
        return;
      }
      timer.current = setTimeout(() => {
        if (activeKey.current !== key) return;
        const box = get();
        if (box) put(key, box);
      }, TOOLTIP_DELAY);
    },
    [put]
  );

  const release = useCallback((key: string) => {
    if (pinnedKey.current === key) pinnedKey.current = null;
    if (activeKey.current !== key) return;
    activeKey.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (activeKey.current !== null) return;
      shown.current = false;
      setTip(null);
    }, TOOLTIP_LEAVE);
  }, []);

  const dismiss = useCallback((key: string) => {
    if (pinnedKey.current && pinnedKey.current !== key) return;
    if (activeKey.current !== key) return;
    activeKey.current = null;
    if (timer.current) clearTimeout(timer.current);
    shown.current = false;
    setTip(null);
  }, []);

  const api = useMemo(() => ({ request, release, dismiss }), [request, release, dismiss]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <TooltipHostCtx.Provider value={api}>
      {children}
      {tip && createPortal(
        <div
          ref={pillRef}
          data-penseat="tooltip"
          // Geometry (left/top/width/height) is deliberately absent here —
          // the frame loop owns it
          style={{
            position: 'fixed',
            zIndex: 99999,
            pointerEvents: 'none',
            animation: below ? "tooltip-in-below 150ms ease-out" : "tooltip-in-above 150ms ease-out",
            borderRadius: '8px',
            backgroundColor: '#18181b',
            // What makes it a window rather than a moving card
            overflow: 'hidden',
          }}
        >
          <TipContent label={tip.label} shortcut={tip.shortcut} innerRef={innerRef} />
          <style>{`
            @keyframes tooltip-in-above { from { opacity: 0; translate: 0 4px; } }
            @keyframes tooltip-in-below { from { opacity: 0; translate: 0 -4px; } }
          `}</style>
        </div>,
        document.body
      )}
    </TooltipHostCtx.Provider>
  );
}

function WithTooltip({ label, shortcut, children, pressed, forceShow, hug }: {
  label: string;
  shortcut?: string[];
  children: ReactNode;
  pressed?: boolean;
  forceShow?: boolean;
  // Wrap the child tightly instead of stretching to the row — for things
  // that anchor the tooltip to themselves (pen sticks in the well)
  hug?: boolean;
}) {
  const host = useContext(TooltipHostCtx);
  const wrapRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string>("");
  if (!idRef.current) idRef.current = `tip-${++tipSeq}`;
  // A click ends the tooltip's job: it explained the control, the control
  // has been used. Hidden on pointerdown and kept hidden while the pointer
  // stays on this control; leaving and coming back starts over.
  const clicked = useRef(false);

  // Latest label/shortcut for the deferred read — the host calls this when it
  // actually shows, so the anchor is measured then and not at hover time
  const contentRef = useRef({ label, shortcut });
  contentRef.current = { label, shortcut };

  const measure = useCallback((): TipBox | null => {
    const el = wrapRef.current;
    if (!el) return null;
    // A hugged child may have lifted itself (a hovered or chosen pen stick
    // rides up by a few px on its own translate) — anchor to where it is,
    // not to the wrapper it left behind
    const rect = (hug && el.firstElementChild ? el.firstElementChild : el).getBoundingClientRect();
    // Clear the whole bar/tray, not just the control that was hovered.
    // Controls sit at different insets inside the same 44px surface — tool
    // buttons are 32px (6px in), colour dots 20px (12px in) — so anchoring
    // to the control put the dot's tooltip 2px inside the tray while the
    // button's cleared it by 4. Anchoring to the surface gives every
    // tooltip the same gap, and x still centres on the control itself.
    // Pen sticks rise above their tray, so they anchor to themselves
    const surface = el.closest('[data-penseat="bar"]');
    const box = surface ? surface.getBoundingClientRect() : rect;
    return {
      ...contentRef.current,
      x: rect.left + rect.width / 2,
      top: box.top,
      bottom: box.bottom,
    };
  }, [hug]);

  const shortcutKey = shortcut?.join(",");
  useEffect(() => {
    if (!host) return;
    if (forceShow) host.request(idRef.current, measure, true);
    else host.release(idRef.current);
  }, [forceShow, label, shortcutKey, host, measure]);

  return (
    <div
      ref={wrapRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        alignSelf: hug ? 'flex-end' : 'stretch',
        transition: 'transform 100ms',
        transform: pressed ? 'scale(0.95)' : undefined,
      }}
      onPointerEnter={() => { if (!clicked.current) host?.request(idRef.current, measure); }}
      onPointerDown={() => {
        clicked.current = true;
        if (!forceShow) host?.dismiss(idRef.current);
      }}
      onPointerLeave={() => {
        clicked.current = false;
        if (!forceShow) host?.release(idRef.current);
      }}
    >
      {children}
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
// Tool button geometry — the bar's squared end is derived from it below
const TOOL_SIZE = 32;
const TOOL_R = 6;
// Radius on the squared-off (content) end. Concentric with the tool buttons
// rather than as tight as possible: the buttons sit (BAR_HEIGHT - TOOL_SIZE)/2
// in from the edge, so matching their corner plus that gap makes the outer and
// inner arcs share a center. Anything tighter than TOOL_R reads as broken —
// the shell corner cuts inside the corner it is wrapping.
const SQUARE_R = TOOL_R + (BAR_HEIGHT - TOOL_SIZE) / 2;
// Pen sticks: a marker body standing in the tray, writing end down, cap end
// showing. The tray's front lip hides the lower part; what you see is the
// top of each pen, and the chosen one stands a little taller.
const PEN_W = 14;
const PEN_H = 44;
const PEN_LIFT_HOVER = 3;
const PEN_LIFT_ACTIVE = 9;
// How far a pen sinks behind the bar when the rack is closed. Its bottom
// rests on the bar's centre line, so sinking by half the bar's height puts
// the whole pen exactly behind the bar — no cap above the rim, no tip
// poking out underneath. (Any more and the tip shows below the bar.)
const PEN_SUNK = BAR_HEIGHT / 2;
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


// The palette is a rack of pens standing in the bar itself. The bar is the
// holder: the pens' lower halves sit behind it (one layer down), and only
// the cap ends show above the rim. Press the pen tool and they rise out one
// after another; pick another tool and they sink back the same way.
const RACK_GAP = 8;
const PEN_IN_MS = 200;
const PEN_STAGGER_MS = 35;

// "out" is the staggered sink for switching tools. "out-all" is for the bar
// closing: the pens go in together, at normal speed, and the bar folds once
// they are in. "out-fast" is for the bar being picked up and thrown — no
// time for ceremony, they drop at once and quickly.
type DrawerPhase = "in" | "out" | "out-all" | "out-fast";
const PEN_OUT_FAST_MS = 110;
// Total length of the staggered sink — last pen's delay plus its travel
const PEN_SINK_MS = PEN_STAGGER_MS * (COLORS.length - 1) + PEN_IN_MS + 30;
// The all-together sink on close is quicker than a single pen's travel —
// five things moving as one read slower than one thing moving
const PEN_OUT_ALL_MS = 120;
const PEN_SINK_ALL_MS = PEN_OUT_ALL_MS + 30;

// One marker. Colour is the body; a dark ring marks the cap, a light line
// the highlight. The eraser is a pale block instead.
function PenStick({ color, eraser, active, onClick, pressed, index, phase, count }: {
  color: string;
  eraser?: boolean;
  active: boolean;
  onClick: () => void;
  pressed: boolean;
  index: number;
  phase: DrawerPhase;
  count: number;
}) {
  const [hovered, setHovered] = useState(false);
  const out = phase !== "in";
  const lift = active ? PEN_LIFT_ACTIVE : hovered ? PEN_LIFT_HOVER : 0;
  return (
    <div
      onClick={onClick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        width: eraser ? PEN_W + 6 : PEN_W,
        height: PEN_H,
        flexShrink: 0,
        cursor: 'pointer',
        // Resting height; the keyframes sink it into the tray at either end
        translate: `0 ${-lift}px`,
        transition: 'translate 160ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        transform: pressed ? 'scale(0.94)' : undefined,
        animation:
          phase === "out-fast"
            ? `penseat-pen-out ${PEN_OUT_FAST_MS}ms cubic-bezier(0.4, 0, 1, 1) 0ms both`
            : phase === "out-all"
              ? `penseat-pen-out ${PEN_OUT_ALL_MS}ms cubic-bezier(0.4, 0, 0.8, 0.4) 0ms both`
              : out
                ? `penseat-pen-out ${PEN_IN_MS}ms cubic-bezier(0.4, 0, 0.8, 0.4) ${(count - 1 - index) * PEN_STAGGER_MS}ms both`
                : `penseat-pen-in ${PEN_IN_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1) ${index * PEN_STAGGER_MS}ms both`,
      }}
    >
      {eraser ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '4px 4px 3px 3px',
            backgroundColor: '#e4e4e7',
            // The sleeve
            backgroundImage: 'linear-gradient(#a1a1aa, #a1a1aa)',
            backgroundSize: '100% 10px',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: '0 14px',
            boxShadow: 'inset 2px 0 0 rgba(255,255,255,0.5)',
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '5px 5px 2px 2px',
            backgroundColor: color,
            // Cap ring 9px from the top, highlight down the left
            backgroundImage: 'linear-gradient(rgba(0,0,0,0.38), rgba(0,0,0,0.38))',
            backgroundSize: '100% 3px',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: '0 9px',
            boxShadow: 'inset 2px 0 0 rgba(255,255,255,0.35), inset -1px 0 0 rgba(0,0,0,0.18)',
          }}
        />
      )}
    </div>
  );
}

function ColorDots({ colors, active, onChange, pressedId, dirX, flip, phase }: {
  colors: typeof COLORS;
  active: string;
  onChange: (c: string) => void;
  pressedId: string | null;
  // Which way the rack runs from the pen button (along the bar's contents)
  dirX: 1 | -1;
  // Bar at a top corner: the rack hangs below it instead
  flip: boolean;
  phase: DrawerPhase;
}) {
  return (
    <>
      <style>{`
        @keyframes penseat-pen-in  { from { translate: 0 ${PEN_SUNK}px; } }
        @keyframes penseat-pen-out { to   { translate: 0 ${PEN_SUNK}px; } }
      `}</style>
      <div
        data-penseat="pen-tray"
        style={{
          position: 'absolute',
          // Pens stand with their bottoms at the bar's centre line, so
          // everything below the rim is behind the bar
          top: -PEN_H,
          height: PEN_H,
          ...(dirX > 0 ? { left: -TOOL_SIZE / 2 } : { right: -TOOL_SIZE / 2 }),
          display: 'flex',
          flexDirection: dirX > 0 ? 'row' : 'row-reverse',
          alignItems: 'flex-end',
          gap: RACK_GAP,
          // A bar hugging the top edge holds the rack upside down beneath it
          transform: flip ? 'scaleY(-1)' : undefined,
          transformOrigin: '50% 100%',
        }}
      >
        {colors.map((c, i) => (
          <WithTooltip
            key={c.value}
            hug
            label={c.name}
            shortcut={c.name === "Eraser" ? ["E"] : [String(i + 1)]}
            pressed={pressedId === (c.name === "Eraser" ? "eraser" : `color-${i + 1}`)}
          >
            <PenStick
              color={c.value}
              eraser={c.name === "Eraser"}
              active={active === c.value}
              onClick={() => onChange(c.value)}
              pressed={pressedId === (c.name === "Eraser" ? "eraser" : `color-${i + 1}`)}
              index={i}
              count={colors.length}
              phase={phase}
            />
          </WithTooltip>
        ))}
      </div>
    </>
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
        width: `${TOOL_SIZE}px`,
        height: `${TOOL_SIZE}px`,
        flexShrink: 0,
        cursor: 'pointer',
        transition: 'all 150ms',
        transform: pressed ? 'scale(0.9)' : undefined,
        color: pressed ? '#f4f4f5' : '#a1a1aa',
        backgroundColor: pressed ? 'rgba(63,63,70,1)' : 'rgba(63,63,70,0)',
        border: 'none',
        outline: 'none',
        borderRadius: `${TOOL_R}px`,
        padding: 0,
      }}
    >
      {icon}
    </button>
  );
}

// Tap = undo one stroke. Hold = a fill rises from the bottom of the button
// over HOLD_CLEAR_MS; when it reaches the top, everything is cleared. Let go
// early and it drains back — nothing happens. Clear-all is "undo, all the
// way", so it lives on the undo button rather than getting one of its own.
const HOLD_CLEAR_MS = 2000;
// A tap must not flash the fill — it only starts showing after this
const HOLD_ARM_MS = 150;

function Actions({ onUndo, onClear, pressedId }: { onUndo: () => void; onClear: () => void; pressedId: string | null }) {
  const fillRef = useRef<HTMLSpanElement>(null);
  const raf = useRef(0);
  const startAt = useRef(0);
  // Set when the hold ran to completion, so the click that fires on release
  // doesn't undo on top of the clear
  const cleared = useRef(false);

  const setFill = (frac: number, animate: boolean) => {
    const el = fillRef.current;
    if (!el) return;
    el.style.transition = animate ? "height 160ms ease-out" : "none";
    el.style.height = `${Math.round(frac * 100)}%`;
  };
  const stop = (drain = true) => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    if (drain) setFill(0, true);
  };
  const tick = () => {
    const held = performance.now() - startAt.current;
    const frac = Math.min(1, Math.max(0, (held - HOLD_ARM_MS) / (HOLD_CLEAR_MS - HOLD_ARM_MS)));
    setFill(frac, false);
    if (frac >= 1) {
      cleared.current = true;
      onClear();
      // Full for a beat, then drain — the fill is the receipt
      raf.current = 0;
      setTimeout(() => setFill(0, true), 120);
      return;
    }
    raf.current = requestAnimationFrame(tick);
  };
  const startHold = () => {
    stop(false);
    cleared.current = false;
    startAt.current = performance.now();
    raf.current = requestAnimationFrame(tick);
  };
  // The shortcut holds too: ⌘Z kept down fills the button the same way and
  // clears at the top. Key repeat keeps undoing strokes underneath (the
  // canvas handles that); this only tracks the physical press.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "z" || e.repeat) return;
      startHold();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "z" || e.key === "Meta" || e.key === "Control") stop();
    };
    const cancel = () => stop();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", cancel);
      stop(false);
    };
    // startHold/stop close over stable refs and props read at call time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClear]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '0 4px',
      opacity: 1,
    }}>
      <WithTooltip label="Undo" shortcut={["command", "Z"]} pressed={pressedId === "undo"}>
        <span
          onPointerDown={startHold}
          onPointerUp={() => stop()}
          onPointerLeave={() => stop()}
          onPointerCancel={() => stop()}
          style={{
            position: 'relative',
            display: 'inline-flex',
            borderRadius: `${TOOL_R}px`,
            overflow: 'hidden',
          }}
        >
          {/* The rising fill — sits behind the icon, clipped to the button */}
          <span
            ref={fillRef}
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '0%',
              backgroundColor: 'rgba(244,244,245,0.22)',
              pointerEvents: 'none',
            }}
          />
          <ActionButton
            icon={Undo2Icon}
            ariaLabel="Undo"
            onClick={() => {
              if (cleared.current) return;
              onUndo();
            }}
            pressed={pressedId === "undo"}
          />
        </span>
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
  expanded: expandedProp,
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
  // What the bar shows, as opposed to what it was told. Opening follows the
  // prop at once; closing can lag behind it while the pens sink (see below).
  const [expanded, setExpanded] = useState(expandedProp);
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
      // One blink per physical press. A held key auto-repeats keydown, and
      // re-flashing on every repeat kept the button in its pressed look for
      // as long as the key was down — which, on a button whose *hold* means
      // "clear everything", read as exactly that. The action itself still
      // repeats (the canvas handles the key); only the flash is one-shot.
      if (e.repeat) return;
      let id: string | null = null;
      const isMeta = e.metaKey || e.ctrlKey;

      if (!isMeta && !e.shiftKey) {
        if (["1", "2", "3", "4"].includes(e.key)) id = `color-${e.key}`;
        else if (e.key === "e" || e.key === "5") id = "eraser";
        else if (e.key === "x") id = "clear";
        else if (e.key === "v") id = "cursor";
        else if (e.key === "b") id = "pen";
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
  // The rack rises out of the bar beside the pen button — this is the pen's
  // centre. Kept through the sink, so it has somewhere to sink into.
  const [trayPos, setTrayPos] = useState<{ x: number; y: number } | null>(null);
  // The rack answers to the prop directly: on close it starts sinking at once
  const trayVisible = expandedProp && tool === "pen" && !isDragging && !isFlying;
  // Mounted while sliding either way; unmounted once it has slid back in
  const [trayPhase, setTrayPhase] = useState<DrawerPhase | null>(null);
  useEffect(() => {
    if (trayVisible) {
      setTrayPhase("in");
      return;
    }
    // Tool switch: one by one. Bar closing: all together, then the bar
    // folds. Bar picked up and thrown: all at once and quick — the holder
    // is in motion, there is nothing to sink into gracefully.
    const next: DrawerPhase = isDragging || isFlying ? "out-fast" : !expandedProp ? "out-all" : "out";
    setTrayPhase((p) => (p ? next : null));
    const id = setTimeout(
      () => setTrayPhase(null),
      next === "out-fast" ? PEN_OUT_FAST_MS + 20 : next === "out-all" ? PEN_SINK_ALL_MS : PEN_SINK_MS
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trayVisible]);

  // What the bar itself shows. Opening follows the prop immediately. Closing
  // waits for the pens if they are out: they sink into the bar together, and
  // only then does the bar fold — a bar that shrank away first would leave
  // the pens sinking into thin air.
  const foldTimer = useRef<ReturnType<typeof setTimeout>>(null);
  useEffect(() => {
    if (foldTimer.current) clearTimeout(foldTimer.current);
    foldTimer.current = null;
    if (expandedProp) {
      setExpanded(true);
      return;
    }
    const pensOut = trayPhase === "in" && !isDragging && !isFlying;
    if (!pensOut) {
      setExpanded(false);
      return;
    }
    foldTimer.current = setTimeout(() => setExpanded(false), PEN_SINK_ALL_MS);
    return () => {
      if (foldTimer.current) clearTimeout(foldTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedProp]);
  useEffect(() => {
    if (!trayVisible) return;
    const bar = barBodyRef.current;
    if (!bar) return;
    const place = () => {
      const pen = bar.querySelector('[aria-label="Pen"]');
      const r = (pen ?? bar).getBoundingClientRect();
      setTrayPos({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    };
    place();
    // The bar's width is still settling if the pen was already the tool
    // when it expanded — re-centre once that transition lands
    bar.addEventListener("transitionend", place);
    return () => bar.removeEventListener("transitionend", place);
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
      <TooltipHost>
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

      {/* Pen rack — the pen tool's colours stand in the bar and rise out of
          it, one after another, when the pen is the tool */}
      {trayPhase && trayPos && (
        <div
          data-penseat="pen-tray-anchor"
          style={{
            position: 'fixed',
            // Under the bar: the bar is the holder, the pens' lower halves
            // sit behind it
            zIndex: 9998,
            left: trayPos.x,
            top: trayPos.y,
            width: 0,
            height: 0,
            userSelect: 'none',
          }}
        >
          <ColorDots
            colors={COLORS}
            active={color}
            onChange={onColorChange}
            pressedId={pressedId}
            phase={trayPhase}
            // Along the bar's contents: away from the pen, toward the anchor
            dirX={corner === "rb" || corner === "rt" ? 1 : -1}
            flip={corner === "lt" || corner === "rt"}
          />
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
          // Round cap on the anchor end, squared off at the content end —
          // the anchor is a circular icon, the tool buttons are squares.
          //
          // Half the height, not a 9999px sentinel or a 50% percentage:
          //
          // transitionProperty is "all", so border-radius rides the expand
          // curve, and that curve overshoots (y2 = 1.12). Overshoot scales with
          // the interpolation span, so a ~10000px span carried the radius
          // hundreds of px past its target; clamped at 0 the corners went square
          // mid-expand and then rounded back. An 8px span keeps it subpixel.
          //
          // A literal 50% resolves per axis — half the *width* horizontally — so
          // on a bar that animates from 44px to ~250px wide the cap would sweep
          // out into an ellipse. BAR_HEIGHT / 2 is the semicircle it should be.
          borderRadius: expanded
            ? rightExpand
              ? `${BAR_HEIGHT / 2}px ${SQUARE_R}px ${SQUARE_R}px ${BAR_HEIGHT / 2}px`
              : `${SQUARE_R}px ${BAR_HEIGHT / 2}px ${BAR_HEIGHT / 2}px ${SQUARE_R}px`
            : `${BAR_HEIGHT / 2}px`,
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
          <ToolBtn icon={PenToolIcon} label="Pen" shortcut={["B"]} active={tool === "pen"} onClick={() => onToolChange("pen")} pressed={pressedId === "pen"} />
          <ToolBtn icon={CursorIcon} label="Inspect element" shortcut={["V"]} active={tool === "cursor"} onClick={() => onToolChange("cursor")} pressed={pressedId === "cursor"} />
          <Actions onUndo={onUndo} onClear={onClear} pressedId={pressedId} />
          <DoneBtn onClick={onDone} disabled={capturing || !!copied} capturing={capturing} copied={!!copied} pressed={pressedId === "copy"} shake={shake} />
        </div>
      </div>
      </TooltipHost>
    </TooltipBelowCtx.Provider>
  );
}
