"use client";

import { Pencil } from "lucide-react";

interface PenseatTriggerProps {
  onClick: () => void;
}

export default function PenseatTrigger({ onClick }: PenseatTriggerProps) {
  return (
    <button
      data-penseat="trigger"
      onClick={onClick}
      className="fixed bottom-5 right-5 z-[9999] flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-100 shadow-lg transition-all hover:bg-zinc-800 hover:shadow-xl hover:scale-105 active:scale-95 border border-zinc-700/50"
    >
      <Pencil className="size-4" />
      <span className="font-mono text-xs tracking-wide">Penseat</span>
    </button>
  );
}
