"use client";

import { useState, useEffect } from "react";

export interface GrabbedElement {
  id: number;
  // Document coordinates — the outline scrolls with the page
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  size: string;
  motion: string[];
  // Nearest named React component — source-level context for the prompt
  component: string | null;
  // Live reference for the motion player (play/scrub/onion-skin)
  el: Element;
  // Animated descendants exist → the grab box gets a layers button
  innerMotion: boolean;
}

interface ElementInspectorProps {
  picking: boolean;
  grabs: GrabbedElement[];
  // additive = shift+click: add to the selection instead of replacing it
  onGrab: (grab: GrabbedElement, additive: boolean) => void;
  onRemove: (id: number) => void;
  // Collapse a multi-selection to just this grab (plain click on a grabbed element)
  onSolo: (id: number) => void;
  // A transition was recorded on this grab — open the motion player for it
  onRecord: (grab: GrabbedElement) => void;
  // Recording armed/disarmed — every Penseat surface must step aside so
  // the user's own cursor can reach the page and trigger the motion
  onArmingChange: (armed: boolean) => void;
}

// ── Transition recording ──
//
// CSS transitions exist only while running, so the player normally can't
// study them. Recording arms a listener on the grab: when the user
// triggers the transition (hover, focus…), its keyframes and timing are
// snapshotted into detached WAAPI animations Penseat owns — those replay,
// scrub, and onion-skin like any animation.

const RECORDED = new Map<Element, Animation[]>();

export function cancelRecorded(el: Element) {
  for (const a of RECORDED.get(el) ?? []) {
    try {
      a.cancel();
    } catch {}
  }
  RECORDED.delete(el);
}

export function recordedElements(): Element[] {
  return [...RECORDED.keys()];
}

// Record targets: declared CSS transitions, or declared JS-driven motion
// (Framer Motion intent) the sampler can capture
const hasTransitions = (g: GrabbedElement) =>
  g.motion.some((m) => m.startsWith("transition:") || m.startsWith("motion"));

const GRAB_COLOR = "#0ea5e9";
const PAD = 3; // outline breathing room around the element

// ── Motion detection ──

// Split a computed-style list on top-level commas only —
// easing functions like cubic-bezier(0.4, 0, 0.2, 1) contain commas
function splitList(value: string): string[] {
  return value.split(/,\s*(?![^()]*\))/);
}

// Computed durations are in seconds ("0.15s") — print compact
function fmtDur(value: string): string {
  const s = parseFloat(value);
  if (!s) return "0s";
  return s >= 1 ? `${+s.toFixed(2)}s` : `${Math.round(s * 1000)}ms`;
}

// What time-based motion does this element have?
// Sources: declared CSS transitions, declared CSS animations, and any
// live Web Animations API animations not driven by CSS.
function describeMotion(el: Element): string[] {
  const cs = getComputedStyle(el);
  const lines: string[] = [];

  const tProps = splitList(cs.transitionProperty);
  const tDurs = splitList(cs.transitionDuration);
  const tDelays = splitList(cs.transitionDelay);
  const tEases = splitList(cs.transitionTimingFunction);
  // Group properties sharing the same timing — Tailwind's transition-colors
  // alone expands to ~10 longhands with identical duration/easing
  const groups = new Map<string, string[]>();
  for (let i = 0; i < tProps.length; i++) {
    const prop = tProps[i];
    if (prop === "none" || prop.startsWith("--")) continue;
    const dur = parseFloat(tDurs[i % tDurs.length]);
    const delay = parseFloat(tDelays[i % tDelays.length]);
    if (!dur && !delay) continue;
    const ease = tEases[i % tEases.length];
    const timing = [
      fmtDur(tDurs[i % tDurs.length]),
      delay ? `+${fmtDur(tDelays[i % tDelays.length])}` : "",
      // Compact the easing — beziers lose their inner spaces
      ease === "ease" ? "" : ease.replace(/\s+/g, ""),
    ]
      .filter(Boolean)
      .join(" ");
    groups.set(timing, [...(groups.get(timing) ?? []), prop]);
  }
  for (const [timing, props] of groups) {
    // One representative property + a count — Tailwind's transition-transform
    // alone expands to 4 longhands and the full list just reads as noise
    const propList =
      props.length > 2 ? `${props[0]} +${props.length - 1}` : props.join(", ");
    lines.push(`transition: ${propList} · ${timing}`);
  }

  const aNames = splitList(cs.animationName);
  if (aNames[0] !== "none") {
    const aDurs = splitList(cs.animationDuration);
    const aEases = splitList(cs.animationTimingFunction);
    const aIters = splitList(cs.animationIterationCount);
    const animations = aNames.map((name, i) => {
      const iter = aIters[i % aIters.length];
      return [
        name,
        fmtDur(aDurs[i % aDurs.length]),
        aEases[i % aEases.length] === "ease" ? "" : aEases[i % aEases.length],
        `×${iter === "infinite" ? "∞" : iter}`,
      ]
        .filter(Boolean)
        .join(" ");
    });
    lines.push(`animation: ${animations.join(", ")}`);
  }

  try {
    for (const anim of el.getAnimations()) {
      if (anim.constructor.name !== "Animation") continue; // CSS ones covered above
      const timing = anim.effect?.getTiming();
      const dur = typeof timing?.duration === "number" ? `${timing.duration}ms` : "?";
      lines.push(`WAAPI: ${dur} ${timing?.easing ?? ""} (${anim.playState})`.trim());
    }
  } catch {}

  // Declared motion config (Framer Motion) — visible even when the
  // animation itself runs on a JS loop the platform can't expose
  lines.push(...describeMotionIntent(el));

  // Motion often lives on small descendants, not the wrapper you grab
  try {
    const inside =
      el.getAnimations({ subtree: true }).length - el.getAnimations().length;
    if (inside > 0)
      lines.push(`${inside} animated layer${inside === 1 ? "" : "s"} inside`);
  } catch {}

  return lines;
}

// End-weighted start…end truncation — the tail usually carries the
// distinguishing part (animate-bounce vs animate-pulse)
export function midTruncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.max(3, Math.floor((max - 1) * 0.4));
  const tail = max - 1 - head;
  return s.slice(0, head) + "…" + s.slice(s.length - tail);
}

// ── React fiber introspection ──
//
// React hangs a fiber pointer off every host DOM node. Walking it upward
// reveals (a) the nearest named app component — source-level context an
// LLM can actually act on — and (b) declarative motion config (Framer
// Motion props), the ground truth behind JS-driven animation that
// getAnimations() can't see.

/* eslint-disable @typescript-eslint/no-explicit-any */
function getFiber(el: Element): any {
  for (const k of Object.keys(el)) {
    if (k.startsWith("__reactFiber$")) return (el as any)[k];
  }
  return null;
}

function fiberTypeName(t: any): string | null {
  if (!t) return null;
  if (typeof t === "function") return t.displayName || t.name || null;
  if (typeof t === "object") {
    // Only unwrap real component wrappers — providers/contexts also
    // carry displayNames (LayoutRouterContext) but aren't components
    if (t.$$typeof === Symbol.for("react.forward_ref"))
      return t.displayName || fiberTypeName(t.render);
    if (t.$$typeof === Symbol.for("react.memo"))
      return t.displayName || fiberTypeName(t.type);
    return null;
  }
  return null;
}

// Library internals and wrappers that aren't the name the user wrote:
// React built-ins, Framer Motion internals, and Next.js router plumbing
// (server-rendered content has no client ancestor, so the walk would
// otherwise surface framework wrappers like SegmentViewNode)
const GENERIC_COMPONENTS = new Set([
  "Fragment", "Suspense", "ForwardRef", "Memo", "Provider", "Consumer",
  "MotionComponent", "MotionDOMComponent", "AnimatePresence", "PresenceChild",
  "LayoutGroup", "MotionConfig", "InnerLayoutGroup", "PopChild",
  "SegmentViewNode", "SegmentViewStateNode", "OuterLayoutRouter",
  "InnerLayoutRouter", "RedirectBoundary", "RedirectErrorBoundary",
  "NotFoundBoundary", "NotFoundErrorBoundary", "LoadingBoundary",
  "ErrorBoundary", "ErrorBoundaryHandler", "ScrollAndFocusHandler",
  "RenderFromTemplateContext", "MetadataBoundary", "ViewportBoundary",
  "HTTPAccessFallbackBoundary", "HTTPAccessFallbackErrorBoundary",
  "AppRouter", "Router", "Head", "TemplateContext", "DevRootHTTPAccessFallbackBoundary",
  "ClientPageRoot", "ClientSegmentRoot", "HotReload", "ReactDevOverlay", "AppDevOverlay",
]);

const isAppComponentName = (name: string | null): name is string =>
  !!name && /^[A-Z][A-Za-z0-9_]*$/.test(name) && !GENERIC_COMPONENTS.has(name);

export function componentNameFor(el: Element): string | null {
  const fiber = getFiber(el);
  // Dev builds record the JSX owner — literally "whose source renders
  // this element". Client owners are fibers (chained by _debugOwner);
  // React 19 server components appear as ComponentInfo objects with a
  // plain name (chained by .owner). This skips framework wrappers that
  // merely sit between the element and the code that wrote it.
  let owner = fiber?._debugOwner;
  for (let depth = 0; owner && depth < 12; depth++) {
    const name =
      typeof owner.name === "string" ? owner.name : fiberTypeName(owner.type);
    if (isAppComponentName(name)) return name;
    owner = owner._debugOwner ?? owner.owner;
  }
  // Fallback (no owner info): nearest named component up the fiber tree
  let f = fiber?.return;
  for (let depth = 0; f && depth < 24; f = f.return, depth++) {
    if (typeof f.type === "string") continue; // host elements
    const name = fiberTypeName(f.type);
    if (isAppComponentName(name)) return name;
  }
  return null;
}

// Framer Motion's config is declarative props on the motion component
// that renders this host node — a couple of fiber levels up at most
const MOTION_TARGET_KEYS = [
  "animate", "whileHover", "whileTap", "whileInView", "whileFocus",
  "whileDrag", "exit", "variants",
] as const;

function motionPropsFor(el: Element): Record<string, any> | null {
  let f = getFiber(el);
  for (let depth = 0; f && depth < 4; f = f.return, depth++) {
    if (typeof f.type === "string") continue;
    const p = f.memoizedProps;
    if (p && typeof p === "object" && MOTION_TARGET_KEYS.some((k) => k in p))
      return p;
  }
  return null;
}

// ── Declared-intent playback ──
//
// Framer Motion runs transform keyframe sequences on its own rAF loop — it
// composes x/rotate/scale into one transform string per frame and writes it
// inline — so getAnimations() comes back empty and the player has nothing to
// drive. The declared config is already on the fiber, though: exact values,
// no sampling. Rebuilding it as a real WAAPI animation is both cheaper and
// more faithful than recording what the loop happens to paint.
//
// Springs are left to the recorder — they have no authored duration to lay a
// timeline over, so what actually happened on screen is the better source.

// Motion applies transforms in a fixed order; the composed string has to
// match it or the same values read as a different pose
const TRANSFORM_ORDER = [
  "x", "y", "z", "translateX", "translateY", "translateZ",
  "scale", "scaleX", "scaleY",
  "rotate", "rotateX", "rotateY", "rotateZ", "skewX", "skewY",
];
const TRANSFORM_FN: Record<string, string> = {
  x: "translateX", y: "translateY", z: "translateZ",
};
const TRANSFORM_UNIT: Record<string, string> = {
  x: "px", y: "px", z: "px",
  translateX: "px", translateY: "px", translateZ: "px",
  rotate: "deg", rotateX: "deg", rotateY: "deg", rotateZ: "deg",
  skewX: "deg", skewY: "deg",
};

const EASE_CSS: Record<string, string> = {
  linear: "linear",
  easeIn: "ease-in", easeOut: "ease-out", easeInOut: "ease-in-out",
  circIn: "cubic-bezier(0.55, 0, 1, 0.45)",
  circOut: "cubic-bezier(0, 0.55, 0.45, 1)",
  circInOut: "cubic-bezier(0.85, 0, 0.15, 1)",
  backIn: "cubic-bezier(0.36, 0, 0.66, -0.56)",
  backOut: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  backInOut: "cubic-bezier(0.68, -0.6, 0.32, 1.6)",
  anticipate: "cubic-bezier(0.36, 0, 0.66, -0.56)",
};

function cssEase(ease: any): string {
  if (Array.isArray(ease) && ease.length === 4 && ease.every((n) => typeof n === "number"))
    return `cubic-bezier(${ease.join(", ")})`;
  if (typeof ease === "string" && EASE_CSS[ease]) return EASE_CSS[ease];
  // Motion's default for a keyframe array
  return "ease-in-out";
}

// Motion runs a single `ease` between each pair of keyframes, not once across
// the whole cycle. Easing the effect instead would trace the same path at the
// wrong pace — with x: [0, 64, 0] over 2.4s, effect-level ease-in-out puts the
// square at 16.5px where Motion has it at 32px. An `ease` array is per-segment
// already, except for the [x1, y1, x2, y2] form, which is one bezier.
function segmentEases(ease: any, segments: number): string[] {
  const perSegment =
    Array.isArray(ease) &&
    !(ease.length === 4 && ease.every((n: any) => typeof n === "number"));
  if (perSegment)
    return Array.from({ length: segments }, (_, i) =>
      cssEase(ease[Math.min(i, ease.length - 1)])
    );
  const one = cssEase(ease);
  return Array.from({ length: segments }, () => one);
}

// Where each frame of a property sits on the timeline — evenly spread unless
// the config supplied its own `times`
function offsetsFor(frames: any[], times: number[] | null): number[] {
  if (times && times.length === frames.length) return times;
  return frames.map((_, i) => i / (frames.length - 1));
}

// Transform components share one string per keyframe, so a property whose own
// frames don't land on a shared offset has to be read between them
function sampleAt(frames: any[], offs: number[], o: number): any {
  const i = offs.findIndex((x) => x >= o);
  if (i === -1) return frames[frames.length - 1];
  if (i === 0) return frames[0];
  const a = frames[i - 1];
  const b = frames[i];
  if (typeof a !== "number" || typeof b !== "number")
    return offs[i] === o ? b : a;
  const span = offs[i] - offs[i - 1];
  return span > 0 ? a + (b - a) * ((o - offs[i - 1]) / span) : b;
}

function intentAnimation(el: Element): Animation | null {
  const p = motionPropsFor(el);
  if (!p) return null;
  const target =
    typeof p.animate === "string" ? p.variants?.[p.animate] : p.animate;
  if (!target || typeof target !== "object" || Array.isArray(target)) return null;

  const t = { ...(p.transition ?? {}), ...(target.transition ?? {}) };
  if (t.type === "spring" || t.stiffness != null || t.damping != null) return null;
  const duration = (typeof t.duration === "number" ? t.duration : 0.3) * 1000;
  if (!(duration > 0)) return null;
  const times = Array.isArray(t.times) ? t.times : null;

  // A lone target value means "animate from wherever it is now" — there is no
  // authored start, so there is no timeline to lay out
  const transforms: [string, any[]][] = [];
  const plain: [string, any[]][] = [];
  for (const [key, raw] of Object.entries(target)) {
    if (key === "transition") continue;
    const frames = Array.isArray(raw) ? raw : [raw];
    if (frames.length < 2) continue;
    (TRANSFORM_ORDER.includes(key) ? transforms : plain).push([key, frames]);
  }
  if (!transforms.length && !plain.length) return null;

  const byOffset = new Map<number, Keyframe>();
  const at = (o: number): any => {
    let k = byOffset.get(o);
    if (!k) {
      k = { offset: o };
      byOffset.set(o, k);
    }
    return k;
  };

  if (transforms.length) {
    const union = new Set<number>();
    for (const [, frames] of transforms)
      for (const o of offsetsFor(frames, times)) union.add(o);
    for (const o of union) {
      const parts: string[] = [];
      for (const name of TRANSFORM_ORDER) {
        const entry = transforms.find(([k]) => k === name);
        if (!entry) continue;
        const v = sampleAt(entry[1], offsetsFor(entry[1], times), o);
        const unit = typeof v === "number" ? TRANSFORM_UNIT[name] ?? "" : "";
        parts.push(`${TRANSFORM_FN[name] ?? name}(${v}${unit})`);
      }
      if (parts.length) at(o).transform = parts.join(" ");
    }
  }
  // Non-transform properties keep their own offsets — WAAPI interpolates a
  // property across the keyframes that mention it, so they need no filling in
  for (const [name, frames] of plain) {
    const offs = offsetsFor(frames, times);
    const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    frames.forEach((v, i) => {
      at(offs[i])[camel] = v;
    });
  }

  const kfs = [...byOffset.values()].sort(
    (a, b) => (a.offset as number) - (b.offset as number)
  );

  // Authored segment boundaries come from whichever property carries the most
  // frames; a keyframe inherits the easing of the segment its offset falls in.
  // Properties with differing frame counts add offsets between boundaries, and
  // those sub-segments repeat their parent's easing — an approximation, but one
  // that stays exact in the ordinary case where the frame counts agree.
  const authored = [...transforms, ...plain].reduce<any[]>(
    (most, [, frames]) => (frames.length > most.length ? frames : most),
    []
  );
  const bounds = offsetsFor(authored, times);
  const eases = segmentEases(t.ease, Math.max(1, bounds.length - 1));
  kfs.forEach((k, i) => {
    if (i === kfs.length - 1) return;
    const next = bounds.findIndex((b) => b > (k.offset as number));
    k.easing = eases[Math.min(Math.max(0, next - 1), eases.length - 1)];
  });

  try {
    const anim = new Animation(
      new KeyframeEffect(el, kfs, {
        duration,
        delay: (typeof t.delay === "number" ? t.delay : 0) * 1000,
        // The easing lives on the keyframes, the way CSS does it
        easing: "linear",
        fill: "both",
        iterations:
          t.repeat === Infinity
            ? Infinity
            : typeof t.repeat === "number"
              ? t.repeat + 1
              : 1,
        direction:
          t.repeatType === "reverse" || t.repeatType === "mirror"
            ? "alternate"
            : "normal",
      })
    );
    anim.id = `declared · ${[...transforms, ...plain].map(([k]) => k).join(", ")}`;
    return anim;
  } catch {
    return null;
  }
}

// Give the player something to drive when the platform exposes nothing.
// Registered alongside recordings so releasing the grab releases this too —
// and once it exists, Motion's inline writes are outranked by it, so the
// element keeps moving to the same config the player is now scrubbing.
export function ensureIntentAnimation(el: Element): boolean {
  try {
    if (el.getAnimations({ subtree: true }).length) return false;
  } catch {
    return false;
  }
  const anim = intentAnimation(el);
  if (!anim) return false;
  RECORDED.set(el, [...(RECORDED.get(el) ?? []), anim]);
  try {
    anim.play();
  } catch {}
  return true;
}

function fmtMotionValue(v: any): string {
  if (typeof v === "string") return `"${v}"`;
  if (Array.isArray(v)) return `[${v.join("→")}]`;
  if (v && typeof v === "object")
    return Object.entries(v)
      .filter(([k]) => k !== "transition")
      .map(([k, val]) => `${k}: ${Array.isArray(val) ? `[${val.join("→")}]` : val}`)
      .join(", ");
  return String(v);
}

function fmtMotionTransition(t: any): string {
  if (!t || typeof t !== "object") return "";
  const parts: string[] = [];
  if (t.type === "spring" || t.stiffness != null || t.damping != null)
    parts.push(
      t.stiffness != null || t.damping != null
        ? `spring(${t.stiffness ?? 100}, ${t.damping ?? 10}${t.mass != null ? `, ${t.mass}` : ""})`
        : "spring"
    );
  if (t.duration != null) parts.push(`${t.duration}s`);
  if (typeof t.ease === "string") parts.push(t.ease);
  if (t.delay) parts.push(`+${t.delay}s`);
  if (t.repeat != null) parts.push(t.repeat === Infinity ? "×∞" : `×${t.repeat + 1}`);
  if (t.staggerChildren) parts.push(`stagger ${t.staggerChildren}s`);
  return parts.join(" ");
}

// "motion animate: x: [0→64→0] · 2.4s easeInOut ×∞" — the declared
// intent, readable even when the animation itself runs on a JS loop
export function describeMotionIntent(el: Element): string[] {
  const p = motionPropsFor(el);
  if (!p) return [];
  const lines: string[] = [];
  const resolve = (v: any) =>
    typeof v === "string" && p.variants?.[v] ? p.variants[v] : v;
  const add = (label: string, raw: any) => {
    const target = resolve(raw);
    if (target == null || typeof target === "boolean") return;
    let line = `${label} ${fmtMotionValue(target)}`;
    const timing = fmtMotionTransition(
      (typeof target === "object" ? target.transition : null) ?? p.transition
    );
    if (timing) line += ` · ${timing}`;
    lines.push(midTruncate(line, 68));
  };
  add("motion animate:", p.animate);
  add("motion hover:", p.whileHover);
  add("motion tap:", p.whileTap);
  add("motion exit:", p.exit);
  if (p.layout) lines.push("motion: layout animation");
  return lines;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function labelFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls =
    typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
      : "";
  return midTruncate(tag + id + cls, 44);
}

interface HoverBox {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  size: string;
}

// ── Layer menu ──

const LayersIcon = (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>
  </svg>
);

const RecordIcon = (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
  </svg>
);

// Keyframe diamond — only when the layer itself animates. (A stroke-only
// keyframe has its own meaning in animation tools, so containers with
// motion deeper inside get no icon.)
function KeyframeMark({ kind }: { kind: "self" | "inside" | "none" }) {
  if (kind !== "self") return <span style={{ width: 10, flexShrink: 0 }} />;
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" style={{ flexShrink: 0 }}>
      <rect
        x={2.4}
        y={2.4}
        width={5.2}
        height={5.2}
        transform="rotate(45 5 5)"
        fill="#e4e4e7"
        stroke="#e4e4e7"
        strokeWidth={1.2}
      />
    </svg>
  );
}

interface LayerRow {
  el: Element;
  depth: number;
  kind: "self" | "inside" | "none";
}

const MAX_LAYER_ROWS = 24;

// Direct children of the grab, auto-expanded along branches that contain
// animation — deep animated layers are reachable from one menu
function buildLayerRows(root: Element): LayerRow[] {
  const rows: LayerRow[] = [];
  function visit(el: Element, depth: number) {
    for (const child of el.children) {
      if (rows.length >= MAX_LAYER_ROWS) return;
      if (child.hasAttribute("data-penseat")) continue;
      let own = 0;
      let sub = 0;
      try {
        own = child.getAnimations().length;
        sub = child.getAnimations({ subtree: true }).length;
      } catch {}
      rows.push({
        el: child,
        depth,
        kind: own > 0 ? "self" : sub > 0 ? "inside" : "none",
      });
      if (sub > own) visit(child, depth + 1);
    }
  }
  visit(root, 0);
  return rows;
}

let nextGrabId = 1;

// Union of the element's bounding rect across its animation cycle — the
// grab box should contain the whole move path, not one frozen frame.
// Returns null when motion isn't sampleable (no WAAPI/CSS animations,
// e.g. random JS-driven movement) — callers fall back to the live rect.
function motionBounds(el: Element): { left: number; top: number; right: number; bottom: number } | null {
  const anims: Animation[] = [];
  try {
    anims.push(...el.getAnimations({ subtree: true }));
  } catch {}
  // ancestor animations move this element too
  let parent = el.parentElement;
  while (parent) {
    try {
      anims.push(...parent.getAnimations());
    } catch {}
    parent = parent.parentElement;
  }
  if (!anims.length) return null;
  const span = Math.max(
    ...anims.map((a) => {
      const t = a.effect?.getTiming();
      const dur = typeof t?.duration === "number" ? t.duration : 0;
      return (t?.delay ?? 0) + dur;
    })
  );
  if (!span || !isFinite(span)) return null;
  const prev = anims.map((a) => ({
    time: a.currentTime,
    running: a.playState === "running",
  }));
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const SAMPLES = 13;
  for (let i = 0; i < SAMPLES; i++) {
    const t = (span * i) / (SAMPLES - 1);
    for (const a of anims) {
      try {
        a.pause();
        a.currentTime = t;
      } catch {}
    }
    const r = el.getBoundingClientRect();
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  anims.forEach((a, i) => {
    try {
      a.currentTime = prev[i].time;
      if (prev[i].running) a.play();
    } catch {}
  });
  return isFinite(left) ? { left, top, right, bottom } : null;
}

// Snapshot an element into a grab — shared with the motion player,
// which promotes layers to selections
export function makeGrab(el: Element): GrabbedElement {
  const live = el.getBoundingClientRect();
  const bounds = motionBounds(el);
  const rect = bounds
    ? {
        left: bounds.left,
        top: bounds.top,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
      }
    : live;
  let innerMotion = false;
  try {
    innerMotion =
      el.getAnimations({ subtree: true }).length > el.getAnimations().length;
  } catch {}
  return {
    id: nextGrabId++,
    x: Math.round(rect.left + window.scrollX),
    y: Math.round(rect.top + window.scrollY),
    w: Math.round(rect.width),
    h: Math.round(rect.height),
    label: labelFor(el),
    // The card reports the element's own size, even when the box is
    // stretched to contain its motion path
    size: `${Math.round(live.width)}×${Math.round(live.height)}`,
    motion: describeMotion(el),
    component: componentNameFor(el),
    el,
    innerMotion,
  };
}

export default function ElementInspector({
  picking,
  grabs,
  onGrab,
  onRemove,
  onSolo,
  onRecord,
  onArmingChange,
}: ElementInspectorProps) {
  const [hover, setHover] = useState<HoverBox | null>(null);
  // Layer menu: which grab's menu is open, and the row being hovered
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [menuHover, setMenuHover] = useState<{ idx: number; left: number; top: number; width: number; height: number } | null>(null);
  const [layersBtnHover, setLayersBtnHover] = useState<number | null>(null);
  // Grab armed for transition recording — the picker steps aside so real
  // hovers/focus reach the page and can trigger the transition
  const [arming, setArming] = useState<number | null>(null);

  useEffect(() => {
    onArmingChange(arming !== null);
  }, [arming, onArmingChange]);

  useEffect(() => {
    if (arming === null) return;
    const grab = grabs.find((g) => g.id === arming);
    if (!grab) {
      setArming(null);
      return;
    }
    const root = grab.el;
    interface TransitionSnap {
      target: Element;
      keyframes: Keyframe[];
      duration: number;
      delay: number;
      easing: string;
      prop: string;
    }
    const collected = new Map<Animation, TransitionSnap>();
    let timer: number | null = null;

    // Snapshot synchronously in the event — the CSSTransition is
    // guaranteed alive here, while by the time a (possibly throttled)
    // timer fires a short transition may already be finished and gone
    const onRun = () => {
      let transitions: Animation[] = [];
      try {
        transitions = root
          .getAnimations({ subtree: true })
          .filter((a) => a instanceof CSSTransition);
      } catch {}
      for (const tr of transitions) {
        if (collected.has(tr)) continue;
        const effect = tr.effect;
        if (!(effect instanceof KeyframeEffect) || !effect.target) continue;
        try {
          const timing = effect.getTiming();
          collected.set(tr, {
            target: effect.target,
            // Meta fields stripped — setKeyframes-style round-trips choke
            // on computedOffset/composite
            keyframes: effect.getKeyframes().map(
              ({ composite: _c, computedOffset: _o, ...kf }) => kf
            ),
            duration:
              typeof timing.duration === "number" ? timing.duration : 0,
            delay: timing.delay ?? 0,
            easing: String(timing.easing ?? "linear"),
            prop: (tr as CSSTransition).transitionProperty,
          });
        } catch {}
      }
      // Transitions on multiple properties/elements start within a couple
      // of frames of each other — let the burst gather, then finalize
      if (timer === null && collected.size) {
        timer = window.setTimeout(finalize, 120);
      }
    };

    const finalize = () => {
      timer = null;
      if (!collected.size) return;
      const replicas: Animation[] = [];
      for (const [tr, snap] of collected) {
        try {
          const replica = new Animation(
            new KeyframeEffect(snap.target, snap.keyframes, {
              duration: snap.duration,
              delay: snap.delay,
              easing: snap.easing,
              fill: "both",
            })
          );
          replica.id = `transition · ${snap.prop}`;
          // The replica owns the motion from here; cancelling the live
          // transition snaps the element to its (hovered) end state
          try {
            tr.cancel();
          } catch {}
          replica.pause();
          replica.currentTime = 0;
          replicas.push(replica);
        } catch {}
      }
      collected.clear();
      if (replicas.length) {
        cancelRecorded(root);
        RECORDED.set(root, replicas);
        setArming(null);
        onRecord(grab);
      }
    };

    // ── JS-driven motion (Framer Motion springs, GSAP, rAF loops) ──
    // Those libraries bypass the platform's animation layer and write
    // inline styles every frame. While armed, a style-mutation burst
    // starts a sampling session: computed values are captured per frame,
    // simplified, and rebuilt as a WAAPI replica Penseat can scrub.
    interface SamplingSession {
      t0: number;
      els: Set<HTMLElement | SVGElement>;
      tracks: Map<Element, Map<string, { t: number; v: string }[]>>;
      raf: number;
    }
    let session: SamplingSession | null = null;
    let lastMut = 0;

    const parseNums = (s: string) =>
      (s.match(/-?\d+\.?\d*(?:e-?\d+)?/g) ?? []).map(Number);

    // Ramer–Douglas–Peucker on the sampled value curve — keeps spring
    // peaks while a plain tween collapses to a handful of points
    const simplifyTrack = (
      samples: { t: number; v: string }[]
    ): { t: number; v: string }[] => {
      if (samples.length <= 2) return samples;
      const vecs = samples.map((s) => parseNums(s.v));
      const dim = vecs[0]?.length ?? 0;
      if (!dim || vecs.some((x) => x.length !== dim))
        // Non-numeric values — keep the points where the value changes
        return samples.filter(
          (s, i) =>
            i === 0 || i === samples.length - 1 || s.v !== samples[i - 1].v
        );
      const ranges = Array.from({ length: dim }, (_, c) => {
        let mn = Infinity;
        let mx = -Infinity;
        for (const v of vecs) {
          mn = Math.min(mn, v[c]);
          mx = Math.max(mx, v[c]);
        }
        return Math.max(mx - mn, 1e-6);
      });
      const keep = new Set([0, samples.length - 1]);
      const rec = (a: number, b: number) => {
        if (b - a < 2) return;
        let worst = -1;
        let worstErr = 0;
        for (let i = a + 1; i < b; i++) {
          const f =
            (samples[i].t - samples[a].t) /
            Math.max(1e-6, samples[b].t - samples[a].t);
          let err = 0;
          for (let c = 0; c < dim; c++) {
            const interp = vecs[a][c] + (vecs[b][c] - vecs[a][c]) * f;
            err = Math.max(err, Math.abs(vecs[i][c] - interp) / ranges[c]);
          }
          if (err > worstErr) {
            worstErr = err;
            worst = i;
          }
        }
        if (worstErr > 0.02 && worst > 0) {
          keep.add(worst);
          rec(a, worst);
          rec(worst, b);
        }
      };
      rec(0, samples.length - 1);
      return samples.filter((_, i) => keep.has(i)).slice(0, 40);
    };

    const finalizeSampling = () => {
      const s = session;
      session = null;
      if (!s) return;
      cancelAnimationFrame(s.raf);
      let tEnd = s.t0 + 100;
      for (const tracks of s.tracks.values())
        for (const samples of tracks.values())
          tEnd = Math.max(tEnd, samples[samples.length - 1]?.t ?? 0);
      // The rAF cap can overshoot when frames starve (background tab) —
      // clamp so a stalled session can't produce an absurdly long replica
      const dur = Math.min(tEnd - s.t0, 8000);
      const replicas: Animation[] = [];
      for (const [el, tracks] of s.tracks) {
        const kfs: Keyframe[] = [];
        const propNames: string[] = [];
        for (const [prop, samples] of tracks) {
          if (samples.length < 2) continue;
          const simplified = simplifyTrack(samples);
          if (simplified.every((x) => x.v === simplified[0].v)) continue;
          propNames.push(prop);
          const camel = prop.replace(/-([a-z])/g, (_, c: string) =>
            c.toUpperCase()
          );
          for (const smp of simplified)
            kfs.push({
              offset: Math.min(1, Math.max(0, (smp.t - s.t0) / dur)),
              [camel]: smp.v,
            });
        }
        if (!kfs.length) continue;
        kfs.sort((a, b) => (a.offset as number) - (b.offset as number));
        try {
          const replica = new Animation(
            new KeyframeEffect(el, kfs, {
              duration: dur,
              fill: "both",
              easing: "linear",
            })
          );
          replica.id = `recorded · ${propNames.join(", ")}`;
          replica.pause();
          replica.currentTime = 0;
          replicas.push(replica);
        } catch {}
      }
      if (replicas.length) {
        RECORDED.set(root, [...(RECORDED.get(root) ?? []), ...replicas]);
        setArming(null);
        onRecord(grab);
      }
    };

    const sample = () => {
      const s = session;
      if (!s) return;
      const now = performance.now();
      for (const el of s.els) {
        const decl = el.style;
        const cs = getComputedStyle(el);
        for (let i = 0; i < decl.length; i++) {
          const prop = decl.item(i);
          if (prop.startsWith("--") || prop === "will-change") continue;
          let track = s.tracks.get(el);
          if (!track) s.tracks.set(el, (track = new Map()));
          let arr = track.get(prop);
          if (!arr) track.set(prop, (arr = []));
          arr.push({ t: now, v: cs.getPropertyValue(prop) });
        }
      }
      // Quiet for a beat (motion settled) or hard cap → build replicas
      if (now - lastMut > 300 || now - s.t0 > 5000) {
        finalizeSampling();
        return;
      }
      s.raf = requestAnimationFrame(sample);
    };

    const observer = new MutationObserver((muts) => {
      lastMut = performance.now();
      for (const m of muts) {
        const el = m.target;
        if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
        if (el.closest("[data-penseat]")) continue;
        if (!session) {
          session = {
            t0: performance.now(),
            els: new Set(),
            tracks: new Map(),
            raf: 0,
          };
          session.raf = requestAnimationFrame(sample);
        }
        session.els.add(el);
      }
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["style"],
      subtree: true,
    });

    root.addEventListener("transitionrun", onRun);
    // A finished or cancelled transition also closes the burst — timers
    // can be heavily throttled in background tabs, events can't
    root.addEventListener("transitionend", finalize);
    root.addEventListener("transitioncancel", finalize);
    return () => {
      root.removeEventListener("transitionrun", onRun);
      root.removeEventListener("transitionend", finalize);
      root.removeEventListener("transitioncancel", finalize);
      if (timer !== null) clearTimeout(timer);
      observer.disconnect();
      if (session) cancelAnimationFrame(session.raf);
      session = null;
    };
  }, [arming, grabs, onRecord]);

  function chooseLayer(el: Element, additive: boolean) {
    setOpenMenuId(null);
    setMenuHover(null);
    const existing = grabIdFor(el);
    if (existing !== null) return; // already selected
    onGrab(makeGrab(el), additive);
  }

  useEffect(() => {
    if (!picking) setHover(null);
  }, [picking]);

  // The hover box is viewport-fixed — it goes stale when the page scrolls
  // under a stationary pointer. Hide it; the next pointermove re-shows it.
  useEffect(() => {
    if (!picking) return;
    const onScroll = () => setHover(null);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [picking]);

  // Topmost page element under the pointer, skipping penseat's own UI
  function pickAt(clientX: number, clientY: number): Element | null {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (el.closest("[data-penseat]")) continue;
      if (el === document.documentElement || el === document.body) break;
      return el;
    }
    return null;
  }

  // Identity by element reference, with a label+geometry fallback:
  // React re-renders swap DOM nodes under a live selection, and the
  // replacement node must still count as selected (hover suppression,
  // click-to-deselect) or the hover tooltip stacks on the spec card
  function grabIdFor(el: Element): number | null {
    const byRef = grabs.find((g) => g.el === el);
    if (byRef) return byRef.id;
    const label = labelFor(el);
    const r = el.getBoundingClientRect();
    const x = r.left + window.scrollX;
    const y = r.top + window.scrollY;
    // Same element when the footprints substantially overlap — the live
    // rect can be BIGGER than the grab box (hover-scale springs mid-
    // flight) or SMALLER (boxes stretched to hold the motion path), so
    // neither rect equality nor containment holds in general
    const byBox = grabs.find((g) => {
      if (g.label !== label) return false;
      const ox = Math.min(x + r.width, g.x + g.w) - Math.max(x, g.x);
      const oy = Math.min(y + r.height, g.y + g.h) - Math.max(y, g.y);
      if (ox <= 0 || oy <= 0) return false;
      const smaller = Math.min(r.width * r.height, g.w * g.h);
      return ox * oy >= smaller * 0.6;
    });
    return byBox ? byBox.id : null;
  }

  function handleMove(e: React.PointerEvent) {
    const el = pickAt(e.clientX, e.clientY);
    // Already-selected elements keep just their grab outline — a second
    // highlight plus a label repeating the spec card is pure noise
    if (!el || grabIdFor(el) !== null) {
      setHover(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setHover({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      label: labelFor(el),
      size: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
    });
  }

  function handlePick(e: React.PointerEvent) {
    e.preventDefault();
    const el = pickAt(e.clientX, e.clientY);
    if (!el) return;
    const existing = grabIdFor(el);
    const additive = e.shiftKey;

    if (existing !== null) {
      if (additive) {
        // shift+click on a grabbed element: remove it from the selection
        onRemove(existing);
        setHover(null);
      } else if (grabs.length > 1) {
        // plain click: single selection — keep only this one
        onSolo(existing);
      } else {
        // plain click on the sole selection: toggle it off
        onRemove(existing);
        setHover(null);
      }
      return;
    }

    onGrab(makeGrab(el), additive);
    // The pointer usually doesn't move after the click, so no pointermove
    // will come to refresh (and suppress) the hover box — the stale tag
    // would linger next to the fresh spec card
    setHover(null);
  }

  return (
    <>
      {/* Committed grabs — intentionally NOT marked data-penseat, so they
          are part of the captured screenshot. Sits below the drawing
          canvas: ink can be scribbled over the cards. */}
      <div style={{ position: "absolute", top: 0, left: 0, zIndex: 9996, userSelect: "none" }}>
        {grabs.map((g) => (
          <div key={g.id} style={{ pointerEvents: "none" }}>
            <div
              style={{
                position: "absolute",
                left: g.x - PAD,
                top: g.y - PAD,
                width: g.w + PAD * 2,
                height: g.h + PAD * 2,
                border: `1.5px solid ${GRAB_COLOR}`,
                borderRadius: 6,
                boxShadow: "0 0 0 1px rgba(14,165,233,0.25)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: g.x - PAD,
                // Bottom-anchored where the pick-hover tag sits, with the
                // selector as the LAST line: the familiar tag line never
                // moves, details stack upward from it, and the card can't
                // grow down across the selection outline
                top: g.y - PAD - 4,
                transform: "translateY(-100%)",
                // Zero-width positioned ancestor — size to content explicitly
                width: "max-content",
                maxWidth: 400,
                backgroundColor: "#18181b",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 6,
                padding: "5px 8px",
                fontFamily: "monospace",
                fontSize: 11,
                lineHeight: 1.5,
                color: "#e4e4e7",
                wordBreak: "break-word",
              }}
            >
              {g.motion.map((line, i) => (
                <div key={i} style={{ color: "#fafafa" }}>
                  {line}
                </div>
              ))}
              <div>
                {g.label} <span style={{ color: "#71717a" }}>{g.size}</span>
                {g.component && (
                  <span style={{ color: "#7dd3fc" }}>{` <${g.component}>`}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pick layer — catches pointer input while the cursor tool is active.
          Steps aside while a recording is armed: the pointer must reach the
          real page to trigger :hover / :focus transitions */}
      {picking && arming === null && (
        <div
          data-penseat="picker"
          onPointerMove={handleMove}
          onPointerDown={handlePick}
          onPointerLeave={() => setHover(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9998,
            touchAction: "none",
          }}
        />
      )}

      {/* Hover highlight — penseat UI, excluded from capture */}
      {/* Hover is outline-only — the black label card belongs to selection,
          where the spec card carries it along with the timing readout */}
      {picking && arming === null && hover && (
        <div
          data-penseat="hover"
          style={{
            position: "fixed",
            left: hover.left - PAD,
            top: hover.top - PAD,
            width: hover.width + PAD * 2,
            height: hover.height + PAD * 2,
            zIndex: 9999,
            pointerEvents: "none",
            border: `1.5px solid ${GRAB_COLOR}`,
            backgroundColor: "rgba(14,165,233,0.08)",
            borderRadius: 6,
          }}
        />
      )}

      {/* Layer buttons + menus — penseat UI, sits above the pick layer so
          it stays clickable in any tool mode */}
      <div
        data-penseat="layer-ui"
        style={{ position: "absolute", top: 0, left: 0, zIndex: 9999, pointerEvents: "none", userSelect: "none" }}
      >
        {grabs.filter((g) => g.innerMotion || hasTransitions(g)).map((g) => (
          <div key={g.id}>
            {g.innerMotion && (
            <button
              aria-label="Show layers"
              onClick={() => {
                setMenuHover(null);
                setOpenMenuId((open) => (open === g.id ? null : g.id));
              }}
              onPointerEnter={() => setLayersBtnHover(g.id)}
              onPointerLeave={() => setLayersBtnHover(null)}
              style={{
                position: "absolute",
                // Outside the outline, flush with its top edge
                left: g.x + g.w + PAD + 6,
                top: g.y - PAD,
                width: 24,
                height: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "auto",
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.35)",
                borderRadius: 6,
                padding: 0,
                // Selection-blue fill; icon brightens to white on hover/open
                backgroundColor: GRAB_COLOR,
                color:
                  openMenuId === g.id || layersBtnHover === g.id
                    ? "#ffffff"
                    : "#bae6fd",
                transition: "color 150ms",
              }}
            >
              {LayersIcon}
            </button>
            )}

            {hasTransitions(g) && (
              <button
                aria-label="Record transition"
                title={
                  arming === g.id
                    ? "Recording armed — trigger the transition (hover, focus, press…) or click to cancel"
                    : "Record a transition: arm, then trigger it on the element"
                }
                onClick={() => setArming((a) => (a === g.id ? null : g.id))}
                style={{
                  position: "absolute",
                  // Sits in the button row right of the layers button
                  left: g.x + g.w + PAD + 6 + (g.innerMotion ? 28 : 0),
                  top: g.y - PAD,
                  width: 24,
                  height: 24,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "auto",
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.35)",
                  borderRadius: 6,
                  padding: 0,
                  backgroundColor: arming === g.id ? "#ef4444" : GRAB_COLOR,
                  color: arming === g.id ? "#ffffff" : "#bae6fd",
                  transition: "background-color 150ms, color 150ms",
                }}
              >
                {RecordIcon}
              </button>
            )}

            {openMenuId === g.id && (
              <div
                style={{
                  position: "absolute",
                  // Prefer outside the box so the menu doesn't cover the
                  // layers you're hovering; fall back under the button
                  left:
                    g.x + g.w + PAD + 266 < window.scrollX + window.innerWidth
                      ? g.x + g.w + PAD + 6
                      : Math.max(8, g.x + g.w + PAD - 260),
                  top: g.y - PAD + 30,
                  width: 260,
                  pointerEvents: "auto",
                  backgroundColor: "#18181b",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 8,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
                  padding: 4,
                  fontFamily: "monospace",
                  fontSize: 11,
                }}
              >
                {/* Scroll area bleeds to the menu edge — the scrollbar gets
                    its own strip and never overlaps rows */}
                <div
                  style={{
                    maxHeight: 212,
                    overflowY: "auto",
                    overscrollBehavior: "contain",
                    marginRight: -4,
                    paddingRight: 4,
                    scrollbarGutter: "stable",
                    scrollbarWidth: "thin",
                    scrollbarColor: "rgba(255,255,255,0.12) transparent",
                  }}
                >
                {buildLayerRows(g.el).map((row, idx) => (
                  <div
                    key={idx}
                    onPointerEnter={() => {
                      const r = row.el.getBoundingClientRect();
                      setMenuHover({ idx, left: r.left, top: r.top, width: r.width, height: r.height });
                    }}
                    onPointerLeave={() => setMenuHover(null)}
                    onClick={(e) => chooseLayer(row.el, e.shiftKey)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 8px",
                      paddingLeft: 8 + row.depth * 12,
                      borderRadius: 5,
                      cursor: "pointer",
                      color: row.kind === "none" ? "#71717a" : "#e4e4e7",
                      backgroundColor: menuHover?.idx === idx ? "rgba(63,63,70,1)" : "transparent",
                    }}
                  >
                    <span style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap" }}>
                      {midTruncate(labelFor(row.el), 28 - row.depth * 2)}
                    </span>
                    {/* Keyframe marks right-aligned in their own column */}
                    <KeyframeMark kind={row.kind} />
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Stroke around the layer-menu row being hovered — shows which
          element you're about to select */}
      {menuHover && (
        <div
          data-penseat="menu-hover"
          style={{
            position: "fixed",
            left: menuHover.left - 3,
            top: menuHover.top - 3,
            width: menuHover.width + 6,
            height: menuHover.height + 6,
            zIndex: 9999,
            pointerEvents: "none",
            border: `1.5px solid ${GRAB_COLOR}`,
            backgroundColor: "rgba(14,165,233,0.1)",
            borderRadius: 6,
          }}
        />
      )}
    </>
  );
}
