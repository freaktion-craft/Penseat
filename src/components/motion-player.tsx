"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { type GrabbedElement, labelFor, midTruncate, componentNameFor, describeMotionIntent } from "./element-inspector";

// Onion skin shows this many steps before and after the paused instant
const ONION_STEPS = 3;
const MAX_GHOST_LAYERS = 6;
const PANEL_BG = "#18181b";
const LANE_GAP = 14; // space between the label column and the timelines
const ACCENT = "#e4e4e7";

// ── Icons (from Lucide, inlined) ──
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
// Play/pause morph — each pause bar and its half of the play triangle
// are 4-point paths (same command list), so CSS tweens `d` and the bars
// taper into the triangle. The shapes live in class-driven CSS rules —
// React doesn't reliably update `d` through inline style objects — and
// the dynamic attribute is the fallback for browsers without the `d`
// CSS property (instant swap there).
const PP = {
  bar1: "M5 4 L10 4 L10 20 L5 20 Z",
  bar2: "M14 4 L19 4 L19 20 L14 20 Z",
  tri1: "M6 3 L13 7.5 L13 16.5 L6 21 Z",
  tri2: "M13 7.5 L20 12 L20 12 L13 16.5 Z",
};
const PlayPauseIcon = ({ playing }: { playing: boolean }) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    className={playing ? "penseat-pp" : "penseat-pp penseat-pp-play"}
  >
    <style>{`
      .penseat-pp path { transition: d 200ms ease; }
      .penseat-pp path:first-of-type { d: path("${PP.bar1}"); }
      .penseat-pp path:last-of-type { d: path("${PP.bar2}"); }
      .penseat-pp.penseat-pp-play path:first-of-type { d: path("${PP.tri1}"); }
      .penseat-pp.penseat-pp-play path:last-of-type { d: path("${PP.tri2}"); }
    `}</style>
    <path d={playing ? PP.bar1 : PP.tri1} />
    <path d={playing ? PP.bar2 : PP.tri2} />
  </svg>
);
const RestartIcon = <svg {...iconProps}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>;
// Onion skin — two overlapping frames, the older one fainter
const OnionIcon = <svg width={16} height={16} viewBox="0 0 24 24" fill="none"><circle cx="9" cy="12" r="5.5" fill="currentColor" opacity="0.4"/><circle cx="15" cy="12" r="5.5" fill="currentColor" opacity="0.85"/></svg>;
const CloseIcon = <svg {...iconProps}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;
const MinimizeIcon = <svg {...iconProps}><path d="M5 12h14"/></svg>;
const RestoreIcon = <svg {...iconProps}><rect x="5" y="5" width="14" height="14" rx="2"/></svg>;
const CheckIcon = <svg {...iconProps} strokeWidth={3}><path d="M20 6 9 17l-5-5"/></svg>;

// ── Timing edits ──

const EDIT_COL = 108; // right column holding the duration + ease chips

const EASE_PRESETS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"];

// Compact chip labels — the menu shows full names
function easeLabel(easing: string): string {
  switch (easing) {
    case "linear": return "linear";
    case "ease": return "ease";
    case "ease-in": return "in";
    case "ease-out": return "out";
    case "ease-in-out": return "in-out";
    default: return easing.startsWith("linear(") ? "spring" : "bezier";
  }
}

// ── Custom bezier editor ──

// 1:1 unit scale — the 0–1 × 0–1 progress square renders square;
// height adds the ±0.25 overshoot bands at the same scale
const BZ_W = 128;
const BZ_H = 192;
const BZ_YMIN = -0.25;
const BZ_YMAX = 1.25;
const bzX = (x: number) => x * BZ_W;
const bzY = (y: number) => BZ_H - ((y - BZ_YMIN) / (BZ_YMAX - BZ_YMIN)) * BZ_H;

type Bezier = [number, number, number, number];

// Accepts "cubic-bezier(a, b, c, d)" or bare "a, b, c, d"
function parseBezier(str: string): Bezier | null {
  const m = str.match(/([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)/);
  if (!m) return null;
  const v = m.slice(1, 5).map(Number);
  return v.every((n) => isFinite(n)) ? (v as Bezier) : null;
}

function bezierString(b: Bezier): string {
  return `cubic-bezier(${b.map((n) => Math.round(n * 100) / 100).join(", ")})`;
}

// ── Spring easing ──

interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
}

const SPRING_DEFAULTS: SpringParams = { stiffness: 170, damping: 14, mass: 1 };

const SPRING_FIELDS: { key: keyof SpringParams; min: number; max: number; step: number }[] = [
  { key: "stiffness", min: 20, max: 400, step: 5 },
  { key: "damping", min: 2, max: 50, step: 1 },
  { key: "mass", min: 0.5, max: 5, step: 0.1 },
];

// Damped spring simulation → CSS linear() easing + natural duration.
// The overshoot survives because linear() points may exceed 1.
function simulateSpring({ stiffness, damping, mass }: SpringParams): {
  duration: number;
  easing: string;
} {
  const dt = 1 / 120;
  let x = 1; // displacement from target (progress = 1 - x)
  let v = 0;
  let t = 0;
  const samples: number[] = [0];
  while (t < 10) {
    const a = (-stiffness * x - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    t += dt;
    samples.push(1 - x);
    if (Math.abs(x) < 0.001 && Math.abs(v) < 0.001) break;
  }
  const POINTS = 60;
  const pts: string[] = [];
  for (let i = 0; i <= POINTS; i++) {
    const idx = Math.min(samples.length - 1, Math.round((i / POINTS) * (samples.length - 1)));
    pts.push(String(Math.round(samples[idx] * 1000) / 1000));
  }
  return { duration: Math.round(t * 1000), easing: `linear(${pts.join(", ")})` };
}

// "900", "900ms", "0.9s", "0.9" → milliseconds
function parseDuration(value: string): number | null {
  const m = value.trim().match(/^([\d.]+)\s*(ms|s)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n) || n <= 0) return null;
  if (m[2]?.toLowerCase() === "s") return n * 1000;
  if (m[2]?.toLowerCase() === "ms") return n;
  return n < 20 ? n * 1000 : n; // bare small numbers read as seconds
}

// ── Edit log ──
// Timing changes outlive the player: badges render next to edited
// elements (unmarked, so they ride along in the screenshot), and the
// toolbar copy adds a code-agent change order to the clipboard.

export interface EditBadge {
  name: string; // animation name
  lines: string[]; // "duration: 1.80s -> 2.60s", ...
}

export const EDIT_LOG = new Map<Element, EditBadge[]>();

// Badges stay hidden until confirmed with the panel's check button
export const EDIT_REVEALED = new Set<Element>();

const editLogListeners = new Set<() => void>();
export function subscribeEditLog(fn: () => void): () => void {
  editLogListeners.add(fn);
  return () => {
    editLogListeners.delete(fn);
  };
}
function emitEditLog() {
  for (const fn of editLogListeners) fn();
}

// State snapshot at the last check — closing the panel without checking
// rolls animations back to this (or the first-seen original)
const COMMITTED = new WeakMap<
  Animation,
  { duration: number; keyframes: ComputedKeyframe[] }
>();

function cleanKeyframes(kfs: ComputedKeyframe[]): Keyframe[] {
  return kfs.map((kf) => {
    const c: Keyframe = {
      offset: (kf.computedOffset ?? kf.offset ?? 0) as number,
      easing: kf.easing,
    };
    for (const k of Object.keys(kf)) {
      if (KEYFRAME_META.has(k) || kf[k] == null) continue;
      c[k] = kf[k] as string;
    }
    return c;
  });
}

function applySnapshot(
  anim: Animation,
  snap: { duration: number; keyframes: ComputedKeyframe[] }
) {
  const effect = anim.effect;
  if (!(effect instanceof KeyframeEffect)) return;
  try {
    effect.setKeyframes(cleanKeyframes(snap.keyframes));
    effect.updateTiming({ duration: snap.duration });
  } catch {}
}

// Roll an animation back to its last checkpoint (or original)
function restoreAnimation(anim: Animation) {
  const snap = COMMITTED.get(anim) ?? FIRST_SEEN.get(anim);
  if (snap) applySnapshot(anim, snap);
}

// Trashing a badge reverts the element's animations all the way to their
// first-seen state — duration, easing and keyframes back to the original
export function revertEditBadge(el: Element) {
  let anims: Animation[] = [];
  try {
    anims = el.getAnimations();
  } catch {}
  for (const anim of anims) {
    const orig = FIRST_SEEN.get(anim);
    if (!orig) continue;
    applySnapshot(anim, orig);
    COMMITTED.delete(anim);
  }
  EDIT_LOG.delete(el);
  EDIT_REVEALED.delete(el);
  emitEditLog();
}

// Prompt for a single badge — the popover's copy button
// Source-level context for the code agent: the nearest named React
// component, plus any declared motion config (Framer Motion props)
function elementContextLines(el: Element): string[] {
  const lines: string[] = [];
  const component = componentNameFor(el);
  if (component) lines.push(`Component: <${component}>`);
  for (const intent of describeMotionIntent(el)) lines.push(`Declared ${intent}`);
  return lines;
}

export function buildBadgePrompt(el: Element): string | null {
  const badges = EDIT_LOG.get(el);
  if (!badges) return null;
  const lines = [
    `Motion timing changes for \`${fullSelector(el)}\` (tuned live with Penseat):`,
    ...elementContextLines(el),
  ];
  for (const b of badges) {
    lines.push(`Animation: ${b.name}`);
    for (const l of b.lines) lines.push(l.startsWith("  ") ? l : `- ${l}`);
  }
  lines.push("");
  lines.push(
    "Please update the corresponding animation definition in the source code (CSS @keyframes / animation shorthand, Tailwind classes or arbitrary values, or JS animation options) to match these timing values."
  );
  return lines.join("\n");
}

// Untruncated selector for the code-agent prompt
function fullSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls =
    typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\s+/).join(".")
      : "";
  return tag + id + cls;
}

// Change order for a code agent — everything currently in the edit log.
// Numbers match the circled badges pinned on the screenshot.
export function buildEditPrompt(): string | null {
  if (!EDIT_LOG.size) return null;
  const lines: string[] = [
    "Motion timing changes (tuned live with Penseat). Numbered circle badges in the screenshot mark the edited elements:",
  ];
  let num = 0;
  for (const [el, badges] of EDIT_LOG) {
    num++;
    lines.push("");
    lines.push(`[${num}] Element: ${fullSelector(el)}`);
    lines.push(...elementContextLines(el));
    for (const b of badges) {
      lines.push(`Animation: ${b.name}`);
      for (const l of b.lines) lines.push(l.startsWith("  ") ? l : `- ${l}`);
    }
  }
  lines.push("");
  lines.push(
    "Please update the corresponding animation definitions in the source code (CSS @keyframes / animation shorthand, Tailwind classes or arbitrary values, or JS animation options) to match these timing values."
  );
  return lines.join("\n");
}

// ── Animation inspection ──

interface PropTrack {
  prop: string; // kebab-case, for display
  key: string; // camelCase keyframe key, for reads/writes
  offsets: number[];
  // Decomposed transform sub-track (leaf elements only): which function
  // slot of the transform list this track edits, and the full signature
  slot?: number;
  sig?: string[];
  // For multi-argument functions (translate(x, y)): which argument
  argIndex?: number;
}

// ── Transform decomposition (leaf elements) ──

const TRANSFORM_LABELS: Record<string, string> = {
  rotate: "rotation", rotateX: "rotation-x", rotateY: "rotation-y", rotateZ: "rotation-z",
  translateX: "x position", translateY: "y position", translateZ: "z position",
  translate: "position",
  scale: "scale", scaleX: "scale-x", scaleY: "scale-y",
  skewX: "skew-x", skewY: "skew-y",
};

// translate(x, y) splits into per-axis tracks
const TRANSLATE_AXES = ["x position", "y position", "z position"];

// Attribute family of a (possibly decomposed) track — multi-axis families
// (x/y position, scale axes) fold under one collapsible group row
function trackFamily(prop: string): string {
  const p = prop.replace(/ \d+$/, "");
  if (p.endsWith("position")) return "position";
  if (p === "scale" || p.startsWith("scale-")) return "scale";
  if (p === "rotation" || p.startsWith("rotation-")) return "rotation";
  if (p.startsWith("skew")) return "skew";
  return p;
}

// Child labels drop the family word the group row already carries
// ("x position" under "position" is just "x")
function famChildLabel(prop: string, fam: string): string {
  if (fam === "position") return prop.replace(" position", "");
  if (fam === "scale" && prop !== "scale") return prop.replace("scale-", "");
  return prop;
}

const TRANSFORM_IDENTITY: Record<string, string> = {
  rotate: "0deg", rotateX: "0deg", rotateY: "0deg", rotateZ: "0deg",
  translateX: "0px", translateY: "0px", translateZ: "0px", translate: "0px, 0px",
  scale: "1", scaleX: "1", scaleY: "1",
  skewX: "0deg", skewY: "0deg",
};

// Amplitude: scale a keyframe value about its neutral point — 0 for
// translate/rotate/skew, 1 for scale and opacity — so 150% on a
// translateY(-130px) is -195px and 150% on scale(1.32, 0.64) is
// scale(1.48, 0.46). Comma lists are scaled per component; anything
// non-numeric passes through untouched.
function scaleAbout(raw: string, neutral: number, k: number): string {
  return raw
    .split(",")
    .map((part) => {
      const m = /^\s*(-?\d*\.?\d+)([a-z%]*)\s*$/i.exec(part);
      if (!m) return part.trim();
      const n = neutral + (parseFloat(m[1]) - neutral) * k;
      const rounded = Math.round(n * 1000) / 1000;
      return `${rounded}${m[2]}`;
    })
    .join(", ");
}

// Which tracks an amplitude dial makes sense for, and their neutral value
function amplitudeNeutral(track: PropTrack): number | null {
  if (track.key === "opacity") return 1;
  if (track.slot == null || !track.sig) return null;
  const fn = track.sig[track.slot];
  if (!(fn in TRANSFORM_IDENTITY)) return null;
  return fn.startsWith("scale") ? 1 : 0;
}

// "rotate(14deg) translateX(26px)" → [{fn, arg}, …]; "none" → []; junk → null
function parseTransformList(value: string): { fn: string; arg: string }[] | null {
  const t = value.trim();
  if (!t || t === "none") return [];
  const out: { fn: string; arg: string }[] = [];
  const re = /([a-zA-Z0-9]+)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) out.push({ fn: m[1], arg: m[2] });
  return out.length ? out : null;
}

// Split a leaf element's transform track into per-function tracks
// (rotation / x / y / scale …) when every keyframe shares one signature
function decomposeTransformTrack(
  tracks: PropTrack[],
  keyframes: ComputedKeyframe[],
  target: Element | null
): PropTrack[] {
  // Any element qualifies — a wrapper that only exists to carry one
  // transform (a mover, a hopper, a squasher stacked around a ball) is
  // exactly the kind of layer whose transform should read as "x position"
  // rather than a matrix. The signature check below is the real guard:
  // only a consistently-shaped transform list gets split.
  if (!(target instanceof Element)) return tracks;
  const ti = tracks.findIndex((t) => t.key === "transform");
  if (ti === -1) return tracks;
  const raws = keyframes.filter((kf) => kf.transform != null).map((kf) => String(kf.transform));
  const parses = raws.map(parseTransformList);
  if (parses.some((p) => p === null)) return tracks;
  const sigSrc = parses.find((p) => p!.length > 0);
  if (!sigSrc) return tracks;
  const sig = sigSrc.map((e) => e.fn);
  const consistent = parses.every(
    (p) => p!.length === 0 || (p!.length === sig.length && p!.every((e, i) => e.fn === sig[i]))
  );
  if (!consistent || !sig.every((fn) => TRANSFORM_IDENTITY[fn])) return tracks;
  const base = tracks[ti];
  const counts: Record<string, number> = {};
  const subs: PropTrack[] = sig.flatMap((fn, slot) => {
    counts[fn] = (counts[fn] ?? 0) + 1;
    const label = TRANSFORM_LABELS[fn] ?? fn;
    const suffix = counts[fn] > 1 ? ` ${counts[fn]}` : "";
    // translate(x, y) → one track per axis, grouped under position
    if (fn === "translate") {
      const argCount = Math.min(3, sigSrc[slot].arg.split(",").length);
      if (argCount > 1)
        return Array.from({ length: argCount }, (_, argIndex) => ({
          prop: `${TRANSLATE_AXES[argIndex]}${suffix}`,
          key: "transform",
          offsets: base.offsets,
          slot,
          sig,
          argIndex,
        }));
    }
    return [{
      prop: `${label}${suffix}`,
      key: "transform",
      offsets: base.offsets,
      slot,
      sig,
    }];
  });
  const next = [...tracks];
  next.splice(ti, 1, ...subs);
  return next;
}

interface AnimInfo {
  anim: Animation;
  name: string;
  delay: number;
  duration: number;
  iterations: number;
  easing: string;
  // True pre-edit values, first-seen — "default" and the copy prompt
  // reference these even across player remounts and re-grabs
  origDuration: number;
  origEasing: string;
  tracks: PropTrack[];
}

const FIRST_SEEN = new WeakMap<
  Animation,
  { duration: number; easing: string; keyframes: ComputedKeyframe[] }
>();

// A layer = one element in the grabbed subtree that carries animations.
// Motion usually lives on small descendants, not the wrapper you grab —
// so the player collects the whole subtree and shows it as layers.
interface LayerInfo {
  el: Element;
  label: string;
  infos: AnimInfo[];
}

const KEYFRAME_META = new Set(["offset", "computedOffset", "easing", "composite"]);

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

function toAnimInfo(anim: Animation): AnimInfo | null {
  const effect = anim.effect;
  if (!(effect instanceof KeyframeEffect)) return null;
  const timing = effect.getTiming();
  const duration = typeof timing.duration === "number" ? timing.duration : 0;
  if (!duration) return null;
  const name =
    "animationName" in anim
      ? String((anim as CSSAnimation).animationName)
      : "transitionProperty" in anim
        ? String((anim as CSSTransition).transitionProperty)
        : anim.id || "animation"; // recorded replicas carry their source in id

  const keyframes = effect.getKeyframes();
  const byProp = new Map<string, number[]>();
  for (const kf of keyframes) {
    const offset = (kf.computedOffset ?? kf.offset ?? 0) as number;
    for (const key of Object.keys(kf)) {
      if (KEYFRAME_META.has(key) || kf[key] == null) continue;
      byProp.set(key, [...(byProp.get(key) ?? []), offset]);
    }
  }
  // CSS puts animation-timing-function on the keyframes, not the effect
  const easing = String(keyframes[0]?.easing ?? timing.easing ?? "linear");
  let orig = FIRST_SEEN.get(anim);
  if (!orig) {
    orig = { duration, easing, keyframes };
    FIRST_SEEN.set(anim, orig);
  }
  return {
    anim,
    name,
    delay: timing.delay ?? 0,
    duration,
    iterations: typeof timing.iterations === "number" ? timing.iterations : 1,
    easing,
    origDuration: orig.duration,
    origEasing: orig.easing,
    tracks: decomposeTransformTrack(
      [...byProp].map(([prop, offsets]) => ({ prop: kebab(prop), key: prop, offsets })),
      keyframes,
      effect.target instanceof Element ? effect.target : null
    ),
  };
}

function inspectLayers(root: Element): LayerInfo[] {
  let anims: Animation[] = [];
  try {
    anims = root.getAnimations({ subtree: true });
  } catch {}
  const byEl = new Map<Element, Animation[]>();
  for (const anim of anims) {
    const target =
      anim.effect instanceof KeyframeEffect ? anim.effect.target : null;
    if (!(target instanceof Element)) continue;
    byEl.set(target, [...(byEl.get(target) ?? []), anim]);
  }
  const layers: LayerInfo[] = [];
  for (const [el, list] of byEl) {
    const infos = list
      .map(toAnimInfo)
      .filter((i): i is AnimInfo => i !== null);
    if (infos.length) layers.push({ el, label: labelFor(el), infos });
  }
  return layers;
}

// ── Onion skin sampling ──

interface GhostFrame {
  styles: Record<string, string>;
  // Animated descendants, frozen at the same instant. A ghost is a deep
  // clone, and a cloned child keeps its animation classes — without this
  // the children of a paused scene keep moving inside their ghosts.
  // Indexed into the layer element's descendant list (document order).
  inner: { i: number; styles: Record<string, string> }[];
  alpha: number;
  // Scene time the frame was sampled at (ms) — rendered as a label so
  // the copied screenshot carries real timing numbers
  t: number;
}

// Layout position via the offsetParent chain — the element's untransformed
// document position, so each ghost can carry the sampled transform itself.
// SVG elements have no offset APIs: neutralize the element's own transform
// for the read (inline !important outranks the animations cascade level)
// and measure the client rect instead
function layoutRect(el: HTMLElement | SVGElement) {
  if (el instanceof HTMLElement) {
    let x = 0;
    let y = 0;
    let node: HTMLElement | null = el;
    while (node) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }
  const prev = el.style.getPropertyValue("transform");
  const prevPrio = el.style.getPropertyPriority("transform");
  el.style.setProperty("transform", "none", "important");
  const r = el.getBoundingClientRect();
  if (prev) el.style.setProperty("transform", prev, prevPrio);
  else el.style.removeProperty("transform");
  return {
    x: r.left + window.scrollX,
    y: r.top + window.scrollY,
    w: r.width,
    h: r.height,
  };
}

// The route of every outermost animated object across its whole window, in
// document coordinates. Seeks the scene like the ghost sampler does and puts
// it back exactly as found — playing or paused, at the same time.
type RoutePoint = { x: number; y: number; t: number };
function sampleRoutes(
  layers: LayerInfo[],
  allAnims: Animation[],
  span: number
): RoutePoint[][] {
  const prev = allAnims.map((a) => ({
    time: Number(a.currentTime ?? 0),
    running: a.playState === "running",
  }));
  const drawable = layers.filter(
    (l) => l.el instanceof HTMLElement || l.el instanceof SVGElement
  );
  const roots = drawable.filter(
    (l) => !drawable.some((o) => o !== l && o.el.contains(l.el))
  );
  const routes: RoutePoint[][] = [];
  for (const layer of roots) {
    let start = Infinity;
    let end = 0;
    for (const info of layer.infos) {
      const timing =
        info.anim.effect instanceof KeyframeEffect ? info.anim.effect.getTiming() : null;
      const delay = typeof timing?.delay === "number" ? timing.delay : info.delay;
      const dur = typeof timing?.duration === "number" ? timing.duration : info.duration;
      start = Math.min(start, delay);
      end = Math.max(end, delay + dur);
    }
    start = Math.max(0, Math.min(start, span));
    end = Math.max(start, Math.min(end, span));
    if (end <= start) continue;
    const leaf = paintedLeaf(layer.el);
    const pts: RoutePoint[] = [];
    for (let i = 0; i < PATH_SAMPLES; i++) {
      const t = Math.min(end - 1e-3, start + ((end - start) * i) / (PATH_SAMPLES - 1));
      for (const a of allAnims) {
        a.pause();
        a.currentTime = t;
      }
      const r = leaf.getBoundingClientRect();
      pts.push({
        x: r.left + r.width / 2 + window.scrollX,
        y: r.top + r.height / 2 + window.scrollY,
        t,
      });
    }
    // An object that never leaves its spot (opacity pulses, colour cycles)
    // has no route worth drawing
    const moves = pts.some((q) => Math.hypot(q.x - pts[0].x, q.y - pts[0].y) > 1);
    if (moves) routes.push(pts);
  }
  for (let i = 0; i < allAnims.length; i++) {
    allAnims[i].currentTime = prev[i].time;
    if (prev[i].running) allAnims[i].play();
  }
  return routes;
}

// Ghosts for one layer: trail frames sampled across the layer's own
// active window, or — when the frames never move — a filmstrip resampled
// at shared scene times so staggered siblings show their real phase shift
interface LayerGhosts {
  frames: GhostFrame[];
  strip: boolean;
}

// Samples per layer for the motion path — fine enough that a 600ms hop
// inside a 4s loop still reads as a curve, not a polygon
const PATH_SAMPLES = 96;

// The element whose pixels actually move: the innermost animated leaf if the
// layer wraps one (a mover around a hopper around a ball), else the layer
// itself. Its client rect composes every ancestor transform.
function paintedLeaf(el: Element): Element {
  let leaf: Element | null = null;
  el.querySelectorAll("*").forEach((kid) => {
    if (leaf || kid.children.length) return;
    try {
      if (kid.getAnimations().length) leaf = kid;
    } catch {}
  });
  return leaf ?? el;
}

// The route as an SVG polyline, faint at the start of the window and solid
// by its end — the same time-order gradient the ghosts use, so direction
// reads without arrows. Sized to the path's bounding box, not the page.
function buildPathSvg(points: { x: number; y: number }[]): SVGSVGElement {
  const PAD = 4;
  const minX = Math.min(...points.map((p) => p.x)) - PAD;
  const minY = Math.min(...points.map((p) => p.y)) - PAD;
  const maxX = Math.max(...points.map((p) => p.x)) + PAD;
  const maxY = Math.max(...points.map((p) => p.y)) + PAD;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", String(maxX - minX));
  svg.setAttribute("height", String(maxY - minY));
  svg.style.cssText = `position:absolute;left:${minX}px;top:${minY}px;overflow:visible;pointer-events:none;`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    // A seam (a loop jumping from its exit back to its entry) is not travel
    if (Math.hypot(b.x - a.x, b.y - a.y) > 400) continue;
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", String(a.x - minX));
    line.setAttribute("y1", String(a.y - minY));
    line.setAttribute("x2", String(b.x - minX));
    line.setAttribute("y2", String(b.y - minY));
    line.setAttribute("stroke", "#52525b");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("opacity", String(0.22 + 0.63 * (i / (points.length - 1))));
    svg.appendChild(line);
  }
  return svg;
}

function sampleScene(
  layers: LayerInfo[],
  allAnims: Animation[],
  span: number,
  // Scene time the onion skin was switched on at — ghosts sit around it
  now: number
): Map<LayerInfo, LayerGhosts> {
  const prev = allAnims.map((a) => ({
    time: a.currentTime,
    running: a.playState === "running",
  }));
  const result = new Map<LayerInfo, LayerGhosts>();
  const drawable = layers.filter(
    (l) => l.el instanceof HTMLElement || l.el instanceof SVGElement
  );
  // A ghost is a deep clone frozen at the sampled instant, so a wrapper's
  // ghost already carries the pose of every animated layer inside it.
  // Ghosting those inner layers as well paints the same object again for
  // each nesting level — a stack of wrappers around one ball drew it four
  // times per step. Keep the outermost layer of each chain only.
  const targets = drawable
    .filter((l) => !drawable.some((o) => o !== l && o.el.contains(l.el)))
    .slice(0, MAX_GHOST_LAYERS);

  const sampleAt = (layer: LayerInfo, t: number, alpha: number): GhostFrame => {
    for (const a of allAnims) {
      a.pause();
      a.currentTime = t;
    }
    const cs = getComputedStyle(layer.el);
    const styles: Record<string, string> = {};
    // track.prop is a display name (may be a decomposed label like
    // "x position") — the real CSS property comes from track.key
    for (const info of layer.infos)
      for (const track of info.tracks) {
        const cssProp = kebab(track.key);
        styles[cssProp] = cs.getPropertyValue(cssProp);
      }
    // Descendants with animations of their own: read whichever properties
    // their keyframes touch, as computed right now (the scene is seeked to t)
    const inner: GhostFrame["inner"] = [];
    const kids = layer.el.querySelectorAll("*");
    kids.forEach((kid, i) => {
      let anims: Animation[] = [];
      try {
        anims = kid.getAnimations();
      } catch {}
      if (!anims.length) return;
      const props = new Set<string>();
      for (const a of anims) {
        if (!(a.effect instanceof KeyframeEffect)) continue;
        for (const kf of a.effect.getKeyframes())
          for (const key of Object.keys(kf))
            if (!KEYFRAME_META.has(key) && kf[key] != null) props.add(kebab(key));
      }
      if (!props.size) return;
      const kcs = getComputedStyle(kid);
      const snap: Record<string, string> = {};
      for (const prop of props) snap[prop] = kcs.getPropertyValue(prop);
      inner.push({ i, styles: snap });
    });
    return { styles, inner, alpha, t };
  };

  for (const layer of targets) {
    // Live timing (duration edits included) — union across the layer's anims
    let start = Infinity;
    let end = 0;
    for (const info of layer.infos) {
      const timing =
        info.anim.effect instanceof KeyframeEffect
          ? info.anim.effect.getTiming()
          : null;
      const delay = typeof timing?.delay === "number" ? timing.delay : info.delay;
      const dur =
        typeof timing?.duration === "number" ? timing.duration : info.duration;
      start = Math.min(start, delay);
      end = Math.max(end, delay + dur);
    }
    start = Math.max(0, Math.min(start, span));
    end = Math.max(start, Math.min(end, span));
    if (end === start) {
      start = 0;
      end = span;
    }

    // Ghosts sit around the instant the onion skin came on: ONION_STEPS
    // before it and ONION_STEPS after, at a fixed step — a slice of the
    // motion either side of *now*, not a summary of the whole cycle. The
    // step scales with the layer's own window so a short hop and a long
    // drift both get a readable slice; the instant itself is not ghosted,
    // the live element already stands there.
    const win = end - start;
    const step = Math.min(250, Math.max(30, win / 24));
    // Looping layers wrap around their window; a one-shot clamps to it
    const loops = layer.infos.some((i) => i.iterations > 1);
    const timeAt = (k: number) => {
      const t = now + k * step;
      if (loops && win > 0) return start + (((t - start) % win) + win) % win;
      return Math.min(end - 1e-3, Math.max(start, t));
    };
    const offsets = [];
    for (let k = -ONION_STEPS; k <= ONION_STEPS; k++) if (k !== 0) offsets.push(k);
    // Opacity encodes time order: faintest = earliest, strongest = latest
    const frames = offsets.map((k, i) =>
      sampleAt(layer, timeAt(k), 0.18 + 0.67 * (i / (offsets.length - 1)))
    );

    // A layer whose frames all share one pose (opacity pulses, colour
    // cycles) would stack its ghosts into one pile — those render as a
    // filmstrip below the element instead. The pose is the layer's own
    // transform AND its animated descendants': a wrapper that only moves
    // in x is standing still while the ball inside it bounces, and those
    // ghosts belong at the bounce, not in a strip.
    const pose = (f: GhostFrame) =>
      (f.styles.transform ?? "none") +
      "|" +
      f.inner.map((k) => `${k.i}:${k.styles.transform ?? ""}`).join(";");
    const strip = frames.every((f) => pose(f) === pose(frames[0]));
    result.set(layer, { frames, strip });
  }

  for (let i = 0; i < allAnims.length; i++) {
    allAnims[i].currentTime = prev[i].time;
    if (prev[i].running) allAnims[i].play();
  }
  return result;
}

// ── Component ──

interface MotionPlayerProps {
  grab: GrabbedElement;
  onClose: () => void;
  // Promote a layer to the (single) selection
  onSelectLayer: (el: Element) => void;
  // Check pressed: badges pinned — close the panel and drop the selection
  onCommit: () => void;
}

function fmtTime(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

// Fold unbounded currentTime (infinite iterations) into one visual cycle
function foldTime(span: number, t: number): number {
  if (!span || t <= span) return Math.max(0, t);
  return t % span;
}

// Same look and feel as the toolbar's icon buttons — the shared
// [data-penseat-btn] hover/active rules come from the toolbar's stylesheet
const btnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  flexShrink: 0,
  cursor: "pointer",
  border: "none",
  outline: "none",
  padding: 0,
  borderRadius: 6,
  backgroundColor: "transparent",
  color: "#a1a1aa",
  transition: "all 150ms",
};

// Duration + ease chips split the EDIT_COL evenly (52 + 4 gap + 52),
// so together they line up flush with the speed circles above
const chipStyle = (edited: boolean): React.CSSProperties => ({
  width: 52,
  height: 18,
  boxSizing: "border-box",
  fontFamily: "monospace",
  fontSize: 10,
  lineHeight: 1,
  // Top-biased padding: ease labels are all-lowercase ("bezier", "in-out"),
  // whose ink mass sits at x-height — a line-box-centered label reads ~1px
  // low next to the digit-filled duration chip. Lift it one optical pixel.
  padding: "2px 0 4px",
  borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.14)",
  backgroundColor: "#27272a",
  color: edited ? "#f4f4f5" : "#a1a1aa",
  cursor: "pointer",
  whiteSpace: "nowrap",
  textAlign: "center",
});

// Duration chip and its edit input share this exact box — swapping
// between them must not shift the row
const durBoxStyle: React.CSSProperties = {
  width: 52,
  height: 18,
  boxSizing: "border-box",
  fontFamily: "monospace",
  fontSize: 10,
  lineHeight: "10px",
  padding: "3px 4px",
  borderRadius: 4,
  // Longhand border — states override borderColor, and React warns when
  // a longhand toggles against a shorthand
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.14)",
  backgroundColor: "#27272a",
  textAlign: "center",
  whiteSpace: "nowrap",
  outline: "none",
};

// ── Dial view building blocks ──
//
// A single tuned object treats its motion as the thing being adjusted, not a
// timeline being edited: each parameter is a dial. The dial is a Figma-style
// scrub field — drag to sweep the value while the animation runs, click to
// type it exactly.

const dialBoxStyle: React.CSSProperties = {
  minWidth: 76,
  height: 26,
  boxSizing: "border-box",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "monospace",
  fontSize: 12,
  padding: "0 10px",
  borderRadius: 6,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.14)",
  backgroundColor: "#27272a",
  color: "#e4e4e7",
  whiteSpace: "nowrap",
  outline: "none",
  userSelect: "none",
  textAlign: "center",
};

function ScrubDial({ value, active, format, parse, onApply, min, max, perPx, bare }: {
  value: number;
  // Edited away from the original — brightens like the timeline chips
  active: boolean;
  format: (v: number) => string;
  parse: (s: string) => number | null;
  onApply: (v: number) => void;
  min: number;
  max: number;
  // Value change per horizontal pixel of drag
  perPx: number;
  // Unboxed: reads as plain text in a table cell, a soft fill on hover
  bare?: boolean;
}) {
  const box = bare ? bareDialStyle : dialBoxStyle;
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ startX: number; base: number; moved: boolean } | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));
  if (editing)
    return (
      <input
        autoFocus
        defaultValue={format(value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            const v = parse(e.currentTarget.value.trim());
            if (v != null) onApply(clamp(v));
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={(e) => {
          const v = parse(e.currentTarget.value.trim());
          if (v != null) onApply(clamp(v));
          setEditing(false);
        }}
        style={{
          ...box,
          width: bare ? 64 : 90,
          borderColor: "rgba(255,255,255,0.35)",
          color: "#f4f4f5",
          userSelect: "text",
        }}
      />
    );
  return (
    <span
      title="Drag to adjust · click to type"
      onPointerDown={(e) => {
        e.preventDefault();
        drag.current = { startX: e.clientX, base: value, moved: false };
        // Throws when the pointer is already gone (lifted pen, synthetic
        // events); the drag still works, just without capture
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {}
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.startX;
        if (!d.moved && Math.abs(dx) < 3) return;
        d.moved = true;
        onApply(clamp(d.base + dx * perPx));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        // A clean click (no sweep) opens exact entry
        if (d && !d.moved) setEditing(true);
      }}
      {...(bare ? { "data-penseat-dial": "" } : {})}
      style={{
        ...box,
        cursor: "ew-resize",
        touchAction: "none",
        color: active ? "#fafafa" : bare ? "#d4d4d8" : "#a1a1aa",
        ...(active && !bare ? { borderColor: "rgba(255,255,255,0.3)" } : {}),
      }}
    >
      {format(value)}
    </span>
  );
}


// Table-cell flavor of the dial: no box, the value is the control. Pulled
// left by its padding so the digits line up with the column header.
const bareDialStyle: React.CSSProperties = {
  ...dialBoxStyle,
  minWidth: 0,
  height: 22,
  padding: "0 6px",
  marginLeft: -6,
  justifyContent: "flex-start",
  borderColor: "transparent",
  backgroundColor: "transparent",
  borderRadius: 5,
};

const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// Dial view geometry — shared with the timeline's body height so the
// two views swap without the panel growing or shrinking
const TRACKS_MAX_H = 190;
const DIAL_PAD = 4;
const DIAL_HEAD_H = 22;
const DIAL_ROW_H = 36;

// ── Dial view: the motion as a curve ──
//
// Each row draws its property's value over one cycle, so a 120% hop looks
// taller before you even press play. Sampled by replaying the keyframes on
// a hidden probe (margin-left carries the number), so per-keyframe easing,
// steps and springs all come out exactly as the browser runs them.

const CURVE_SAMPLES = 96;
const curveCache = new Map<string, number[] | null>();
let curveProbe: HTMLDivElement | null = null;

// The number a track holds at one keyframe — its own slot of a split
// transform, opacity, or any plain length/number. null: not plottable.
function trackNumber(raw: string, track: PropTrack): number | null {
  let v = raw;
  if (track.slot != null && track.sig) {
    const parsed = parseTransformList(raw);
    if (!parsed) return null;
    v = parsed.length === 0
      ? TRANSFORM_IDENTITY[track.sig[track.slot]] ?? ""
      : parsed[track.slot]?.arg ?? "";
    v = v.split(",")[track.argIndex ?? 0] ?? "";
  }
  const m = /^\s*(-?\d*\.?\d+)([a-z%]*)\s*$/i.exec(v);
  return m ? parseFloat(m[1]) : null;
}

function sampleCurve(
  keyframes: ComputedKeyframe[],
  track: PropTrack,
  effectEasing: string
): number[] | null {
  if (typeof document === "undefined") return null;
  const frames: Keyframe[] = [];
  for (const kf of keyframes) {
    if (kf[track.key] == null) continue;
    const n = trackNumber(String(kf[track.key]), track);
    if (n == null) return null;
    // Screen y grows downward; up should read as up
    const v = track.prop.startsWith("y position") ? -n : n;
    frames.push({
      offset: (kf.computedOffset ?? kf.offset ?? 0) as number,
      easing: kf.easing ?? "linear",
      marginLeft: `${v * 100}px`,
    });
  }
  if (frames.length < 2) return null;
  const key = JSON.stringify(frames) + effectEasing;
  if (curveCache.has(key)) return curveCache.get(key)!;
  if (!curveProbe || !curveProbe.isConnected) {
    curveProbe = document.createElement("div");
    curveProbe.setAttribute("data-penseat", "curve-probe");
    curveProbe.setAttribute("aria-hidden", "true");
    Object.assign(curveProbe.style, {
      position: "fixed", left: "-99px", top: "0", width: "1px", height: "1px",
      visibility: "hidden", pointerEvents: "none", contain: "strict",
    });
    document.body.appendChild(curveProbe);
  }
  let out: number[] | null = [];
  let probe: Animation | null = null;
  try {
    probe = curveProbe.animate(frames, { duration: 1000, fill: "both", easing: effectEasing });
    probe.pause();
    const cs = getComputedStyle(curveProbe);
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      probe.currentTime = (i / CURVE_SAMPLES) * 1000;
      out.push(parseFloat(cs.marginLeft) / 100);
    }
    if (out.some((n) => !isFinite(n))) out = null;
  } catch {
    out = null;
  }
  probe?.cancel();
  if (curveCache.size > 300) curveCache.clear();
  curveCache.set(key, out);
  return out;
}

function MotionCurve({ cur, orig, progress, onSeek }: {
  cur: number[];
  // The baseline, drawn faint behind an edited curve
  orig: number[] | null;
  progress: number;
  onSeek: (p: number) => void;
}) {
  const H = 22;
  const all = orig ? [...cur, ...orig] : cur;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const range = hi - lo;
  const y = (v: number) => (range < 1e-6 ? H / 2 : 2 + (1 - (v - lo) / range) * (H - 4));
  const path = (vals: number[]) =>
    vals.map((v, i) => `${i ? "L" : "M"}${((i / (vals.length - 1)) * 100).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
  const n = cur.length - 1;
  const p = Math.min(1, Math.max(0, progress));
  const fi = p * n;
  const i0 = Math.floor(fi);
  const at = cur[i0] + (cur[Math.min(n, i0 + 1)] - cur[i0]) * (fi - i0);
  const played = cur.slice(0, i0 + 1).concat(at);
  const playedPath = played
    .map((v, i) => {
      const x = i === played.length - 1 ? p * 100 : (i / n) * 100;
      return `${i ? "L" : "M"}${x.toFixed(2)} ${y(v).toFixed(2)}`;
    })
    .join(" ");
  const seekFrom = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const line = { fill: "none", vectorEffect: "non-scaling-stroke" as const, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  return (
    <div
      title="Drag to scrub"
      onPointerDown={(e) => {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
        seekFrom(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFrom(e);
      }}
      style={{ position: "relative", width: "100%", height: H, cursor: "ew-resize", touchAction: "none" }}
    >
      <svg width="100%" height={H} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {orig && <path d={path(orig)} {...line} stroke="rgba(255,255,255,0.16)" strokeWidth={1.25} strokeDasharray="2 3" />}
        <path d={path(cur)} {...line} stroke="rgba(255,255,255,0.3)" strokeWidth={1.25} />
        <path d={playedPath} {...line} stroke="#e4e4e7" strokeWidth={1.5} />
      </svg>
      <div style={{ position: "absolute", left: `${p * 100}%`, top: -4, bottom: -4, width: 1, marginLeft: -0.5, backgroundColor: "rgba(255,255,255,0.18)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: `${p * 100}%`, top: y(at), width: 5, height: 5, margin: "-2.5px 0 0 -2.5px", borderRadius: 999, backgroundColor: "#fafafa", pointerEvents: "none" }} />
    </div>
  );
}

// How far the motion goes, 0–300%, with a notch at 100%. Snaps to 100
// when it passes near, so getting back to the original is easy.
function AmountSlider({ value, onApply }: { value: number; onApply: (v: number) => void }) {
  const MAX = 300;
  const set = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let v = Math.round(((e.clientX - r.left) / r.width) * MAX);
    v = Math.min(MAX, Math.max(0, v));
    if (Math.abs(v - 100) <= 6) v = 100;
    onApply(v);
  };
  const f = Math.min(1, Math.max(0, value / MAX)) * 100;
  return (
    <div
      onPointerDown={(e) => {
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
        set(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) set(e);
      }}
      style={{ position: "relative", flex: "none", width: 64, height: 18, cursor: "pointer", touchAction: "none" }}
    >
      <div style={{ position: "absolute", left: 0, right: 0, top: 8, height: 2, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.1)" }} />
      <div style={{ position: "absolute", left: `${100 / 3}%`, top: 5, width: 1, height: 8, backgroundColor: "rgba(255,255,255,0.25)" }} />
      <div style={{ position: "absolute", left: 0, width: `${f}%`, top: 8, height: 2, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.45)" }} />
      <div style={{ position: "absolute", left: `${f}%`, top: 4, width: 10, height: 10, marginLeft: -5, borderRadius: 999, backgroundColor: "#f4f4f5" }} />
    </div>
  );
}

const PRESET_BEZIERS: Record<string, Bezier> = {
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

// A thumbnail of the easing curve beside its name
function EaseGlyph({ easing }: { easing: string }) {
  const W = 14, H = 10;
  let d: string;
  const bz = easing.startsWith("cubic-bezier") ? parseBezier(easing) : PRESET_BEZIERS[easing];
  if (bz) {
    const X = (x: number) => (1 + x * (W - 2)).toFixed(2);
    const Y = (y: number) => (H - 1 - y * (H - 2)).toFixed(2);
    d = `M${X(0)} ${Y(0)} C${X(bz[0])} ${Y(bz[1])}, ${X(bz[2])} ${Y(bz[3])}, ${X(1)} ${Y(1)}`;
  } else if (easing.startsWith("linear(")) {
    d = `M1 9 C4 -1, 6 3, 8 1.5 S11 1, 13 1`; // spring: overshoot and settle
  } else if (easing.startsWith("steps")) {
    d = `M1 9 H5 V5 H9 V1 H13`;
  } else {
    d = `M1 ${H - 1} L${W - 1} 1`;
  }
  return (
    <svg width={W} height={H} style={{ flex: "none", overflow: "visible" }}>
      <path d={d} fill="none" stroke="#71717a" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Small pill switch (speed, dials/timeline)
function Segmented<T extends string | number>({ options, value, onChange, title }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  title?: (v: T) => string;
}) {
  return (
    <span style={{ display: "inline-flex", flex: "none", padding: 2, borderRadius: 7, backgroundColor: "rgba(255,255,255,0.05)" }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          title={title?.(o.value)}
          onClick={() => onChange(o.value)}
          {...(o.value === value ? {} : { "data-penseat-seg": "" })}
          style={{
            border: "none",
            outline: "none",
            cursor: "pointer",
            height: 20,
            padding: "0 7px",
            borderRadius: 5,
            fontFamily: "inherit",
            fontSize: 10.5,
            color: o.value === value ? "#f4f4f5" : "#71717a",
            backgroundColor: o.value === value ? "rgba(255,255,255,0.1)" : "transparent",
            transition: "color 150ms",
          }}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

interface KeyframeValueEdit {
  prop: string;
  offsetPct: number;
  from: string;
  to: string;
}

interface TimingEdit {
  duration?: number;
  easing?: string;
  spring?: SpringParams;
  keyframes?: KeyframeValueEdit[];
  // Keyframe timing drags: offset fraction from -> to
  moves?: { prop: string; from: number; to: number }[];
}

// Old -> new lines for one animation's accumulated edits
function editLines(info: AnimInfo, e: TimingEdit): string[] {
  const lines: string[] = [];
  if (e.duration != null && Math.round(e.duration) !== Math.round(info.origDuration))
    lines.push(
      `duration: ${fmtTime(info.origDuration)} -> ${fmtTime(e.duration)}${e.spring ? " (spring natural duration)" : ""}`
    );
  if (e.easing != null && e.easing !== info.origEasing) {
    if (e.spring) {
      lines.push(
        `easing: ${info.origEasing} -> spring (stiffness ${e.spring.stiffness}, damping ${e.spring.damping}, mass ${e.spring.mass})`
      );
      lines.push(`  CSS equivalent: ${e.easing}`);
    } else lines.push(`easing: ${info.origEasing} -> ${e.easing}`);
  }
  for (const k of (e.keyframes ?? []).filter((k) => k.from !== k.to))
    lines.push(`keyframe ${k.offsetPct}% ${k.prop}: ${k.from} -> ${k.to}`);
  for (const m of (e.moves ?? []).filter((m) => Math.abs(m.from - m.to) > 0.002))
    lines.push(
      `keyframe timing (${m.prop}): ${Math.round(m.from * 100)}% -> ${Math.round(m.to * 100)}%`
    );
  return lines;
}

// Ground-truth badge lines: the animation's CURRENT state diffed against
// its first-seen original. Rebuilt at every check, so badges accumulate
// across sessions and lines reverted by hand disappear on their own.
function diffAgainstOriginal(
  anim: Animation,
  oneXDuration: number,
  spring: SpringParams | undefined
): string[] {
  const orig = FIRST_SEEN.get(anim);
  const effect = anim.effect;
  if (!orig || !(effect instanceof KeyframeEffect)) return [];
  const lines: string[] = [];
  if (Math.round(oneXDuration) !== Math.round(orig.duration))
    lines.push(
      `duration: ${fmtTime(orig.duration)} -> ${fmtTime(oneXDuration)}${spring ? " (spring natural duration)" : ""}`
    );
  let cur: ComputedKeyframe[] = [];
  try {
    cur = effect.getKeyframes();
  } catch {
    return lines;
  }
  const curEase = String(cur[0]?.easing ?? "linear");
  if (curEase !== orig.easing) {
    if (spring) {
      lines.push(
        `easing: ${orig.easing} -> spring (stiffness ${spring.stiffness}, damping ${spring.damping}, mass ${spring.mass})`
      );
      lines.push(`  CSS equivalent: ${curEase}`);
    } else lines.push(`easing: ${orig.easing} -> ${curEase}`);
  }
  const props = new Set<string>();
  for (const kf of [...orig.keyframes, ...cur])
    for (const k of Object.keys(kf))
      if (!KEYFRAME_META.has(k) && kf[k] != null) props.add(k);
  for (const key of props) {
    const pick = (kfs: ComputedKeyframe[]) =>
      kfs
        .filter((kf) => kf[key] != null)
        .map((kf) => ({
          off: (kf.computedOffset ?? kf.offset ?? 0) as number,
          val: String(kf[key]),
        }));
    const o = pick(orig.keyframes);
    const c = pick(cur);
    for (let i = 0; i < Math.min(o.length, c.length); i++) {
      if (Math.abs(o[i].off - c[i].off) > 0.002)
        lines.push(
          `keyframe timing (${kebab(key)}): ${Math.round(o[i].off * 100)}% -> ${Math.round(c[i].off * 100)}%`
        );
      if (o[i].val !== c[i].val)
        lines.push(
          `keyframe ${Math.round(c[i].off * 100)}% ${kebab(key)}: ${o[i].val} -> ${c[i].val}`
        );
    }
  }
  return lines;
}

// Values that should render as a color chip
function isColorValue(value: string): boolean {
  return /^(#|rgb|hsl|oklch|oklab|color\()/.test(value.trim());
}

// input[type=color] only accepts #rrggbb
function toHexColor(value: string): string {
  const m = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) {
    const h = (n: string) => parseInt(n).toString(16).padStart(2, "0");
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim();
  if (/^#[0-9a-f]{3}$/i.test(value.trim())) {
    const v = value.trim();
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }
  return "#000000";
}

export default function MotionPlayer({ grab, onClose, onSelectLayer, onCommit }: MotionPlayerProps) {
  const layers = useMemo(() => inspectLayers(grab.el), [grab.el]);
  const allInfos = useMemo(() => layers.flatMap((l) => l.infos), [layers]);
  const allAnims = useMemo(() => allInfos.map((i) => i.anim), [allInfos]);
  // One animated object → dial view; a scene of several → timeline view.
  // "One object" means one nesting chain: a ball built from a mover, a
  // hopper, a squasher and a spinner stacked inside each other is still one
  // thing to tune, so it counts by outermost layers, not by layers.
  const solo =
    layers.filter((l) => !layers.some((o) => o !== l && o.el.contains(l.el))).length === 1;

  // Live timing edits, keyed by animation index — originals stay on allInfos
  const [edits, setEdits] = useState<Map<number, TimingEdit>>(new Map());
  const effDur = (idx: number) =>
    edits.get(idx)?.duration ?? allInfos[idx]?.duration ?? 0;
  const effEase = (idx: number) =>
    edits.get(idx)?.easing ?? allInfos[idx]?.easing ?? "linear";

  const span = Math.max(0, ...allInfos.map((i, idx) => i.delay + effDur(idx)));

  const [playing, setPlaying] = useState(() =>
    allAnims.some((a) => a.playState === "running")
  );
  const [time, setTime] = useState(() =>
    foldTime(span, Number(allAnims[0]?.currentTime ?? 0))
  );
  const [onion, setOnion] = useState(false);
  // Folded down to header + transport: the scrubber and its ruler stay, the
  // layer tracks go. The scene stays exactly as it is — paused, onion ghosts
  // and all — the panel just takes less of the page.
  const [minimized, setMinimized] = useState(false);
  // Layer row being hovered — highlights the element on the page
  const [layerRect, setLayerRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // Section header under the pointer — headers select their layer too
  const [hotHeader, setHotHeader] = useState<number | null>(null);
  // Folded sections, by group label
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Attribute-family groups (position, scale…) start folded to their
  // summary row; expanding reveals the per-axis tracks
  const [expandedFams, setExpandedFams] = useState<Set<string>>(new Set());
  // Scene speed buttons — slow-motion presets that scale every layer's
  // duration against a snapshot; 1x restores the snapshot
  const [speed, setSpeed] = useState(1);
  const speedBase = useRef<Map<number, number> | null>(null);

  // Keyframe value editing
  const [kfBump, setKfBump] = useState(0); // re-render after keyframe writes
  const [kfEdit, setKfEdit] = useState<{ infoIdx: number; key: string; occ: number } | null>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const dragKf = useRef<{ infoIdx: number; key: string; prop: string; occ: number; lane: HTMLElement; from: number; moved: boolean; startX: number } | null>(null);
  const tapTimer = useRef<{ key: string; timer: number } | null>(null);
  const pendingColor = useRef<{ infoIdx: number; key: string; prop: string; occ: number } | null>(null);

  // Timing editor UI state
  const [durEditIdx, setDurEditIdx] = useState<number | null>(null);
  // Solo objects open on dials; the timeline stays reachable for
  // keyframe-level work (values, colors, per-keyframe retiming)
  const [showTimeline, setShowTimeline] = useState(false);
  const [easeMenu, setEaseMenu] = useState<{ idx: number; x: number; y: number; custom: boolean; spring: SpringParams | null; bezier: Bezier | null } | null>(null);
  const bzDrag = useRef<1 | 2 | null>(null);
  const scrubbing = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const routeRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Wheel over the panel must not scroll the page underneath. The track
  // list handles its own scrolling (overscroll contained); everywhere
  // else we swallow the wheel. Native listener — React's onWheel is
  // passive and can't preventDefault.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onWheel = (e: WheelEvent) => {
      if (tracksRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
    };
    panel.addEventListener("wheel", onWheel, { passive: false });
    return () => panel.removeEventListener("wheel", onWheel);
  }, []);
  // Actual scrollbar-gutter width of the track list — the scrubber row
  // gets the same right inset so both stay on one time axis
  const [gutter, setGutter] = useState(0);

  useEffect(() => {
    const el = tracksRef.current;
    if (el) setGutter(el.offsetWidth - el.clientWidth);
  });

  // Playhead follows the real animation clock. The tick reads the scene
  // through a ref rather than depending on allAnims/span: those are memo-
  // stable in healthy renders, but if their identity ever churns per render
  // (an HMR remount, a broken memo upstream) an effect keyed on them
  // re-subscribes on every setTime and React trips "maximum update depth".
  // Keyed on `playing` alone, the loop stays subscribed once and always
  // reads current values.
  const clockRef = useRef({ allAnims, span });
  clockRef.current = { allAnims, span };
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const { allAnims: anims, span: sp } = clockRef.current;
      const a = anims[0];
      if (a) setTime(foldTime(sp, Number(a.currentTime ?? 0)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  function playPause() {
    if (playing) {
      for (const a of allAnims) a.pause();
      setPlaying(false);
    } else {
      for (const a of allAnims) a.play();
      setPlaying(true);
    }
  }

  function restart() {
    for (const a of allAnims) {
      a.currentTime = 0;
      a.play();
    }
    setOnion(false);
    setPlaying(true);
  }

  function toggleOnion() {
    // Onion pauses the scene to study frames — leaving it resumes
    if (onion) {
      for (const a of allAnims) a.play();
      setPlaying(true);
    }
    setOnion(!onion);
  }

  // Video-player keys while the panel is up: K play/pause, O onion skin,
  // ←/→ nudge the playhead by 1% of the scene (10% with shift).
  // Matched by physical position (code), not the produced character, so
  // they work under IMEs too (Korean layouts emit "ㅏ" for K's key).
  // Re-registered each render so the handler always sees fresh state;
  // skipped while typing in an edit field or chorded with cmd/ctrl/alt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "KeyK") {
        e.preventDefault();
        playPause();
      } else if (e.code === "KeyO") {
        e.preventDefault();
        toggleOnion();
      } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        const dir = e.code === "ArrowLeft" ? -1 : 1;
        const step = span * (e.shiftKey ? 0.1 : 0.01) * dir;
        seek(Math.min(span, Math.max(0, time + step)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function seek(t: number) {
    for (const a of allAnims) {
      a.pause();
      a.currentTime = t;
    }
    setPlaying(false);
    setTime(t);
  }

  function seekFromEvent(e: React.PointerEvent) {
    const rect = barRef.current!.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seek(frac * span);
  }

  function hoverLayer(layer: LayerInfo | null) {
    if (!layer) {
      setLayerRect(null);
      return;
    }
    const r = layer.el.getBoundingClientRect();
    setLayerRect({ left: r.left, top: r.top, width: r.width, height: r.height });
  }

  // ── Live timing edits ──

  function setEdit(idx: number, patch: TimingEdit) {
    dirty.current = true;
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(idx, { ...next.get(idx), ...patch });
      return next;
    });
  }

  // Amplitude dials — per property track, as a factor of the baseline
  // (what the animation looked like when first seen, or last committed)
  const [amps, setAmps] = useState<Map<string, number>>(new Map());
  const ampKey = (idx: number, track: PropTrack) => `${idx}:${track.prop}`;
  function baselineTrackValues(idx: number, track: PropTrack): string[] {
    const anim = allInfos[idx].anim;
    const snap = COMMITTED.get(anim) ?? FIRST_SEEN.get(anim);
    if (!snap) return [];
    const raws = snap.keyframes
      .filter((kf) => kf[track.key] != null)
      .map((kf) => String(kf[track.key]));
    // Sub-tracks read their own slot out of the full transform
    return raws.map((raw) => (track.slot == null ? raw : displayValue(raw, track)));
  }
  function applyAmplitude(idx: number, track: PropTrack, k: number) {
    const neutral = amplitudeNeutral(track);
    if (neutral == null) return;
    const base = baselineTrackValues(idx, track);
    base.forEach((raw, occ) => {
      commitTrackValue(idx, track, occ, scaleAbout(raw, neutral, k));
    });
    setAmps((prev) => {
      const next = new Map(prev);
      next.set(ampKey(idx, track), k);
      return next;
    });
  }

  function applyDuration(idx: number, ms: number) {
    try {
      allInfos[idx].anim.effect?.updateTiming({ duration: ms });
      setEdit(idx, { duration: ms });
    } catch {}
  }

  // Rewrites every keyframe's easing — CSS animations carry their
  // timing function per keyframe, so this is what changes how it moves
  function applyEasing(idx: number, easing: string): boolean {
    const effect = allInfos[idx].anim.effect;
    if (!(effect instanceof KeyframeEffect)) return false;
    try {
      const next = effect.getKeyframes().map((kf) => {
        const clean: Keyframe = {
          offset: (kf.computedOffset ?? kf.offset ?? 0) as number,
          easing,
        };
        for (const key of Object.keys(kf)) {
          if (KEYFRAME_META.has(key) || kf[key] == null) continue;
          clean[key] = kf[key] as string;
        }
        return clean;
      });
      effect.setKeyframes(next);
      setEdit(idx, { easing, spring: undefined });
      return true;
    } catch {
      return false;
    }
  }

  // Spring drives both the curve and the duration (natural settle time)
  function applySpring(idx: number, params: SpringParams) {
    const { duration, easing } = simulateSpring(params);
    const effect = allInfos[idx].anim.effect;
    if (!(effect instanceof KeyframeEffect)) return;
    try {
      const next = effect.getKeyframes().map((kf) => {
        const clean: Keyframe = {
          offset: (kf.computedOffset ?? kf.offset ?? 0) as number,
          easing,
        };
        for (const key of Object.keys(kf)) {
          if (KEYFRAME_META.has(key) || kf[key] == null) continue;
          clean[key] = kf[key] as string;
        }
        return clean;
      });
      effect.setKeyframes(next);
      effect.updateTiming({ duration });
      setEdit(idx, { duration, easing, spring: params });
    } catch {}
  }

  // Live keyframe values for a track — read fresh so edits show through
  function trackValues(info: AnimInfo, key: string): string[] {
    const effect = info.anim.effect;
    if (!(effect instanceof KeyframeEffect)) return [];
    try {
      return effect
        .getKeyframes()
        .filter((kf) => kf[key] != null)
        .map((kf) => String(kf[key]));
    } catch {
      return [];
    }
  }

  // Live keyframe offsets — timing drags change them, so never trust the
  // inspect-time snapshot
  function trackOffsets(info: AnimInfo, key: string): number[] {
    const effect = info.anim.effect;
    if (!(effect instanceof KeyframeEffect)) return [];
    try {
      return effect
        .getKeyframes()
        .filter((kf) => kf[key] != null)
        .map((kf) => (kf.computedOffset ?? kf.offset ?? 0) as number);
    } catch {
      return [];
    }
  }

  // Retime one keyframe (nth carrying this key) — per-property: if the
  // keyframe also carries other properties, this property is peeled into
  // its own keyframe so only its timing moves. Clamped between the
  // neighbouring keyframes of the SAME property.
  function moveKeyframe(idx: number, key: string, occ: number, newOffset: number): number | null {
    const effect = allInfos[idx].anim.effect;
    if (!(effect instanceof KeyframeEffect)) return null;
    try {
      const kfs = effect.getKeyframes();
      const carriers: number[] = [];
      kfs.forEach((kf, i2) => {
        if (kf[key] != null) carriers.push(i2);
      });
      const kfIdx = carriers[occ];
      if (kfIdx == null) return null;
      const EPS = 0.005;
      const lo =
        occ === 0 ? 0 : ((kfs[carriers[occ - 1]].computedOffset ?? 0) as number) + EPS;
      const hi =
        occ === carriers.length - 1
          ? 1
          : ((kfs[carriers[occ + 1]].computedOffset ?? 1) as number) - EPS;
      const clamped = Math.min(Math.max(newOffset, lo), hi);

      const clean = (kf: ComputedKeyframe, offset: number): Keyframe => {
        const c: Keyframe = { offset, easing: kf.easing };
        for (const k of Object.keys(kf)) {
          if (KEYFRAME_META.has(k) || kf[k] == null) continue;
          c[k] = kf[k] as string;
        }
        return c;
      };

      const target = kfs[kfIdx];
      const targetProps = Object.keys(target).filter(
        (k) => !KEYFRAME_META.has(k) && target[k] != null
      );
      let next: Keyframe[];
      if (targetProps.length <= 1) {
        // this property is alone in the keyframe — just retime it
        next = kfs.map((kf, i2) =>
          clean(kf, i2 === kfIdx ? clamped : ((kf.computedOffset ?? 0) as number))
        );
      } else {
        // split: peel this property off; the rest stay anchored
        next = kfs.map((kf, i2) => {
          const c = clean(kf, (kf.computedOffset ?? 0) as number);
          if (i2 === kfIdx) delete (c as Record<string, unknown>)[key];
          return c;
        });
        next.push({ offset: clamped, easing: target.easing, [key]: target[key] } as Keyframe);
      }
      // setKeyframes rejects non-ascending offsets, and a retimed keyframe
      // may legitimately cross keyframes of OTHER properties (only its own
      // property's neighbours are clamp walls)
      next.sort((a, b) => (a.offset as number) - (b.offset as number));
      effect.setKeyframes(next);
      dirty.current = true;
      setKfBump((b) => b + 1);
      return clamped;
    } catch {
      return null;
    }
  }

  // Ledger a finished timing drag (chained drags keep the first origin)
  function recordKeyframeMove(idx: number, prop: string, from: number, to: number) {
    dirty.current = true;
    setEdits((prev) => {
      const map = new Map(prev);
      const entry = { ...map.get(idx) };
      // clone the entries too — this updater must stay pure (StrictMode
      // re-invokes it), so never mutate objects still referenced by prev
      let list = (entry.moves ?? []).map((m) => ({ ...m }));
      const chained = list.find((m) => Math.abs(m.to - from) < 0.005);
      if (chained) chained.to = to;
      else list.push({ prop, from, to });
      // a drag (or double-click reset) back to the origin is no edit at all
      list = list.filter((m) => Math.abs(m.to - m.from) >= 0.005);
      if (list.length) entry.moves = list;
      else delete entry.moves;
      map.set(idx, entry);
      return map;
    });
  }

  // Double-click reset — snap a keyframe back to its first-seen offset
  function resetKeyframe(idx: number, key: string, prop: string, occ: number) {
    const orig = FIRST_SEEN.get(allInfos[idx].anim);
    if (!orig) return;
    const target = orig.keyframes
      .filter((kf) => kf[key] != null)
      .map((kf) => (kf.computedOffset ?? kf.offset ?? 0) as number)[occ];
    if (target == null) return;
    const from = trackOffsets(allInfos[idx], key)[occ];
    if (from == null) return;
    if (Math.abs(from - target) >= 0.002 && moveKeyframe(idx, key, occ, target) != null)
      recordKeyframeMove(idx, prop, from, target);
    // the end keyframe doubles as the duration handle (dragging it past
    // the end stretches the layer), so resetting it also restores the
    // duration — unless slow-motion owns the duration right now
    if (
      target === 1 &&
      speed === 1 &&
      Math.round(effDur(idx)) !== Math.round(allInfos[idx].origDuration)
    )
      applyDuration(idx, Math.round(allInfos[idx].origDuration));
  }

  // Write one keyframe's value (nth keyframe carrying this property)
  function applyKeyframeValue(
    idx: number,
    key: string,
    prop: string,
    occ: number,
    value: string,
    ledgerFrom?: string,
    ledgerTo?: string
  ): boolean {
    const effect = allInfos[idx].anim.effect;
    if (!(effect instanceof KeyframeEffect)) return false;
    try {
      let from = "";
      let seen = -1;
      const next = effect.getKeyframes().map((kf) => {
        const clean: Keyframe = {
          offset: (kf.computedOffset ?? kf.offset ?? 0) as number,
          easing: kf.easing,
        };
        for (const k of Object.keys(kf)) {
          if (KEYFRAME_META.has(k) || kf[k] == null) continue;
          clean[k] = kf[k] as string;
        }
        if (kf[key] != null) {
          seen++;
          if (seen === occ) {
            from = String(kf[key]);
            clean[key] = value;
          }
        }
        return clean;
      });
      effect.setKeyframes(next);
      dirty.current = true;
      // ledger for the copy prompt — keep the first-seen "from"
      const offsetPct = Math.round((trackOffsets(allInfos[idx], key)[occ] ?? 0) * 100);
      setEdits((prev) => {
        const map = new Map(prev);
        const entry = { ...map.get(idx) };
        // clone the entries too — pure updater, see recordKeyframeMove
        const list = (entry.keyframes ?? []).map((k) => ({ ...k }));
        const existing = list.find((k) => k.prop === prop && k.offsetPct === offsetPct);
        if (existing) existing.to = ledgerTo ?? value;
        else list.push({ prop, offsetPct, from: ledgerFrom ?? from, to: ledgerTo ?? value });
        entry.keyframes = list;
        map.set(idx, entry);
        return map;
      });
      setKfBump((b) => b + 1);
      return true;
    } catch {
      return false;
    }
  }

  // Display value for a track keyframe — transform sub-tracks show just
  // their function's argument (14deg, 160px, 1.25)
  function displayValue(raw: string, track: PropTrack): string {
    // Opacity reads as a percentage
    if (track.key === "opacity") {
      const n = parseFloat(raw);
      return isFinite(n) ? `${Math.round(n * 100)}%` : raw;
    }
    if (track.slot == null) return raw;
    const parsed = parseTransformList(raw);
    if (!parsed) return raw;
    const arg =
      parsed.length === 0
        ? TRANSFORM_IDENTITY[track.sig![track.slot]] ?? ""
        : parsed[track.slot]?.arg ?? "";
    if (track.argIndex == null) return arg;
    return arg.split(",")[track.argIndex]?.trim() ?? "0px";
  }

  // Commit a keyframe value — sub-tracks reassemble the full transform
  function commitTrackValue(infoIdx: number, track: PropTrack, occ: number, newVal: string): boolean {
    // Opacity accepts "35%", "35", or "0.35" — stored as a 0–1 value
    if (track.key === "opacity") {
      const t = newVal.trim();
      const n = parseFloat(t);
      if (isFinite(n)) {
        const v = t.endsWith("%") || n > 1 ? Math.round(n) / 100 : n;
        return applyKeyframeValue(infoIdx, track.key, track.prop, occ, String(v));
      }
    }
    if (track.slot == null)
      return applyKeyframeValue(infoIdx, track.key, track.prop, occ, newVal);
    const raw = trackValues(allInfos[infoIdx], "transform")[occ] ?? "";
    const parsed = parseTransformList(raw);
    const list =
      parsed && parsed.length
        ? parsed.map((e) => ({ ...e }))
        : track.sig!.map((fn) => ({ fn, arg: TRANSFORM_IDENTITY[fn] }));
    let oldArg = list[track.slot]?.arg ?? "";
    if (track.argIndex == null) {
      list[track.slot] = { fn: track.sig![track.slot], arg: newVal };
    } else {
      // multi-argument function: replace just this axis
      const parts = (list[track.slot]?.arg ?? "").split(",").map((part) => part.trim());
      while (parts.length <= track.argIndex) parts.push("0px");
      oldArg = parts[track.argIndex];
      parts[track.argIndex] = newVal;
      list[track.slot] = { fn: track.sig![track.slot], arg: parts.join(", ") };
    }
    const full = list.map((e) => `${e.fn}(${e.arg})`).join(" ");
    return applyKeyframeValue(infoIdx, "transform", track.prop, occ, full, oldArg, newVal);
  }

  function applySpeed(v: number) {
    if (v === speed) return;
    if (v === 1) {
      // restore the durations from before slow-motion
      if (speedBase.current)
        for (const [idx, base] of speedBase.current) applyDuration(idx, base);
      speedBase.current = null;
      setSpeed(1);
      return;
    }
    if (!speedBase.current) {
      const snapshot = new Map<number, number>();
      allInfos.forEach((_, idx) => snapshot.set(idx, effDur(idx)));
      speedBase.current = snapshot;
    }
    for (const [idx, base] of speedBase.current)
      applyDuration(idx, Math.max(1, Math.round(base / v)));
    setSpeed(v);
  }

  // Anything mutated since the last check — the check commits it, and
  // closing the panel without checking rolls it all back
  const dirty = useRef(false);

  // Uncommitted changes die with the panel: on unmount, every scene
  // animation returns to its last checkpoint (or first-seen original)
  useEffect(() => {
    return () => {
      if (!dirty.current) return;
      for (const info of allInfos) restoreAnimation(info.anim);
    };
    // allInfos is stable for this player instance (memo on grab.el)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The 1x duration even while slow-motion scales the scene
  const oneXDuration = (idx: number) =>
    speed !== 1 && speedBase.current?.has(idx)
      ? speedBase.current.get(idx)!
      : effDur(idx);

  // Check pressed: rebuild badges from ground truth, snapshot the state
  // as the new checkpoint, reveal, and hand control back (close+deselect)
  function commitEdits() {
    for (const layer of layers) {
      const badges: EditBadge[] = [];
      for (const info of layer.infos) {
        const idx = allInfos.indexOf(info);
        const lines = diffAgainstOriginal(
          info.anim,
          oneXDuration(idx),
          edits.get(idx)?.spring
        );
        if (lines.length) badges.push({ name: info.name, lines });
      }
      if (badges.length) {
        EDIT_LOG.set(layer.el, badges);
        EDIT_REVEALED.add(layer.el);
      } else {
        EDIT_LOG.delete(layer.el);
        EDIT_REVEALED.delete(layer.el);
      }
    }
    for (const [idx, info] of allInfos.entries()) {
      const effect = info.anim.effect;
      if (!(effect instanceof KeyframeEffect)) continue;
      try {
        COMMITTED.set(info.anim, {
          duration: oneXDuration(idx),
          keyframes: effect.getKeyframes(),
        });
      } catch {}
    }
    dirty.current = false;
    emitEditLog();
    onCommit();
  }

  // Route: the object's path across its whole cycle, drawn whenever the
  // player is open — onion or not. It is what makes a pen stroke over the
  // screenshot read as a delta ("this is where it goes, this is where I
  // want it to go") instead of a sketch of the current motion. Redrawn
  // after edits settle, since a dial changes the route; debounced so a
  // drag doesn't seek the scene 96 times per pointer move.
  useEffect(() => {
    const container = routeRef.current;
    if (!container) return;
    const id = window.setTimeout(() => {
      container.innerHTML = "";
      for (const route of sampleRoutes(layers, allAnims, span))
        container.appendChild(buildPathSvg(route));
    }, 120);
    return () => {
      window.clearTimeout(id);
      container.innerHTML = "";
    };
  }, [layers, allAnims, span, edits, kfBump]);

  // Onion skin: pause the scene, sample every layer, render ghost clones.
  // Ghosts are NOT marked data-penseat — they are part of the screenshot.
  useEffect(() => {
    const container = ghostRef.current;
    if (!onion || !container) return;

    for (const a of allAnims) a.pause();
    setPlaying(false);

    // Sampled-time labels bake real timing numbers into the screenshot
    const fmtMs = (ms: number) => {
      const r = Math.round(ms);
      return r < 1000 ? `${r}ms` : `${+(r / 1000).toFixed(2)}s`;
    };
    const makeLabel = (text: string) => {
      const s = document.createElement("span");
      s.textContent = text;
      s.style.cssText =
        "position:absolute;font:9px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#52525b;background:rgba(255,255,255,0.85);padding:0 3px;border-radius:3px;white-space:nowrap;pointer-events:none;";
      return s;
    };

    // Anchor on the scene clock as it stands right now (the effect just
    // paused it), read straight from the animation rather than React state
    // so toggling doesn't have to wait a render
    const now = foldTime(span, Number(allAnims[0]?.currentTime ?? 0));
    const sampled = sampleScene(layers, allAnims, span, now);
    const entries = [...sampled].flatMap(([layer, ghosts]) => {
      const el = layer.el as HTMLElement | SVGElement;
      // Inner SVG nodes can't render outside an <svg> root — those ghosts
      // are positioned at the owning svg's rect and rebuilt inside a shell
      // clone of it further down
      const svgRoot =
        el instanceof SVGElement && !(el instanceof SVGSVGElement)
          ? el.ownerSVGElement
          : null;
      if (el instanceof SVGElement && !(el instanceof SVGSVGElement) && !svgRoot)
        return [];
      return [{ ghosts, el, svgRoot, base: layoutRect(svgRoot ?? el) }];
    });
    // Strips all sample the same scene times, so one time axis serves the
    // whole scene — the leftmost strip carries it
    const axis = entries
      .filter((e) => e.ghosts.strip)
      .reduce<(typeof entries)[number] | null>(
        (min, e) => (!min || e.base.x < min.base.x ? e : min),
        null
      );

    for (const { ghosts, el, svgRoot, base } of entries) {
      // A layer whose frames all share one position (opacity pulses, color
      // cycles) would stack its ghosts into one unreadable pile — those
      // arrive strip-flagged and lay out as a filmstrip below the element
      const strip = ghosts.strip;
      const ringRadius = getComputedStyle(el).borderRadius;
      ghosts.frames.forEach((frame, fi) => {
        // The ghost is an exact clone of the object at that frame:
        // the wrapper carries the sampled transform (exact position/form),
        // its opacity carries only the time-order gradient
        const wrap = document.createElement("div");
        // Inner-SVG transforms resolve in the svg's coordinate space
        // (transform-box: view-box), so they stay on the clone instead
        const wrapTransform = svgRoot ? "none" : frame.styles.transform ?? "none";
        // Strip slots encode time by position, so they keep near-full
        // strength and let the sampled opacity itself read
        const top = strip ? base.y + (fi + 1) * (base.h + 6) : base.y;
        const alpha = strip ? 0.9 : frame.alpha;
        wrap.style.cssText = `position:absolute;left:${base.x}px;top:${top}px;width:${base.w}px;height:${base.h}px;pointer-events:none;transform:${wrapTransform};opacity:${alpha};`;
        // Dashed ring marks every sampled frame — the live element is the
        // only unringed object, so a ghost sitting on top of it (a cycle's
        // first/last frame) can never pass for the element itself.
        // When the pose lives in animated descendants (a wrapper that only
        // moves in x around a ball that hops and squashes), the wrapper's
        // box says nothing about where the object is — ring the painted
        // leaves inside instead, further down once the clone exists.
        const ringLeaves = frame.inner.length > 0;
        if (!ringLeaves) {
          wrap.style.outline = "1px dashed rgba(113,113,122,0.6)";
          wrap.style.outlineOffset = "1.5px";
          if (ringRadius) wrap.style.borderRadius = ringRadius;
        }
        if (strip) {
          if (ghosts === axis?.ghosts) {
            const lbl = makeLabel(fmtMs(frame.t));
            lbl.style.right = "100%";
            lbl.style.marginRight = "6px";
            lbl.style.top = "50%";
            lbl.style.transform = "translateY(-50%)";
            wrap.appendChild(lbl);
          }
        } else if (fi === 0 || fi === ghosts.frames.length - 1) {
          // Trail endpoints get their times in a separate full-opacity
          // wrapper — inside the ghost they'd inherit its faintness. When
          // the endpoints land near each other (rotations, small drifts)
          // the end label drops a line lower instead of overprinting the
          // start label.
          const txy = (tr?: string) => {
            const m = /matrix\(([^)]+)\)/.exec(tr ?? "");
            if (!m) return [0, 0];
            const p = m[1].split(",").map(Number);
            return [p[4] || 0, p[5] || 0];
          };
          const [x0, y0] = txy(ghosts.frames[0].styles.transform);
          const [x1, y1] = txy(
            ghosts.frames[ghosts.frames.length - 1].styles.transform
          );
          const crowded = fi > 0 && Math.hypot(x1 - x0, y1 - y0) < 28;
          const lw = document.createElement("div");
          lw.style.cssText = wrap.style.cssText;
          lw.style.opacity = "1";
          lw.style.outline = "none"; // the ghost itself already carries the ring
          const lbl = makeLabel(fmtMs(frame.t));
          lbl.style.top = "100%";
          lbl.style.left = "50%";
          lbl.style.transform = `translate(-50%, ${crowded ? 17 : 3}px)`;
          lw.appendChild(lbl);
          container.appendChild(lw);
        }
        const clone = el.cloneNode(true) as HTMLElement | SVGElement;
        clone.removeAttribute("id");
        clone.style.setProperty("animation", "none", "important");
        clone.style.setProperty("transition", "none", "important");
        clone.style.setProperty("margin", "0", "important");
        // Freeze the whole subtree at the sampled instant. cloneNode copies
        // the children's animation classes along with them, so left alone
        // they would animate inside the ghost — a paused scene with ghosts
        // that still bounce.
        const kids = clone.querySelectorAll("*");
        kids.forEach((kid) => {
          const ks = (kid as HTMLElement | SVGElement).style;
          ks.setProperty("animation", "none", "important");
          ks.setProperty("transition", "none", "important");
        });
        const srcKids = el.querySelectorAll("*");
        let ringed = false;
        for (const { i, styles } of frame.inner) {
          const kid = kids[i] as HTMLElement | SVGElement | undefined;
          const ks = kid?.style;
          if (!kid || !ks) continue;
          for (const [prop, value] of Object.entries(styles))
            if (value) ks.setProperty(prop, value, "important");
          // Animated leaf = what actually gets painted; that's what the
          // dashed ring should hug
          if (ringLeaves && kid.children.length === 0) {
            ks.setProperty("outline", "1px dashed rgba(113,113,122,0.6)", "important");
            ks.setProperty("outline-offset", "1.5px", "important");
            const r = srcKids[i] ? getComputedStyle(srcKids[i]).borderRadius : "";
            if (r) ks.setProperty("border-radius", r, "important");
            ringed = true;
          }
        }
        if (ringLeaves && !ringed) {
          // Nothing paintable to ring inside — fall back to the box
          wrap.style.outline = "1px dashed rgba(113,113,122,0.6)";
          wrap.style.outlineOffset = "1.5px";
          if (ringRadius) wrap.style.borderRadius = ringRadius;
        }
        if (!svgRoot) {
          // Cloned spans revert to display:inline, which ignores width/height
          clone.style.setProperty("display", "block", "important");
          clone.style.setProperty("width", `${base.w}px`, "important");
          clone.style.setProperty("height", `${base.h}px`, "important");
          // The wrapper already sits at the element's laid-out position, so
          // the clone must fill it from its top-left. Its own classes still
          // say things like `left-1/2 -ml-7` — inside the wrapper that reads
          // as "half of 56px" with the margin already zeroed above, and the
          // ghost lands 28px to the right of where the element is.
          clone.style.setProperty("position", "absolute", "important");
          clone.style.setProperty("inset", "auto", "important");
          clone.style.setProperty("left", "0", "important");
          clone.style.setProperty("top", "0", "important");
          clone.style.setProperty("transform", "none", "important");
        }
        for (const [prop, value] of Object.entries(frame.styles)) {
          if (prop === "transform") continue; // wrapper (or inner clone below)
          // Sampled opacity included: it sits on the clone, so the
          // wrapper's order gradient multiplies on top instead of
          // replacing it — pulses and fades show in the ghosts
          if (value) clone.style.setProperty(prop, value, "important");
        }
        if (svgRoot) {
          const cs = getComputedStyle(el);
          clone.style.setProperty(
            "transform",
            frame.styles.transform ?? "none",
            "important"
          );
          clone.style.setProperty("transform-origin", cs.transformOrigin, "important");
          clone.style.setProperty("transform-box", cs.transformBox, "important");
          // Rebuild the ancestor chain up to the svg root so group
          // transforms and inherited paint attributes survive
          let child: Element = clone;
          for (
            let anc: Element | null = el.parentElement;
            anc && anc !== svgRoot;
            anc = anc.parentElement
          ) {
            const shell = anc.cloneNode(false) as SVGElement;
            shell.removeAttribute("id");
            shell.style.setProperty("animation", "none", "important");
            shell.appendChild(child);
            child = shell;
          }
          const root = svgRoot.cloneNode(false) as SVGSVGElement;
          root.removeAttribute("id");
          root.style.setProperty("animation", "none", "important");
          root.style.setProperty("transition", "none", "important");
          root.style.setProperty("transform", "none", "important");
          root.style.setProperty("display", "block", "important");
          root.style.setProperty("width", `${base.w}px`, "important");
          root.style.setProperty("height", `${base.h}px`, "important");
          root.appendChild(child);
          wrap.appendChild(root);
        } else {
          wrap.appendChild(clone);
        }
        container.appendChild(wrap);
      });
    }
    return () => {
      container.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onion, layers, allAnims, span]);

  if (allInfos.length === 0 || span === 0) return null;

  const frac = span ? Math.min(1, time / span) : 0;

  // Real uncommitted changes in this session — shows the check button
  const hasUncommitted = [...edits.entries()].some(([idx, e]) => {
    const info = allInfos[idx];
    if (!info) return false;
    const forLog =
      speed !== 1 && speedBase.current?.has(idx)
        ? { ...e, duration: speedBase.current.get(idx) }
        : e;
    return editLines(info, forLog).length > 0;
  });

  // Seconds ruler over the scrubber — absolute time marks on the same
  // scale every layer track shares. Start (0) and end (the scene span)
  // are always marked; interior steps picked so at most ~5 marks show,
  // and any step landing within half a step of the end is dropped so
  // its label can't crowd the end mark.
  const rulerStep =
    [100, 250, 500, 1000, 2000, 5000, 10000].find((s) => span / s <= 5) ?? 10000;
  const rulerTicks: { t: number; edge?: "start" | "end" }[] = [{ t: 0, edge: "start" }];
  for (let t = rulerStep; t <= span - rulerStep * 0.5; t += rulerStep)
    rulerTicks.push({ t });
  if (span > 0) rulerTicks.push({ t: span, edge: "end" });

  // One row per layer × property — staggered delays place each layer's
  // keyframes where they really sit on the shared scene timeline.
  // Layers sharing a name group under one section header with #index rows.
  type Row =
    | { type: "header"; label: string; layer: LayerInfo; collapsible: boolean; collapsed: boolean }
    | {
        type: "track";
        layer: LayerInfo;
        info: AnimInfo;
        infoIdx: number;
        track: PropTrack;
        short: string;
        chips: boolean;
        // Family group row (position, scale…) — its lane is the shared
        // keyframes; collapsed hides the per-axis children
        fam?: { famKey: string; collapsed: boolean };
        indent?: boolean;
      };

  const groups: { label: string; members: LayerInfo[] }[] = [];
  for (const layer of layers) {
    const group = groups.find((x) => x.label === layer.label);
    if (group) group.members.push(layer);
    else groups.push({ label: layer.label, members: [layer] });
  }

  const rows: Row[] = [];
  for (const group of groups) {
    const grouped = group.members.length > 1;
    // Every layer gets its name as a section — except the smallest
    // selection, where the only layer IS the grabbed element and the
    // header would just repeat the panel title.
    // Headers select (and hover-highlight) their group's first member
    const selfOnly =
      groups.length === 1 && !grouped && group.members[0].el === grab.el;
    const isCollapsed = collapsedGroups.has(group.label);
    if (!selfOnly)
      rows.push({
        type: "header",
        label: group.label,
        layer: group.members[0],
        // a lone section has nothing to fold away — chevron hidden
        collapsible: groups.length > 1,
        collapsed: isCollapsed,
      });
    if (isCollapsed && groups.length > 1) continue;
    group.members.forEach((layer, memberIdx) => {
      for (const info of layer.infos) {
        const infoIdx = allInfos.indexOf(info);
        // Cluster tracks by attribute family — multi-axis families fold
        // under one group row like elements do under section headers
        const fams = new Map<string, PropTrack[]>();
        for (const track of info.tracks) {
          const fam = trackFamily(track.prop);
          fams.set(fam, [...(fams.get(fam) ?? []), track]);
        }
        // Duration/ease chips once per animation, on its first row
        let chipsLeft = true;
        const tag = grouped ? `#${memberIdx + 1} ` : "";
        for (const [fam, tracks] of fams) {
          const chips = chipsLeft;
          chipsLeft = false;
          if (tracks.length < 2) {
            rows.push({
              type: "track",
              layer,
              info,
              infoIdx,
              track: tracks[0],
              chips,
              short: `${tag}${tracks[0].prop}`,
            });
            continue;
          }
          // The axes all decompose from one transform track, so the group
          // row shows the shared keyframes — dragging one retimes every
          // axis together; expand for per-axis values
          const famKey = `${infoIdx}:${fam}`;
          const expanded = expandedFams.has(famKey);
          rows.push({
            type: "track",
            layer,
            info,
            infoIdx,
            track: { prop: fam, key: tracks[0].key, offsets: tracks[0].offsets },
            chips,
            short: `${tag}${fam}`,
            fam: { famKey, collapsed: !expanded },
          });
          if (expanded)
            for (const track of tracks)
              rows.push({
                type: "track",
                layer,
                info,
                infoIdx,
                track,
                chips: false,
                short: famChildLabel(track.prop, fam),
                indent: true,
              });
        }
      }
    });
  }

  // Label column hugs the longest label — no dead space before the tracks,
  // and every timeline starts on the same firm left line. It is at least
  // wide enough for the transport cluster (play/restart/time) that lives
  // in the same column on the scrubber row.
  const labelChars = Math.max(
    0,
    ...rows.map((r) =>
      r.type === "track" ? r.short.length + (r.indent ? 2 : 0) : 0
    )
  );
  // Solo objects open on dials; the timeline stays one switch away
  const dialView = solo && !showTimeline;
  const barY = 24;
  // Dial rows: one per property with an amount dial (or the first track
  // when nothing scales), computed up front so the body height is known
  // in both views — switching Dials / Timeline must not move anything
  type DialRow = { info: AnimInfo; idx: number; track: PropTrack | null; first: boolean; amp: boolean };
  const dialRows: DialRow[] = !solo
    ? []
    : allInfos.flatMap((info, idx) => {
        const amped = info.tracks.filter((track) => {
          if (amplitudeNeutral(track) == null) return false;
          // Nothing to scale if every keyframe sits at neutral
          const n = amplitudeNeutral(track)!;
          return baselineTrackValues(idx, track).some(
            (raw) => scaleAbout(raw, n, 2) !== scaleAbout(raw, n, 1)
          );
        });
        const shown = amped.length ? amped : [info.tracks[0] ?? null];
        return shown.map((track, i) => ({ info, idx, track, first: i === 0, amp: amped.length > 0 }));
      });
  // One body height for both views: the dials' height (capped like the
  // timeline's), and the timeline scrolls inside it when it runs longer
  const soloBodyH = Math.min(TRACKS_MAX_H, DIAL_PAD + DIAL_HEAD_H + dialRows.length * DIAL_ROW_H);
  const labelWidth = Math.max(
    146,
    Math.min(155, Math.max(56, Math.ceil(labelChars * 6.7) + 2))
  );

  return (
    <>
      {/* Route layer — captured in the screenshot (no data-penseat), under
          the ghosts */}
      <div
        ref={routeRef}
        style={{ position: "absolute", top: 0, left: 0, zIndex: 9994 }}
      />
      {/* Ghost layer — captured in the screenshot (no data-penseat) */}
      <div
        ref={ghostRef}
        style={{ position: "absolute", top: 0, left: 0, zIndex: 9995 }}
      />

      {/* Hovered layer highlight — penseat UI, excluded from capture */}
      {layerRect && (
        <div
          data-penseat="layer-hover"
          style={{
            position: "fixed",
            left: layerRect.left - 3,
            top: layerRect.top - 3,
            width: layerRect.width + 6,
            height: layerRect.height + 6,
            zIndex: 9999,
            pointerEvents: "none",
            border: "1.5px solid #0ea5e9",
            backgroundColor: "rgba(14,165,233,0.1)",
            borderRadius: 6,
          }}
        />
      )}

      {/* Player panel — penseat UI, excluded from capture and picking */}
      <div
        ref={panelRef}
        data-penseat="player"
        style={{
          position: "fixed",
          left: "50%",
          bottom: 16,
          transform: "translateX(-50%)",
          zIndex: 9999,
          // Room for the lanes to breathe; capped so small windows keep a margin
          width: "min(720px, calc(100vw - 32px))",
          backgroundColor: PANEL_BG,
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.12)",
          borderRadius: 14,
          padding: "12px 18px 14px",
          fontFamily: "monospace",
          fontSize: 11,
          color: "#e4e4e7",
          // Panel chrome isn't copyable content — edit inputs opt back in
          userSelect: "none",
        }}
      >
        <style>{`
          [data-penseat="player"] [data-penseat-dial]:hover { background-color: rgba(255,255,255,0.07) !important; }
          [data-penseat="player"] [data-penseat-seg]:hover { color: #d4d4d8 !important; }
          [data-penseat="player"] [data-penseat-play]:active { transform: scale(0.92); }
        `}</style>
        {/* Header: title · onion skin ····· view switch · check (when edited) · minimize · close */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ color: "#d4d4d8", overflow: "hidden", whiteSpace: "nowrap" }}>
            {midTruncate(grab.label, 28)}
          </span>
          <button
            aria-label="Toggle onion skin"
            title={onion ? "Leave onion skin (O)" : "Onion skin (O)"}
            onClick={toggleOnion}
            // Skip the shared hover override while active so the accent holds
            {...(onion ? {} : { "data-penseat-btn": "" })}
            style={{
              ...btnStyle,
              color: onion ? "#f4f4f5" : "#a1a1aa",
              backgroundColor: onion ? "rgba(63,63,70,1)" : "transparent",
            }}
          >
            {OnionIcon}
          </button>
          <span style={{ flex: 1 }} />
          {solo && !minimized && (
            <span style={{ fontFamily: SANS, marginRight: 4 }}>
              <Segmented
                options={[{ value: "dials", label: "Dials" }, { value: "timeline", label: "Timeline" }]}
                value={showTimeline ? "timeline" : "dials"}
                onChange={(v) => setShowTimeline(v === "timeline")}
              />
            </span>
          )}
          {hasUncommitted && (
            <button
              aria-label="Commit timing edits"
              title="Keep these changes: pin a numbered badge and close"
              data-penseat-btn=""
              onClick={commitEdits}
              style={{ ...btnStyle, color: "#f4f4f5" }}
            >
              {CheckIcon}
            </button>
          )}
          <button
            aria-label={minimized ? "Restore player" : "Minimize player"}
            title={minimized ? "Show the layer tracks" : "Minimize — keeps the timeline, hides the layer tracks"}
            data-penseat-btn=""
            onClick={() => setMinimized((m) => !m)}
            style={btnStyle}
          >
            {minimized ? RestoreIcon : MinimizeIcon}
          </button>
          <button aria-label="Close player" data-penseat-btn="" onClick={onClose} style={btnStyle}>
            {CloseIcon}
          </button>
        </div>

        {/* Transport + scrubber + tracks share one positioned wrapper so a
            connector can hang from the scrubber handle into the layer area */}
        <div style={{ position: "relative" }}>
        {/* Connector: scrubber handle (row is 32px tall, knob at 24) down
            to the top of the layer tracks (32px row + 8px margin = 40) */}
        <div
          style={{
            position: "absolute",
            left: `calc(${labelWidth + LANE_GAP}px + (100% - ${gutter + labelWidth + LANE_GAP + EDIT_COL + LANE_GAP}px) * ${frac})`,
            top: 24,
            height: 16,
            width: 1,
            backgroundColor: "#f4f4f5",
            opacity: minimized || dialView ? 0 : 0.5,
            transition: "opacity 200ms ease-out",
            pointerEvents: "none",
          }}
        />
        {/* Transport + scrubber — the controls occupy the same left column
            as the track labels, so the timeline shares the exact x-range
            of the layer tracks: time is one absolute scale */}
        <div style={{ display: "flex", alignItems: "center", gap: LANE_GAP, paddingRight: gutter }}>
          <span
            style={{
              // On the timeline this column lines up with the lane labels;
              // dials have no lanes, so it just hugs its contents
              width: labelWidth,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <button
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause (K)" : "Play (K)"}
              data-penseat-play=""
              onClick={playPause}
              style={{ ...btnStyle, borderRadius: 999, color: PANEL_BG, backgroundColor: "#f4f4f5", transition: "transform 100ms" }}
            >
              <PlayPauseIcon playing={playing} />
            </button>
            <button aria-label="Restart" data-penseat-btn="" onClick={restart} style={btnStyle}>
              {RestartIcon}
            </button>
            {/* Right-aligned in the column — hugs the timeline start.
                Current time pops white; total duration stays quiet */}
            <span style={{ color: "#52525b", fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", marginLeft: "auto" }}>
              <span style={{ color: "#e4e4e7" }}>
                {span >= 1000 && time >= 1000 ? fmtTime(time).slice(0, -1) : fmtTime(time)}
              </span>
              /{fmtTime(span)}
            </span>
          </span>
          <div
            ref={barRef}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              scrubbing.current = true;
              seekFromEvent(e);
            }}
            onPointerMove={(e) => {
              if (scrubbing.current) seekFromEvent(e);
            }}
            onPointerUp={() => {
              scrubbing.current = false;
            }}
            style={{
              flex: 1,
              height: 32,
              position: "relative",
              cursor: "pointer",
              touchAction: "none",
            }}
          >
            {/* Seconds ruler — reads against the shared absolute scale.
                Edge labels sit flush with the lane ends; interiors center */}
            {rulerTicks.map(({ t, edge }) => (
              <span key={t} style={{ pointerEvents: "none" }}>
                <span
                  style={{
                    position: "absolute",
                    left: `${(t / span) * 100}%`,
                    top: 0,
                    transform:
                      edge === "start"
                        ? "none"
                        : edge === "end"
                          ? "translateX(-100%)"
                          : "translateX(-50%)",
                    fontSize: 9,
                    lineHeight: "9px",
                    color: "#71717a",
                  }}
                >
                  {t === 0 ? "0" : `${parseFloat((t / 1000).toFixed(2))}s`}
                </span>
                <span
                  style={{
                    position: "absolute",
                    left: `${(t / span) * 100}%`,
                    // at 100% an unshifted tick floats one pixel past the
                    // line's end and reads as disconnected
                    marginLeft: edge === "start" ? 0 : -1,
                    // Centered on the track line: a faint stroke crossing it,
                    // not a lug sitting on top of it
                    top: 21,
                    width: 1,
                    height: 7,
                    backgroundColor: "#3f3f46",
                  }}
                />
              </span>
            ))}
            {/* Thin track, played part lit, and a slim bar for the playhead */}
            <div style={{ position: "absolute", left: 0, right: 0, top: barY - 1, height: 2, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.1)" }} />
            <div
              style={{
                position: "absolute",
                left: 0,
                width: `${frac * 100}%`,
                top: barY - 1,
                height: 2,
                borderRadius: 2,
                backgroundColor: "rgba(255,255,255,0.5)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${frac * 100}%`,
                top: barY - 6,
                marginLeft: -1,
                width: 2,
                height: 12,
                borderRadius: 2,
                backgroundColor: "#f4f4f5",
              }}
            />
          </div>
          {/* Chips-column slot on the transport row: slow-motion presets */}
          <span style={{ width: EDIT_COL, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <Segmented
              options={[0.25, 0.5, 1].map((v) => ({ value: v, label: `${String(v).replace("0.", ".")}×` }))}
              value={speed}
              onChange={applySpeed}
              title={(v) => (v === 1 ? "Normal speed" : `Slow motion, ${v}x speed`)}
            />
          </span>
        </div>

        {/* Collapsible lower half. grid-template-rows 1fr → 0fr animates the
            height without measuring it; the inner wrapper clips. Its margins
            mirror the tracks' bleed so the scrollbar still meets the panel
            edge and header hover pills still reach into the padding. */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: minimized ? "0fr" : "1fr",
            transition: "grid-template-rows 200ms ease-out",
          }}
        >
        <div
          style={{
            overflow: "hidden",
            minHeight: 0,
            margin: "0 -18px",
            padding: "0 18px",
            // Clipped content is still focusable — take it out of the tab
            // order once the fold has finished, put it back the instant it
            // starts to open
            visibility: minimized ? "hidden" : "visible",
            transition: minimized ? "visibility 0s 200ms" : "visibility 0s",
          }}
        >
        {solo && <div style={{ height: 1, margin: "12px -18px 0", backgroundColor: "rgba(255,255,255,0.06)" }} />}

        {/* Layer tracks — hover a row to highlight its element on the page.
            Bleeds into the panel padding so the scrollbar sits at the panel
            edge and end-of-timeline keyframes aren't clipped. */}
        <div
          ref={tracksRef}
          style={{
            marginTop: 8,
            marginRight: -18,
            paddingRight: 18,
            // Left bleed gutter — the scroll container clips at its padding
            // box, so header hover pills need this room to reach left
            marginLeft: -18,
            paddingLeft: 18,
            ...(solo ? { height: soloBodyH } : { maxHeight: TRACKS_MAX_H }),
            overflowY: "auto",
            // Reaching the list's end must not scroll the page
            overscrollBehavior: "contain",
            // Reserved, barely-there scrollbar
            scrollbarGutter: "stable",
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(255,255,255,0.12) transparent",
          }}
        >
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8 }}>
          {dialView ? (
            /* ── Dial view — tune the motion, don't edit a timeline ──
               One row per animated property: its curve over one cycle,
               then duration, ease and amount. Labels sit once on top. */
            (() => {
              // Layer column matches the timeline's label column, so the
              // curves start right under the scrubber, same as the lanes
              const COLS = [labelWidth, 0, 58, 92, 112];
              const cell = (i: number): React.CSSProperties =>
                i === 1
                  ? { flex: 1, minWidth: 60, display: "flex", alignItems: "center", marginLeft: LANE_GAP - 16 }
                  : { width: COLS[i], flexShrink: 0, display: "flex", alignItems: "center", gap: 6, overflow: "hidden" };
              const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 16, height: DIAL_ROW_H };
              return (
                <div style={{ display: "flex", flexDirection: "column", paddingTop: DIAL_PAD }}>
                  <div style={{ ...rowStyle, height: DIAL_HEAD_H, fontFamily: SANS, fontSize: 11, color: "#52525b" }}>
                    {["Layer", "Motion", "Duration", "Ease", "Amount"].map((h, i) => (
                      <span key={h} style={cell(i)}>{h}</span>
                    ))}
                  </div>
                  {dialRows.map(({ info, idx, track, first, amp }) => {
                    const effect = info.anim.effect;
                    const timingEase = effect ? String(effect.getTiming().easing ?? "linear") : "linear";
                    const liveKfs = effect instanceof KeyframeEffect ? effect.getKeyframes() : [];
                    const snap = COMMITTED.get(info.anim) ?? FIRST_SEEN.get(info.anim);
                    const cur = track ? sampleCurve(liveKfs, track, timingEase) : null;
                    const base = track && snap ? sampleCurve(snap.keyframes, track, timingEase) : null;
                    const edited = !!cur && !!base && cur.some((v, i) => Math.abs(v - base[i]) > 1e-3);
                    const d = effDur(idx);
                    const ct = Number(info.anim.currentTime ?? 0) - info.delay;
                    const progress =
                      ct <= 0 ? 0 : ct >= d * info.iterations ? 1 : (ct % d) / d;
                    const layer = layers.find((l) => l.infos.includes(info)) ?? null;
                    const k = track ? amps.get(ampKey(idx, track)) ?? 1 : 1;
                    return (
                      <div
                        key={`${idx}:${track?.prop ?? ""}`}
                        onMouseEnter={() => hoverLayer(layer)}
                        onMouseLeave={() => hoverLayer(null)}
                        style={rowStyle}
                      >
                        <span style={cell(0)}>
                          {first && (
                            <span style={{ color: "#a1a1aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {info.name}
                            </span>
                          )}
                          {track && (
                            <span style={{ fontFamily: SANS, fontSize: 11, color: "#52525b", whiteSpace: "nowrap" }}>
                              {track.prop}
                            </span>
                          )}
                        </span>
                        <span style={cell(1)}>
                          {cur && (
                            <MotionCurve
                              cur={cur}
                              orig={edited ? base : null}
                              progress={progress}
                              onSeek={(p) => seek(info.delay + p * d)}
                            />
                          )}
                        </span>
                        <span style={{ ...cell(2), flexDirection: "column", alignItems: "flex-start", gap: 0 }}>
                          {first && (
                            <ScrubDial
                              bare
                              value={d}
                              active={Math.round(d) !== Math.round(info.origDuration)}
                              format={fmtTime}
                              parse={parseDuration}
                              onApply={(v) => applyDuration(idx, v)}
                              min={50}
                              max={30000}
                              perPx={5}
                            />
                          )}
                          {first && info.delay > 0 && (
                            <span style={{ fontSize: 9.5, color: "#52525b", whiteSpace: "nowrap" }}>
                              after {fmtTime(info.delay)}
                            </span>
                          )}
                        </span>
                        <span style={cell(3)}>
                          {first && (
                            <button
                              title={`Easing: ${effEase(idx)}. Click to change`}
                              data-penseat-dial=""
                              onClick={(e) => {
                                const r = e.currentTarget.getBoundingClientRect();
                                setEaseMenu((open) =>
                                  open?.idx === idx
                                    ? null
                                    : {
                                        idx,
                                        x: r.right,
                                        y: r.top - 6,
                                        custom: false,
                                        spring: edits.get(idx)?.spring ?? null,
                                        bezier: null,
                                      }
                                );
                              }}
                              style={{
                                ...bareDialStyle,
                                gap: 7,
                                cursor: "pointer",
                                color: effEase(idx) !== info.origEasing ? "#fafafa" : "#d4d4d8",
                              }}
                            >
                              <EaseGlyph easing={effEase(idx)} />
                              {easeLabel(effEase(idx))}
                            </button>
                          )}
                        </span>
                        <span style={{ ...cell(4), gap: 8 }}>
                          {amp && track && (
                            <>
                              <AmountSlider
                                value={Math.round(k * 100)}
                                onApply={(v) => applyAmplitude(idx, track, v / 100)}
                              />
                              <ScrubDial
                                bare
                                value={Math.round(k * 100)}
                                active={Math.round(k * 100) !== 100}
                                format={(v) => `${v}%`}
                                parse={(str) => {
                                  const n = parseFloat(str.replace("%", ""));
                                  return isFinite(n) ? n : null;
                                }}
                                onApply={(v) => applyAmplitude(idx, track, v / 100)}
                                min={0}
                                max={300}
                                perPx={1}
                              />
                            </>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          ) : (
          <>
          {/* Single time indicator crossing every layer */}
          <div
            style={{
              position: "absolute",
              left: `calc(${labelWidth + LANE_GAP}px + (100% - ${labelWidth + LANE_GAP + EDIT_COL + LANE_GAP}px) * ${frac})`,
              top: 0,
              bottom: 0,
              width: 1,
              backgroundColor: "#f4f4f5",
              opacity: 0.5,
              pointerEvents: "none",
              // Over the ruler bars (opaque, later in DOM), under the
              // draggable keyframe ticks (zIndex 3)
              zIndex: 2,
            }}
          />
          {(() => {
            // Sections render as one block (header + its rows) so the
            // hover tint covers the whole group, not just the header line
            const sections: {
              header: Extract<Row, { type: "header" }> | null;
              items: Extract<Row, { type: "track" }>[];
            }[] = [];
            for (const row of rows) {
              if (row.type === "header") sections.push({ header: row, items: [] });
              else {
                if (!sections.length) sections.push({ header: null, items: [] });
                sections[sections.length - 1].items.push(row);
              }
            }
            return sections.map((sec, si) => (
              <div
                key={si}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  // Air between property rows — keyframe value labels hang
                  // below each ruler and need clearance from the next lane
                  gap: 6,
                  // Scroll container flex items collapse without this
                  flexShrink: 0,
                  // Section blocks get breathing room between each other
                  marginTop: sec.header ? (si === 0 ? 2 : 10) : 0,
                  // padding + negative margin: the hover tint bleeds out
                  // while content stays on the label column's left line
                  paddingLeft: 12,
                  marginLeft: -12,
                  paddingRight: 8,
                  marginRight: -8,
                  paddingBottom: sec.header ? 2 : 0,
                  borderRadius: 6,
                  backgroundColor:
                    hotHeader === si ? "rgba(255,255,255,0.07)" : "transparent",
                  transition: "background-color 120ms",
                }}
              >
                {sec.header && (
                <div
                  onPointerEnter={() => {
                    setHotHeader(si);
                    hoverLayer(sec.header!.layer);
                  }}
                  onPointerLeave={() => {
                    setHotHeader(null);
                    hoverLayer(null);
                  }}
                  onClick={() => onSelectLayer(sec.header!.layer.el)}
                  title={`${sec.header.label} · click to select`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 0",
                    flexShrink: 0,
                    color: hotHeader === si ? "#f4f4f5" : "#a1a1aa",
                    cursor: "pointer",
                    transition: "color 120ms",
                  }}
                >
                  <span
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {sec.header.label}
                  </span>
                  {sec.header.collapsible && (
                    <svg
                      width={12}
                      height={12}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-label={sec.header.collapsed ? "Expand section" : "Collapse section"}
                      onClick={(e) => {
                        e.stopPropagation();
                        const label = sec.header!.label;
                        setCollapsedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(label)) next.delete(label);
                          else next.add(label);
                          return next;
                        });
                      }}
                      style={{
                        flexShrink: 0,
                        cursor: "pointer",
                        opacity: 0.8,
                        transform: sec.header.collapsed ? "rotate(-90deg)" : "none",
                        transition: "transform 120ms",
                      }}
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  )}
                </div>
                )}
                {sec.items.map((row, rowIdx) => {
            const { layer, info, infoIdx, track, short, chips } = row;
            const edited = edits.has(infoIdx) &&
              (Math.round(effDur(infoIdx)) !== Math.round(info.origDuration) ||
                effEase(infoIdx) !== info.origEasing);
            return (
            <div
              key={rowIdx}
              onPointerEnter={() => hoverLayer(layer)}
              onPointerLeave={() => hoverLayer(null)}
              // Rows aren't a selection surface — the section header is the
              // entry point; rows stay focused on their own attribute
              title={`${layer.label} — ${info.name} — ${track.prop}`}
              // Top-aligned: label, lane ruler and chips all center on the
              // row's first 18px, so the three columns share one line
              style={{ display: "flex", alignItems: "flex-start", gap: LANE_GAP, flexShrink: 0 }}
            >
              <span
                style={{
                  width: labelWidth,
                  height: 18,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  paddingLeft: row.indent ? 12 : 0,
                  boxSizing: "border-box",
                  textAlign: "left",
                  color: "#71717a",
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {short}
                </span>
                {row.fam && (
                  <svg
                    width={10}
                    height={10}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-label={row.fam.collapsed ? "Expand axes" : "Collapse axes"}
                    onClick={(e) => {
                      e.stopPropagation();
                      const famKey = row.fam!.famKey;
                      setExpandedFams((prev) => {
                        const next = new Set(prev);
                        if (next.has(famKey)) next.delete(famKey);
                        else next.add(famKey);
                        return next;
                      });
                    }}
                    style={{
                      flexShrink: 0,
                      cursor: "pointer",
                      opacity: 0.8,
                      transform: row.fam.collapsed ? "rotate(-90deg)" : "none",
                      transition: "transform 120ms",
                    }}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                )}
              </span>
              <div style={{ position: "relative", flex: 1, height: 26 }}>
                {/* Ruler-style lane: a bar with real thickness, centered on
                    y=9 — the midline of the 18px label/chip columns beside it */}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 5,
                    height: 8,
                    borderRadius: 2,
                    backgroundColor: "#27272a",
                    boxShadow: "inset 0 0 0 1px #3f3f46",
                  }}
                />
                {/* Active window of this animation on the scene timeline */}
                <div
                  style={{
                    position: "absolute",
                    left: `${(info.delay / span) * 100}%`,
                    width: `${(effDur(infoIdx) / span) * 100}%`,
                    top: 5,
                    height: 8,
                    borderRadius: 2,
                    backgroundColor: "#3f3f46",
                  }}
                />
                {/* An expanded family keeps its lane empty — the children
                    below show the same keyframes with per-axis values */}
                {!(row.fam && !row.fam.collapsed) &&
                trackOffsets(info, track.key).map((offset, i, kfArr) => {
                  const t = info.delay + offset * effDur(infoIdx);
                  const values = trackValues(info, track.key);
                  const value = displayValue(values[i] ?? "", track);
                  const pct = (t / span) * 100;
                  const editingThis =
                    kfEdit?.infoIdx === infoIdx && kfEdit.key === track.prop && kfEdit.occ === i;
                  // Shared drag-or-tap behavior: everything attached to a
                  // keyframe (diamond, color chip, value label) drags it;
                  // a clean tap runs the element's own action; a double
                  // tap snaps the keyframe back to its original timing
                  const kfDrag = (onTap?: (el: HTMLElement) => void) => ({
                    onPointerDown: (e: React.PointerEvent) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const lane = e.currentTarget.closest("div") as HTMLElement;
                      dragKf.current = { infoIdx, key: track.key, prop: track.prop, occ: i, lane, from: offset, moved: false, startX: e.clientX };
                      try {
                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                      } catch {}
                    },
                    onPointerMove: (e: React.PointerEvent) => {
                      const d = dragKf.current;
                      if (!d || d.infoIdx !== infoIdx || d.key !== track.key || d.occ !== i) return;
                      if (!d.moved && Math.abs(e.clientX - d.startX) < 4) return;
                      const r = d.lane.getBoundingClientRect();
                      const tx = ((e.clientX - r.left) / r.width) * span;
                      const off = (tx - info.delay) / Math.max(1, effDur(infoIdx));
                      const isLast = i === trackOffsets(info, track.key).length - 1;
                      if (isLast && off > 1) {
                        // the last keyframe dragged past the animation's own
                        // end stretches its duration — growth is capped per
                        // event because span grows along with the duration,
                        // compounding for a pointer far past the lane edge
                        moveKeyframe(infoIdx, track.key, i, 1);
                        applyDuration(
                          infoIdx,
                          Math.round(Math.min(tx, span * 1.05) - info.delay)
                        );
                        d.moved = true;
                      } else if (moveKeyframe(infoIdx, track.key, i, off) != null) d.moved = true;
                    },
                    onPointerUp: (e: React.PointerEvent) => {
                      const d = dragKf.current;
                      dragKf.current = null;
                      if (!d) return;
                      if (d.moved) {
                        const to = trackOffsets(info, track.key)[d.occ] ?? d.from;
                        recordKeyframeMove(d.infoIdx, d.prop, d.from, to);
                        return;
                      }
                      const tapKey = `${infoIdx}:${track.key}:${i}`;
                      if (tapTimer.current?.key === tapKey) {
                        clearTimeout(tapTimer.current.timer);
                        tapTimer.current = null;
                        resetKeyframe(infoIdx, track.key, track.prop, i);
                        return;
                      }
                      // hold the tap action one beat so a second tap can
                      // cancel it (a tap may swap this element for an input,
                      // which would swallow the second click)
                      const el = e.currentTarget as HTMLElement;
                      if (tapTimer.current) clearTimeout(tapTimer.current.timer);
                      tapTimer.current = {
                        key: tapKey,
                        timer: window.setTimeout(() => {
                          tapTimer.current = null;
                          onTap?.(el);
                        }, 300),
                      };
                    },
                    onClick: (e: React.MouseEvent) => e.stopPropagation(),
                  });
                  return (
                    <span key={i}>
                      {/* Draggable keyframe — retime by sliding along the lane */}
                      <span
                        title={
                          i === kfArr.length - 1
                            ? "Drag to retime — past the end stretches duration · double-click to reset"
                            : "Drag to retime · double-click to reset"
                        }
                        {...kfDrag()}
                        style={{
                          position: "absolute",
                          left: `${pct}%`,
                          top: 9,
                          // Ruler tick, not the AE easing diamond — a vertical
                          // line a touch taller than the bar it sits on
                          transform: "translate(-50%, -50%)",
                          width: 2,
                          height: 12,
                          borderRadius: 1,
                          // invisible padding = larger hit target
                          padding: "4px 8px",
                          boxSizing: "content-box",
                          backgroundClip: "content-box",
                          backgroundColor: ACCENT,
                          cursor: "ew-resize",
                          touchAction: "none",
                          // above the value labels so drags win the overlap
                          zIndex: 3,
                        }}
                      />
                      {/* Value under the keyframe — chip for colors.
                          Family group rows show timing only; raw transform
                          values would just be matrix noise */}
                      {!row.fam && (editingThis ? (
                        <input
                          autoFocus
                          defaultValue={value}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              commitTrackValue(infoIdx, track, i, e.currentTarget.value.trim());
                              setKfEdit(null);
                            }
                            if (e.key === "Escape") setKfEdit(null);
                          }}
                          onBlur={(e) => {
                            commitTrackValue(infoIdx, track, i, e.currentTarget.value.trim());
                            setKfEdit(null);
                          }}
                          style={{
                            position: "absolute",
                            left: `${pct}%`,
                            top: 15,
                            transform: "translateX(-50%)",
                            width: 76,
                            zIndex: 3,
                            fontFamily: "monospace",
                            fontSize: 9,
                            padding: "2px 4px",
                            borderRadius: 4,
                            borderWidth: 1,
                            borderStyle: "solid",
                            borderColor: "rgba(255,255,255,0.35)",
                            backgroundColor: "#27272a",
                            color: "#f4f4f5",
                            outline: "none",
                            userSelect: "text",
                          }}
                        />
                      ) : isColorValue(value) ? (
                        <span
                          title={`${value} · click to recolor, drag to retime, double-click to reset`}
                          {...kfDrag((el) => {
                            pendingColor.current = { infoIdx, key: track.key, prop: track.prop, occ: i };
                            const picker = colorInputRef.current!;
                            const r = el.getBoundingClientRect();
                            picker.style.left = `${r.left}px`;
                            picker.style.top = `${r.top}px`;
                            picker.value = toHexColor(value);
                            picker.click();
                          })}
                          style={{
                            position: "absolute",
                            left: `${pct}%`,
                            top: 16,
                            transform: "translateX(-50%)",
                            width: 10,
                            height: 10,
                            borderRadius: 3,
                            backgroundColor: value,
                            borderWidth: 1,
                            borderStyle: "solid",
                            borderColor: "rgba(255,255,255,0.4)",
                            cursor: "pointer",
                          }}
                        />
                      ) : (
                        <span
                          title={`${value} · click to edit, drag to retime, double-click to reset`}
                          {...kfDrag(() => setKfEdit({ infoIdx, key: track.prop, occ: i }))}
                          style={{
                            position: "absolute",
                            left: `${pct}%`,
                            top: 15,
                            transform: "translateX(-50%)",
                            maxWidth: 58,
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            fontSize: 9,
                            color: "#71717a",
                            cursor: "pointer",
                          }}
                        >
                          {midTruncate(value, 9)}
                        </span>
                      ))}
                    </span>
                  );
                })}
              </div>

              {/* Duration + ease chips — once per animation */}
              <span
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: EDIT_COL,
                  height: 18,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 4,
                  cursor: "default",
                }}
              >
                {chips && (
                  <>
                    {durEditIdx === infoIdx ? (
                      <input
                        autoFocus
                        defaultValue={fmtTime(effDur(infoIdx))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const ms = parseDuration(e.currentTarget.value);
                            if (ms) applyDuration(infoIdx, ms);
                            setDurEditIdx(null);
                          }
                          if (e.key === "Escape") setDurEditIdx(null);
                          e.stopPropagation();
                        }}
                        onBlur={(e) => {
                          const ms = parseDuration(e.currentTarget.value);
                          if (ms) applyDuration(infoIdx, ms);
                          setDurEditIdx(null);
                        }}
                        style={{
                          ...durBoxStyle,
                          borderColor: "rgba(255,255,255,0.35)",
                          color: "#f4f4f5",
                          userSelect: "text",
                        }}
                      />
                    ) : (
                      <button
                        title="Edit duration"
                        onClick={() => setDurEditIdx(infoIdx)}
                        style={{
                          ...durBoxStyle,
                          cursor: "pointer",
                          color:
                            edited && Math.round(effDur(infoIdx)) !== Math.round(info.origDuration)
                              ? "#f4f4f5"
                              : "#a1a1aa",
                          // Slow motion active: emphasize the numbers it changed
                          ...(speed !== 1 && Math.round(effDur(infoIdx)) !== Math.round(info.origDuration)
                            ? {
                                backgroundColor: "#3f3f46",
                                borderColor: "rgba(255,255,255,0.35)",
                                color: "#f4f4f5",
                              }
                            : {}),
                        }}
                      >
                        {fmtTime(effDur(infoIdx))}
                      </button>
                    )}
                    <button
                      title={`Easing: ${effEase(infoIdx)} — click to change`}
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setEaseMenu((open) =>
                          open?.idx === infoIdx
                            ? null
                            : {
                                idx: infoIdx,
                                x: r.right,
                                y: r.top - 6,
                                custom: false,
                                // reopen straight into the spring editor if
                                // this animation already uses one
                                spring: edits.get(infoIdx)?.spring ?? null,
                                bezier: null,
                              }
                        );
                      }}
                      style={chipStyle(edited && effEase(infoIdx) !== info.origEasing)}
                    >
                      {easeLabel(effEase(infoIdx))}
                    </button>
                  </>
                )}
              </span>
            </div>
            );
                })}
              </div>
            ));
          })()}
          </>
          )}
          </div>
        </div>
        </div>
        </div>
        </div>

        {/* Hidden color input — clicking a keyframe color chip opens the
            native picker anchored at the chip; live preview on input.
            Portaled so the panel transform can't hijack its position. */}
        {createPortal(
          <input
            ref={colorInputRef}
            type="color"
            data-penseat="color-input"
            onInput={(e) => {
              const p = pendingColor.current;
              if (p) applyKeyframeValue(p.infoIdx, p.key, p.prop, p.occ, e.currentTarget.value);
            }}
            style={{
              position: "fixed",
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: "none",
              border: "none",
              padding: 0,
            }}
          />,
          document.body
        )}

        {/* Ease picker — portaled to body: the panel's translateX(-50%)
            transform would otherwise hijack position:fixed coordinates */}
        {easeMenu && createPortal(
          <>
            <div
              data-penseat="ease-backdrop"
              onClick={() => setEaseMenu(null)}
              style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000 }}
            />
            <div
              data-penseat="ease-menu"
              style={{
                position: "fixed",
                left: easeMenu.x,
                top: easeMenu.y,
                transform: "translate(-100%, -100%)",
                zIndex: 10001,
                backgroundColor: "#18181b",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 8,
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                padding: 4,
                fontFamily: "monospace",
                fontSize: 11,
                minWidth: 190,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                userSelect: "none",
              }}
            >
              <style>{`
                [data-penseat-menu-item] { transition: background-color 100ms, color 100ms; }
                [data-penseat-menu-item]:hover {
                  background-color: rgba(63,63,70,1) !important;
                  color: #f4f4f5 !important;
                }
              `}</style>
              {/* Original easing that isn't a preset gets its own row —
                  presets that ARE the default get a dim prefix instead */}
              {!EASE_PRESETS.includes(allInfos[easeMenu.idx].origEasing) && (
                <div
                  data-penseat-menu-item=""
                  onPointerEnter={() => {
                    if (easeMenu.spring || easeMenu.custom)
                      setEaseMenu({ ...easeMenu, spring: null, custom: false, bezier: null });
                  }}
                  onClick={() => {
                    applyEasing(easeMenu.idx, allInfos[easeMenu.idx].origEasing);
                    setEaseMenu(null);
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 5,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    color:
                      effEase(easeMenu.idx) === allInfos[easeMenu.idx].origEasing
                        ? "#f4f4f5"
                        : "#a1a1aa",
                    backgroundColor:
                      effEase(easeMenu.idx) === allInfos[easeMenu.idx].origEasing
                        ? "rgba(63,63,70,1)"
                        : "transparent",
                  }}
                >
                  <span style={{ color: "#71717a" }}>default · </span>
                  {easeLabel(allInfos[easeMenu.idx].origEasing)}
                </div>
              )}
              {EASE_PRESETS.map((preset) => (
                <div
                  key={preset}
                  data-penseat-menu-item=""
                  onPointerEnter={() => {
                    if (easeMenu.spring || easeMenu.custom)
                      setEaseMenu({ ...easeMenu, spring: null, custom: false, bezier: null });
                  }}
                  onClick={() => {
                    applyEasing(easeMenu.idx, preset);
                    setEaseMenu(null);
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 5,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    color: effEase(easeMenu.idx) === preset ? "#f4f4f5" : "#a1a1aa",
                    backgroundColor:
                      effEase(easeMenu.idx) === preset ? "rgba(63,63,70,1)" : "transparent",
                  }}
                >
                  {allInfos[easeMenu.idx].origEasing === preset && (
                    <span style={{ color: "#71717a" }}>default · </span>
                  )}
                  {preset}
                </div>
              ))}
              <div
                data-penseat-menu-item=""
                onPointerEnter={() => {
                  if (easeMenu.custom) return;
                  const b = parseBezier(effEase(easeMenu.idx)) ?? ([0.25, 0.1, 0.25, 1] as Bezier);
                  setEaseMenu({ ...easeMenu, custom: true, spring: null, bezier: b });
                }}
                onClick={() => {
                  const b = easeMenu.bezier ?? parseBezier(effEase(easeMenu.idx)) ?? ([0.25, 0.1, 0.25, 1] as Bezier);
                  setEaseMenu({ ...easeMenu, custom: true, spring: null, bezier: b });
                  applyEasing(easeMenu.idx, bezierString(b));
                }}
                style={{
                  padding: "4px 10px",
                  borderRadius: 5,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  color: easeMenu.custom ? "#f4f4f5" : "#a1a1aa",
                  backgroundColor: easeMenu.custom ? "rgba(63,63,70,1)" : "transparent",
                }}
              >
                custom bezier
                {/* submenu chevron — the curve editor opens to the right */}
                <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </div>
              <div
                data-penseat-menu-item=""
                onPointerEnter={() => {
                  if (easeMenu.spring) return;
                  const params = edits.get(easeMenu.idx)?.spring ?? SPRING_DEFAULTS;
                  setEaseMenu({ ...easeMenu, custom: false, bezier: null, spring: params });
                }}
                onClick={() => {
                  const params = easeMenu.spring ?? edits.get(easeMenu.idx)?.spring ?? SPRING_DEFAULTS;
                  setEaseMenu({ ...easeMenu, custom: false, bezier: null, spring: params });
                  applySpring(easeMenu.idx, params);
                }}
                style={{
                  padding: "4px 10px",
                  borderRadius: 5,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  color: easeMenu.spring ? "#f4f4f5" : "#a1a1aa",
                  backgroundColor: easeMenu.spring ? "rgba(63,63,70,1)" : "transparent",
                }}
              >
                spring
                {/* submenu chevron — attributes open to the right */}
                <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </div>
            </div>

            {/* Bezier curve editor — side panel to the menu's right */}
            {easeMenu.custom && easeMenu.bezier && (
              <div
                data-penseat="bezier-panel"
                style={{
                  position: "fixed",
                  left: easeMenu.x + 6,
                  top: easeMenu.y,
                  transform: "translateY(-100%)",
                  zIndex: 10001,
                  backgroundColor: "#18181b",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 8,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                  // extra air around the plot, especially above
                  padding: "18px 20px 12px",
                  minWidth: 172,
                  fontFamily: "monospace",
                  fontSize: 10,
                  userSelect: "none",
                }}
              >
                <svg
                  width={BZ_W}
                  height={BZ_H}
                  style={{ display: "block", margin: "0 auto", touchAction: "none", overflow: "visible" }}
                >
                  {/* 0 and 1 progress bounds + reference diagonal */}
                  <line x1={0} y1={bzY(0)} x2={BZ_W} y2={bzY(0)} stroke="#3f3f46" strokeDasharray="3 3" />
                  <line x1={0} y1={bzY(1)} x2={BZ_W} y2={bzY(1)} stroke="#3f3f46" strokeDasharray="3 3" />
                  <line x1={bzX(0)} y1={bzY(0)} x2={bzX(1)} y2={bzY(1)} stroke="#3f3f46" />
                  {/* control arms */}
                  <line x1={bzX(0)} y1={bzY(0)} x2={bzX(easeMenu.bezier[0])} y2={bzY(easeMenu.bezier[1])} stroke="#71717a" strokeDasharray="2 2" />
                  <line x1={bzX(1)} y1={bzY(1)} x2={bzX(easeMenu.bezier[2])} y2={bzY(easeMenu.bezier[3])} stroke="#71717a" strokeDasharray="2 2" />
                  {/* the curve */}
                  <path
                    d={`M ${bzX(0)} ${bzY(0)} C ${bzX(easeMenu.bezier[0])} ${bzY(easeMenu.bezier[1])}, ${bzX(easeMenu.bezier[2])} ${bzY(easeMenu.bezier[3])}, ${bzX(1)} ${bzY(1)}`}
                    fill="none"
                    stroke="#e4e4e7"
                    strokeWidth={1.5}
                  />
                  {/* draggable control points */}
                  {([1, 2] as const).map((handle) => {
                    const hx = easeMenu.bezier![handle === 1 ? 0 : 2];
                    const hy = easeMenu.bezier![handle === 1 ? 1 : 3];
                    return (
                      <circle
                        key={handle}
                        cx={bzX(hx)}
                        cy={bzY(hy)}
                        r={6}
                        fill="#f4f4f5"
                        stroke="#18181b"
                        strokeWidth={2}
                        style={{ cursor: "grab", touchAction: "none" }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          bzDrag.current = handle;
                          (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          if (bzDrag.current !== handle) return;
                          const svg = (e.currentTarget as SVGCircleElement).ownerSVGElement!;
                          const r = svg.getBoundingClientRect();
                          const x = Math.min(1, Math.max(0, (e.clientX - r.left) / BZ_W));
                          const y = Math.min(
                            BZ_YMAX,
                            Math.max(BZ_YMIN, BZ_YMIN + (1 - (e.clientY - r.top) / BZ_H) * (BZ_YMAX - BZ_YMIN))
                          );
                          const b = [...easeMenu.bezier!] as Bezier;
                          if (handle === 1) {
                            b[0] = x;
                            b[1] = y;
                          } else {
                            b[2] = x;
                            b[3] = y;
                          }
                          setEaseMenu({ ...easeMenu, bezier: b });
                          applyEasing(easeMenu.idx, bezierString(b));
                        }}
                        onPointerUp={() => (bzDrag.current = null)}
                      />
                    );
                  })}
                </svg>
                {/* precise entry — Enter applies */}
                <input
                  key={easeMenu.bezier.join(",")}
                  title="cubic-bezier control points: x1, y1, x2, y2"
                  defaultValue={easeMenu.bezier.map((n) => Math.round(n * 100) / 100).join(", ")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const b = parseBezier(e.currentTarget.value.trim());
                      if (b) {
                        setEaseMenu({ ...easeMenu, bezier: b });
                        applyEasing(easeMenu.idx, bezierString(b));
                      } else e.currentTarget.style.borderColor = "#ef4444";
                    }
                    if (e.key === "Escape") setEaseMenu(null);
                  }}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    boxSizing: "border-box",
                    fontFamily: "monospace",
                    fontSize: 10,
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: "1px solid rgba(255,255,255,0.2)",
                    backgroundColor: "#27272a",
                    color: "#e4e4e7",
                    outline: "none",
                    userSelect: "text",
                  }}
                />
              </div>
            )}

            {/* Spring attributes — side panel to the menu's right */}
            {easeMenu.spring && (
              <div
                data-penseat="spring-panel"
                style={{
                  position: "fixed",
                  left: easeMenu.x + 6,
                  top: easeMenu.y,
                  transform: "translateY(-100%)",
                  zIndex: 10001,
                  backgroundColor: "#18181b",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 8,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                  padding: "8px 10px",
                  width: 216,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  fontFamily: "monospace",
                  fontSize: 11,
                  userSelect: "none",
                }}
              >
                {SPRING_FIELDS.map(({ key, min, max, step }) => (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, color: "#a1a1aa" }}>
                    <span style={{ width: 60, fontSize: 10 }}>{key}</span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={easeMenu.spring![key]}
                      onChange={(e) => {
                        const params = { ...easeMenu.spring!, [key]: parseFloat(e.target.value) };
                        setEaseMenu({ ...easeMenu, spring: params });
                        applySpring(easeMenu.idx, params);
                      }}
                      style={{ flex: 1, accentColor: "#a1a1aa", height: 12 }}
                    />
                    <span style={{ width: 28, textAlign: "right", fontSize: 10, color: "#e4e4e7" }}>
                      {easeMenu.spring![key]}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </>,
          document.body
        )}
      </div>
    </>
  );
}
