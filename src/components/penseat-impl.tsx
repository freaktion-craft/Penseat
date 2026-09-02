"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import DrawingCanvas, { type DrawingCanvasHandle } from "./drawing-canvas";
import PenseatBar, { type Corner } from "./penseat-bar";
import ElementInspector, { type GrabbedElement, makeGrab, cancelRecorded, recordedElements, ensureIntentAnimation } from "./element-inspector";
import MotionPlayer, { EDIT_LOG, EDIT_REVEALED, subscribeEditLog, buildEditPrompt, buildBadgePrompt, revertEditBadge } from "./motion-player";
import { captureAndCopy } from "@/lib/capture";

// Numbered circle pinned to an edited element's corner — NOT marked
// data-penseat, so it rides along in the copied screenshot; the copied
// prompt references the same numbers. Clicking opens the detail popover.
function EditBadgeCard({ el, num, onOpen }: { el: Element; num: number; onOpen: () => void }) {
  const r = el.getBoundingClientRect();
  const left = Math.min(Math.max(4, r.right - 10), window.innerWidth - 26);
  const top = Math.min(Math.max(4, r.top - 10), window.innerHeight - 26);
  return (
    <div
      title={`Motion edit #${num} — click for details`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 9999,
        width: 20,
        height: 20,
        borderRadius: 999,
        backgroundColor: "#0ea5e9",
        color: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "monospace",
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
        cursor: "pointer",
        boxShadow: "0 0 0 1.5px rgba(255,255,255,0.85)",
        userSelect: "none",
      }}
    >
      {num}
    </div>
  );
}

// Same icon-button affordance as the toolbar — the shared
// [data-penseat-btn] hover/active rules come from its stylesheet
const POP_ICON = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const PopCopyIcon = <svg {...POP_ICON}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>;
const PopCheckIcon = <svg {...POP_ICON} strokeWidth={3}><path d="M20 6 9 17l-5-5"/></svg>;
const PopTrashIcon = <svg {...POP_ICON}><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>;
const PopCloseIcon = <svg {...POP_ICON}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;
const popBtnStyle: React.CSSProperties = {
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

// Badge detail: prompt preview, copy-this-badge, or trash (which also
// reverts the animations to their pre-edit originals)
function BadgePopover({ el, onClose }: { el: Element; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = buildBadgePrompt(el) ?? "";
  const r = el.getBoundingClientRect();
  const W = 300;
  const left = Math.min(Math.max(8, r.right + 12), window.innerWidth - W - 8);
  const top = Math.min(Math.max(8, r.top), window.innerHeight - 260);
  return (
    <div
      data-penseat="badge-popover"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 10000,
        width: W,
        backgroundColor: "#18181b",
        border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: 10,
        padding: 12,
        fontFamily: "monospace",
        fontSize: 10,
        color: "#e4e4e7",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        // chrome unselectable; the prompt preview below opts back in
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: "#71717a" }}>prompt preview</span>
        <button
          aria-label="Close preview"
          data-penseat-btn=""
          onClick={onClose}
          style={{ ...popBtnStyle, marginLeft: "auto" }}
        >
          {PopCloseIcon}
        </button>
      </div>
      <div
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 170,
          overflowY: "auto",
          overscrollBehavior: "contain",
          color: "#a1a1aa",
          lineHeight: "15px",
          // the one thing here worth copying by hand
          userSelect: "text",
        }}
      >
        {text}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 8, justifyContent: "flex-end" }}>
        <button
          aria-label="Copy this badge's prompt"
          title="Copy this badge's prompt"
          data-penseat-btn=""
          onClick={() => {
            navigator.clipboard.writeText(text).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          style={{ ...popBtnStyle, color: copied ? "#f4f4f5" : "#a1a1aa" }}
        >
          {copied ? PopCheckIcon : PopCopyIcon}
        </button>
        <button
          aria-label="Trash this badge"
          title="Remove the badge and revert the animation to its original timing"
          data-penseat-btn=""
          onClick={() => {
            revertEditBadge(el);
            onClose();
          }}
          style={{ ...popBtnStyle, color: "#f87171" }}
        >
          {PopTrashIcon}
        </button>
      </div>
    </div>
  );
}

type Mode = "idle" | "drawing" | "capturing";
export type Tool = "pen" | "cursor";

export default function Penseat() {
  const [mode, setMode] = useState<Mode>("idle");
  // Opens on the inspector — annotating a live element is the common
  // case; the pen is a key/click away
  const [tool, setTool] = useState<Tool>("cursor");
  const [color, setColor] = useState("#ef4444");
  const [corner, setCorner] = useState<Corner>("rb");
  const [grabs, setGrabs] = useState<GrabbedElement[]>([]);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [shake, setShake] = useState(false);
  const [copied, setCopied] = useState(false);
  const shakeTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  // Re-render when the motion player publishes timing edits (badges)
  const [, setEditBump] = useState(0);
  useEffect(() => subscribeEditLog(() => setEditBump((b) => b + 1)), []);
  // Badge whose detail popover is open
  const [badgeOpen, setBadgeOpen] = useState<Element | null>(null);
  // Recording armed — the pen canvas steps aside (pointer-events + cursor)
  // so the user's own cursor can trigger the motion on the real page
  const [recordArmed, setRecordArmed] = useState(false);

  // Recorded-transition replicas live only while their element stays
  // selected — releasing the grab (replace, clear, Esc) releases them
  useEffect(() => {
    const kept = new Set(grabs.map((g) => g.el));
    for (const el of recordedElements()) if (!kept.has(el)) cancelRecorded(el);
  }, [grabs]);

  const triggerShake = useCallback(() => {
    if (shakeTimer.current) return; // previous shake still running
    setShake(true);
    shakeTimer.current = setTimeout(() => {
      setShake(false);
      shakeTimer.current = null;
    }, 400);
  }, []);

  const toggle = useCallback(() => {
    if (mode === "idle") {
      setMode("drawing");
    } else {
      canvasRef.current?.clear();
      setGrabs([]);
      setPlayerId(null);
      setTool("cursor");
      setMode("idle");
    }
  }, [mode]);

  const clearAll = useCallback(() => {
    canvasRef.current?.clear();
    setGrabs([]);
    setPlayerId(null);
  }, []);

  const pickColor = useCallback((c: string) => {
    setColor(c);
    setTool("pen");
  }, []);

  const handleDone = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;

    // Pinned badges are content too — committing an edit clears the
    // selection, and the whole point afterwards is copying the result
    const hasBadges = [...EDIT_LOG.keys()].some(
      (el) => el.isConnected && EDIT_REVEALED.has(el)
    );
    if (!canvasRef.current?.hasStrokes() && grabs.length === 0 && !hasBadges) {
      triggerShake();
      return;
    }

    // Fire clipboard.write IMMEDIATELY — must be synchronous within user activation
    const copyPromise = captureAndCopy(canvas, buildEditPrompt());

    setMode("capturing");

    copyPromise.then(() => {
      setMode("drawing");
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    }).catch((err) => {
      console.error("Capture failed:", err);
      triggerShake();
      setMode("drawing");
    });
  }, [grabs.length, triggerShake]);

  useEffect(() => {
    const COLORS = ["#ef4444", "#eab308", "#3b82f6", "#22c55e"];

    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "d") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape" && mode === "drawing") {
        toggle();
      }
      if (mode !== "drawing") return;

      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key === "c") {
        handleDone();
      }
      if (isMeta && e.key === "z") {
        e.preventDefault();
        canvasRef.current?.undo();
      }
      if (!isMeta && !e.shiftKey) {
        if (e.key === "x") clearAll();
        if (e.key === "v") setTool("cursor");
        if (e.key === "b") setTool("pen");
        if (e.key === "e" || e.key === "5") pickColor("#ffffff");
        const idx = ["1", "2", "3", "4"].indexOf(e.key);
        if (idx !== -1) pickColor(COLORS[idx]);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, toggle, handleDone, clearAll, pickColor]);

  return (
    <>
      <DrawingCanvas
        ref={canvasRef}
        active={mode === "drawing" || mode === "capturing"}
        color={color}
        penDisabled={tool === "cursor" || recordArmed}
      />

      <ElementInspector
        picking={mode === "drawing" && tool === "cursor"}
        grabs={grabs}
        onGrab={(g, additive) => {
          setGrabs((prev) => (additive ? [...prev, g] : [g]));
          // Live animations anywhere in the subtree → open the motion player.
          // Nothing live, but declared Framer Motion config on the fiber? Then
          // rebuild that config as a real animation and drive it instead — the
          // element is animating, just not anywhere the platform can see.
          const animated = (() => {
            try {
              if (g.el.getAnimations({ subtree: true }).length > 0) return true;
            } catch {
              return false;
            }
            return ensureIntentAnimation(g.el);
          })();
          if (animated) setPlayerId(g.id);
          else if (!additive) setPlayerId(null); // replaced selection — old player target is gone
        }}
        onRemove={(id) => {
          setGrabs((prev) => prev.filter((g) => g.id !== id));
          setPlayerId((p) => (p === id ? null : p));
        }}
        onSolo={(id) => {
          setGrabs((prev) => prev.filter((g) => g.id === id));
          const g = grabs.find((x) => x.id === id);
          const animated = (() => {
            if (!g) return false;
            try {
              if (g.el.getAnimations({ subtree: true }).length > 0) return true;
            } catch {
              return false;
            }
            return ensureIntentAnimation(g.el);
          })();
          setPlayerId(animated ? id : null);
        }}
        onRecord={(g) => {
          // Fresh grab: remounts the player so it picks up the recorded
          // replicas, and re-measures the outline around the new motion
          const fresh = makeGrab(g.el);
          setGrabs((prev) => prev.map((x) => (x.id === g.id ? fresh : x)));
          setPlayerId(fresh.id);
        }}
        onArmingChange={setRecordArmed}
      />

      {/* Timing-edit badges — numbered circles pinned to edited elements,
          part of the screenshot. Numbers match the copied prompt. */}
      {mode !== "idle" &&
        [...EDIT_LOG.keys()].map((el, i) =>
          el.isConnected && EDIT_REVEALED.has(el) ? (
            <EditBadgeCard key={i} el={el} num={i + 1} onOpen={() => setBadgeOpen(el)} />
          ) : null
        )}
      {mode !== "idle" && badgeOpen && EDIT_LOG.has(badgeOpen) && (
        <BadgePopover el={badgeOpen} onClose={() => setBadgeOpen(null)} />
      )}

      {(() => {
        const playerGrab = grabs.find((g) => g.id === playerId);
        return playerGrab && mode !== "idle" ? (
          <MotionPlayer
            key={playerGrab.id}
            grab={playerGrab}
            onClose={() => {
              // Recorded transition replicas hold the element frozen at the
              // playhead — closing the player releases it
              cancelRecorded(playerGrab.el);
              setPlayerId(null);
            }}
            onSelectLayer={(el) => {
              const g = makeGrab(el);
              setGrabs([g]);
              setPlayerId(g.id); // clicked layer is animated — re-target the player
            }}
            onCommit={() => {
              // Check pressed — badge pinned; close the panel and deselect
              setPlayerId(null);
              setGrabs([]);
            }}
          />
        ) : null;
      })()}

      <PenseatBar
        expanded={mode !== "idle"}
        corner={corner}
        onCornerChange={setCorner}
        tool={tool}
        onToolChange={setTool}
        color={color}
        onColorChange={pickColor}
        onToggle={toggle}
        onUndo={() => canvasRef.current?.undo()}
        onClear={clearAll}
        onDone={handleDone}
        capturing={mode === "capturing"}
        copied={copied}
        shake={shake}
      />
    </>
  );
}
