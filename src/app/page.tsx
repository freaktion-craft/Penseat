import MotionDemo from "./motion-demo";

export default function Page() {
  return (
    <main className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-zinc-200 px-8 py-4">
        <nav className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="font-mono text-sm font-semibold tracking-tight text-zinc-900">
            acme.app
          </span>
          <div className="flex items-center gap-6 text-sm text-zinc-500">
            <a href="#" className="hover:text-zinc-900">
              Features
            </a>
            <a href="#" className="hover:text-zinc-900">
              Pricing
            </a>
            <a href="#" className="hover:text-zinc-900">
              Docs
            </a>
            <button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-zinc-800">
              Sign up
            </button>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-8 py-24">
        <div className="max-w-2xl">
          <h1 className="text-5xl font-bold tracking-tight text-zinc-900">
            Ship faster with
            <br />
            better feedback
          </h1>
          <p className="mt-4 text-lg text-zinc-500">
            Draw directly on the web to communicate visual changes. Circle
            elements, sketch arrows, scribble notes — then paste your annotated
            screenshot into any LLM for instant guidance.
          </p>
          <div className="mt-8 flex items-center gap-4">
            <button className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-zinc-800">
              Get started
            </button>
            <button className="rounded-lg border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 transition-colors duration-150 hover:bg-zinc-50">
              View demo
            </button>
          </div>
        </div>
      </section>

      {/* Cards */}
      <section className="mx-auto max-w-6xl px-8 pb-24">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 p-6 transition-transform duration-200 ease-out hover:scale-[1.02]">
            <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <svg
                className="size-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
            </div>
            <h3 className="font-semibold text-zinc-900">Draw on anything</h3>
            <p className="mt-2 text-sm text-zinc-500">
              Freehand marker annotations that scroll with the page. Feels like
              drawing on the actual website.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 p-6 transition-transform duration-200 ease-out hover:scale-[1.02]">
            <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <svg
                className="size-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                />
              </svg>
            </div>
            <h3 className="font-semibold text-zinc-900">Copy & paste</h3>
            <p className="mt-2 text-sm text-zinc-500">
              One click copies the annotated screenshot and your note to
              clipboard. Paste into any LLM.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 p-6 transition-transform duration-200 ease-out hover:scale-[1.02]">
            <div className="mb-4 flex h-10 items-center gap-5">
              <span className="size-4 animate-bounce rounded-full bg-blue-500" />
              <span className="size-4 animate-pulse rounded-full bg-emerald-500" />
              <span className="size-5 animate-spin rounded-md border-2 border-dashed border-zinc-400 [animation-duration:3s]" />
              <span className="size-4 rounded-full bg-violet-500 [animation:demo-slide_2.4s_ease-in-out_infinite]" />
            </div>
            <h3 className="font-semibold text-zinc-900">Annotate motion</h3>
            <p className="mt-2 text-sm text-zinc-500">
              Inspect an animated element to play, pause, scrub its timeline,
              and onion-skin its keyframes into the screenshot.
            </p>
          </div>

        </div>
      </section>

      {/* Motion playground — targets for the element inspector & motion player */}
      <section className="mx-auto max-w-6xl px-8 pb-24">
        <h2 className="text-2xl font-bold text-zinc-900">Motion playground</h2>
        <p className="mt-2 text-sm text-zinc-500">
          Press <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-xs">V</kbd> and
          inspect any of these — play, scrub, and onion-skin them.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-3">

          <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 p-6">
            <div className="flex h-16 items-center">
              <div className="size-10 rounded-xl bg-blue-500 shadow-lg [animation:demo-float_3s_ease-in-out_infinite]" />
            </div>
            <p className="font-mono text-xs text-zinc-400">float · translateY · 3s</p>
          </div>

          <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 p-6">
            <div className="flex h-16 items-center">
              <svg
                className="size-8 text-amber-500 [animation:demo-wiggle_1.8s_ease-in-out_infinite]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.7V5a2 2 0 1 0-4 0v.3A6 6 0 0 0 6 11v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9"
                />
              </svg>
            </div>
            <p className="font-mono text-xs text-zinc-400">wiggle · rotate · 1.8s</p>
          </div>

          <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 p-6">
            <div className="flex h-16 w-full items-center px-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                <div className="h-full w-full origin-left rounded-full bg-emerald-500 [animation:demo-progress_2.2s_ease-in-out_infinite]" />
              </div>
            </div>
            <p className="font-mono text-xs text-zinc-400">progress · scaleX · 2.2s</p>
          </div>

          <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 p-6">
            <div className="flex h-16 items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-zinc-500 [animation:demo-blink_1.4s_ease-in-out_infinite]" />
              <span className="size-2.5 rounded-full bg-zinc-500 [animation:demo-blink_1.4s_ease-in-out_0.2s_infinite]" />
              <span className="size-2.5 rounded-full bg-zinc-500 [animation:demo-blink_1.4s_ease-in-out_0.4s_infinite]" />
            </div>
            <p className="font-mono text-xs text-zinc-400">typing · opacity · staggered</p>
          </div>

          <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 p-6">
            <div className="flex h-16 items-center">
              <div className="size-8 rounded-lg [animation:demo-color_2.8s_ease-in-out_infinite]" />
            </div>
            <p className="font-mono text-xs text-zinc-400">morph · color + scale · 2.8s</p>
          </div>

          <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 p-6">
            <div className="flex h-16 items-center justify-center">
              <div className="relative flex size-14 items-center justify-center">
                <div className="size-3 rounded-full bg-zinc-300" />
                <div className="absolute size-3 rounded-full bg-rose-500 [animation:demo-orbit_2.6s_linear_infinite]" />
              </div>
            </div>
            <p className="font-mono text-xs text-zinc-400">orbit · rotate + translate · 2.6s</p>
          </div>

          <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 p-6">
            <div className="flex h-16 items-center">
              {/* Motion on an element INSIDE the svg — onion-skin regression target */}
              <svg width={96} height={24} viewBox="0 0 96 24" className="overflow-visible">
                <line x1="4" y1="12" x2="92" y2="12" stroke="#e4e4e7" strokeWidth={3} strokeLinecap="round" />
                <circle cx="8" cy="12" r="6" fill="#0ea5e9" className="[animation:demo-svg-slide_2.4s_ease-in-out_infinite]" />
              </svg>
            </div>
            <p className="font-mono text-xs text-zinc-400">svg · inner circle · 2.4s</p>
          </div>

          <MotionDemo />

        </div>
      </section>

      {/* How it works - gives the page scroll height for testing */}
      <section className="bg-zinc-50 py-24">
        <div className="mx-auto max-w-6xl px-8">
          <h2 className="text-3xl font-bold text-zinc-900">How it works</h2>
          <div className="mt-12 space-y-16">
            {[
              {
                step: 1,
                title: "Click the Penseat button",
                desc: "Or press Cmd+Shift+D. The drawing canvas activates over your entire page.",
              },
              {
                step: 2,
                title: "Draw your feedback",
                desc: "Circle elements, draw arrows, scribble notes. Use different colors. The markers scroll with the page.",
              },
              {
                step: 3,
                title: "Add a note & hit Done",
                desc: "Type what you want changed, then click Done. The annotated screenshot and your note are copied to clipboard.",
              },
              {
                step: 4,
                title: "Paste into your LLM",
                desc: "Cmd+V into Claude, ChatGPT, Cursor, or any AI that accepts images. It sees exactly what you marked up.",
              },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-8">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-lg font-bold text-white">
                  {item.step}
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-zinc-900">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-zinc-500">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-200 py-8">
        <div className="mx-auto max-w-6xl px-8 text-center text-sm text-zinc-400">
          Penseat — draw on the web, paste to your LLM
        </div>
      </footer>
    </main>
  );
}
