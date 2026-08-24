"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { type GrabbedElement, labelFor, midTruncate, componentNameFor, describeMotionIntent } from "./element-inspector";

const GHOST_FRAMES = 5;
const MAX_GHOST_LAYERS = 6;
const PANEL_BG = "#18181b";
const LANE_GAP = 14; // space between the label column and the timelines
const ACCENT = "#e4e4e7";
const ACCENT_DIM = "#a1a1aa";

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
  // Leaf = no element children, or an SVG (its children are drawing
  // internals, not layout) — the smallest meaningful selection
  const isLeaf =
    target instanceof Element &&
    (target.children.length === 0 || target instanceof SVGElement);
  if (!isLeaf) return tracks;
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

// Ghosts for one layer: trail frames sampled across the layer's own
// active window, or — when the frames never move — a filmstrip resampled
// at shared scene times so staggered siblings show their real phase shift
interface LayerGhosts {
  frames: GhostFrame[];
  strip: boolean;
}

function sampleScene(
  layers: LayerInfo[],
  allAnims: Animation[],
  span: number
): Map<LayerInfo, LayerGhosts> {
  const prev = allAnims.map((a) => ({
    time: a.currentTime,
    running: a.playState === "running",
  }));
  const result = new Map<LayerInfo, LayerGhosts>();
  const targets = layers
    .filter((l) => l.el instanceof HTMLElement || l.el instanceof SVGElement)
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
    return { styles, alpha, t };
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

    // Sample the layer's own delay → end window — a short or staggered
    // layer gets its ghosts spread over its actual motion instead of
    // clumped at its fill state. The endpoint sits a hair shy of end:
    // at exactly endTime a fill:none animation is past its active phase
    // and snaps to base styles.
    // Opacity encodes time order: faintest = start, strongest = latest.
    let frames: GhostFrame[] = [];
    for (let i = 0; i < GHOST_FRAMES; i++) {
      const t = Math.min(
        start + ((end - start) * i) / (GHOST_FRAMES - 1),
        end - 1e-3
      );
      frames.push(sampleAt(layer, t, 0.18 + 0.67 * (i / (GHOST_FRAMES - 1))));
    }

    // Frames that never move render as a filmstrip; those resample at
    // shared scene times so staggered siblings (blink dots) show their
    // phase shift instead of five identical cycles
    const strip = frames.every(
      (f) =>
        (f.styles.transform ?? "none") ===
        (frames[0].styles.transform ?? "none")
    );
    if (strip) {
      frames = Array.from({ length: GHOST_FRAMES }, (_, i) =>
        sampleAt(
          layer,
          Math.min((span * i) / (GHOST_FRAMES - 1), span - 1e-3),
          0.18 + 0.67 * (i / (GHOST_FRAMES - 1))
        )
      );
    }
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
  padding: "3px 0",
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
  const [, setKfBump] = useState(0); // re-render after keyframe writes
  const [kfEdit, setKfEdit] = useState<{ infoIdx: number; key: string; occ: number } | null>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const dragKf = useRef<{ infoIdx: number; key: string; prop: string; occ: number; lane: HTMLElement; from: number; moved: boolean; startX: number } | null>(null);
  const tapTimer = useRef<{ key: string; timer: number } | null>(null);
  const pendingColor = useRef<{ infoIdx: number; key: string; prop: string; occ: number } | null>(null);

  // Timing editor UI state
  const [durEditIdx, setDurEditIdx] = useState<number | null>(null);
  const [easeMenu, setEaseMenu] = useState<{ idx: number; x: number; y: number; custom: boolean; spring: SpringParams | null; bezier: Bezier | null } | null>(null);
  const bzDrag = useRef<1 | 2 | null>(null);
  const scrubbing = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
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

  // Playhead follows the real animation clock
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = allAnims[0];
      if (a) setTime(foldTime(span, Number(a.currentTime ?? 0)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, allAnims, span]);

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

    const sampled = sampleScene(layers, allAnims, span);
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
        // first/last frame) can never pass for the element itself
        wrap.style.outline = "1px dashed rgba(113,113,122,0.6)";
        wrap.style.outlineOffset = "1.5px";
        if (ringRadius) wrap.style.borderRadius = ringRadius;
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
        if (!svgRoot) {
          // Cloned spans revert to display:inline, which ignores width/height
          clone.style.setProperty("display", "block", "important");
          clone.style.setProperty("width", `${base.w}px`, "important");
          clone.style.setProperty("height", `${base.h}px`, "important");
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
  const labelWidth = Math.max(
    146,
    Math.min(155, Math.max(56, Math.ceil(labelChars * 6.7) + 2))
  );

  return (
    <>
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
          width: 568,
          backgroundColor: PANEL_BG,
          border: "1.5px solid rgba(255,255,255,0.25)",
          boxShadow: "0 0 0 0.5px rgba(255,255,255,0.06), 0 4px 16px rgba(0,0,0,0.3)",
          borderRadius: 12,
          padding: "14px 18px",
          fontFamily: "monospace",
          fontSize: 11,
          color: "#e4e4e7",
          // Panel chrome isn't copyable content — edit inputs opt back in
          userSelect: "none",
        }}
      >
        {/* Header: title · onion skin ····· check (when edited) · close */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ color: "#71717a", overflow: "hidden", whiteSpace: "nowrap" }}>
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
            opacity: 0.5,
            pointerEvents: "none",
          }}
        />
        {/* Transport + scrubber — the controls occupy the same left column
            as the track labels, so the timeline shares the exact x-range
            of the layer tracks: time is one absolute scale */}
        <div style={{ display: "flex", alignItems: "center", gap: LANE_GAP, paddingRight: gutter }}>
          <span
            style={{
              width: labelWidth,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            <button
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause (K)" : "Play (K)"}
              data-penseat-btn=""
              onClick={playPause}
              style={{ ...btnStyle, color: "#f4f4f5" }}
            >
              <PlayPauseIcon playing={playing} />
            </button>
            <button aria-label="Restart" data-penseat-btn="" onClick={restart} style={btnStyle}>
              {RestartIcon}
            </button>
            {/* Right-aligned in the column — hugs the timeline start.
                Current time pops white; total duration stays quiet */}
            <span style={{ color: "#71717a", whiteSpace: "nowrap", overflow: "hidden", marginLeft: "auto" }}>
              <span style={{ color: "#f4f4f5" }}>{fmtTime(time)}</span>
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
                    // pulled into the lane and down through the track line —
                    // at 100% an unshifted tick floats one pixel past the
                    // line's end and reads as disconnected
                    marginLeft: edge === "start" ? 0 : -1,
                    top: 18,
                    width: 1,
                    height: 7,
                    backgroundColor: "#3f3f46",
                  }}
                />
              </span>
            ))}
            {/* Same 1px stroke as the layer lanes — only the knob stays
                loud, so it still reads as the one in charge */}
            <div style={{ position: "absolute", left: 0, right: 0, top: 24, height: 1, backgroundColor: "#3f3f46" }} />
            <div
              style={{
                position: "absolute",
                left: 0,
                width: `${frac * 100}%`,
                top: 24,
                height: 1,
                backgroundColor: ACCENT_DIM,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${frac * 100}%`,
                top: 24.5,
                transform: "translate(-50%, -50%)",
                width: 11,
                height: 11,
                borderRadius: 999,
                backgroundColor: "#f4f4f5",
              }}
            />
          </div>
          {/* Chips-column slot on the transport row: slow-motion presets */}
          <span style={{ width: EDIT_COL, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
            {[0.25, 0.5, 1].map((v) => (
              <button
                key={v}
                title={v === 1 ? "Normal speed" : `Slow motion — ${v}x speed`}
                onClick={() => applySpeed(v)}
                style={{
                  ...durBoxStyle,
                  width: 32,
                  height: 32,
                  padding: 0,
                  borderRadius: 999,
                  fontSize: 9,
                  lineHeight: "30px",
                  cursor: "pointer",
                  color: speed === v ? "#f4f4f5" : "#a1a1aa",
                  backgroundColor: speed === v ? "#3f3f46" : "#27272a",
                  borderColor: speed === v ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.14)",
                }}
              >
                {String(v).replace("0.", ".")}x
              </button>
            ))}
          </span>
        </div>

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
            maxHeight: 190,
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
                    marginBottom: 3,
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
              style={{ display: "flex", alignItems: "center", gap: LANE_GAP, flexShrink: 0 }}
            >
              <span
                style={{
                  width: labelWidth,
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
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 7,
                    height: 1,
                    backgroundColor: "#3f3f46",
                  }}
                />
                {/* Active window of this animation on the scene timeline */}
                <div
                  style={{
                    position: "absolute",
                    left: `${(info.delay / span) * 100}%`,
                    width: `${(effDur(infoIdx) / span) * 100}%`,
                    top: 7,
                    height: 1,
                    backgroundColor: "#52525b",
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
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
                          top: 7,
                          transform: "translate(-50%, -50%) rotate(45deg)",
                          width: 6,
                          height: 6,
                          // invisible padding = larger hit target
                          padding: 6,
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
                            top: 13,
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
                            top: 14,
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
                            top: 13,
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
