"use client";

import { motion } from "motion/react";

// Framer Motion targets — JS-driven motion the platform can't expose via
// getAnimations(). Penseat reads their declared intent off the React
// fiber and can record the visible motion by sampling.
export default function MotionDemo() {
  return (
    <>
      <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 p-6">
        <div className="flex h-16 items-center">
          <motion.div
            className="size-10 rounded-xl bg-rose-500 shadow-lg"
            animate={{ x: [0, 64, 0], rotate: [0, 90, 0] }}
            transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity }}
          />
        </div>
        <p className="font-mono text-xs text-zinc-400">motion.div · keyframes · 2.4s</p>
      </div>

      <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 p-6">
        <div className="flex h-16 items-center">
          <motion.div
            className="size-10 cursor-pointer rounded-full bg-teal-500 shadow-lg"
            whileHover={{ scale: 1.35, rotate: 12 }}
            transition={{ type: "spring", stiffness: 300, damping: 12 }}
          />
        </div>
        <p className="font-mono text-xs text-zinc-400">motion.div · hover spring · 300/12</p>
      </div>
    </>
  );
}
