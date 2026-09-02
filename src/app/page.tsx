// Demo stage: one ball, one floor. It rolls in, settles, winds up, takes a
// big bounce and two smaller ones, then rolls off — on a 4.2s loop whose
// seam sits off-stage at both ends.
//
// Each principle lives on its own element so the player reads them as
// separate layers: travel (x), arc (y), squash & stretch (scale, pinned to
// the floor) and roll (rotate).
export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white">
      <div className="relative h-72 w-[640px] overflow-hidden">
        {/* Floor */}
        <div className="absolute inset-x-0 bottom-12 border-t border-zinc-200" />

        {/* Travel — slow out on arrival, slow in on departure */}
        <div className="absolute bottom-12 left-1/2 -ml-7 size-14 [animation:ball-travel_4.2s_linear_infinite]">
          {/* Arc */}
          <div className="absolute inset-0 [animation:ball-hop_4.2s_linear_infinite]">
            {/* Squash & stretch — origin at the floor so squash sits, not floats */}
            <div className="absolute inset-0 origin-bottom [animation:ball-squash_4.2s_linear_infinite]">
              {/* Roll */}
              <div className="size-14 rounded-full bg-zinc-900 [animation:ball-roll_4.2s_linear_infinite]" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
