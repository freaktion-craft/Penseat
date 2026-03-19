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
            <button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
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
            <button className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800">
              Get started
            </button>
            <button className="rounded-lg border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              View demo
            </button>
          </div>
        </div>
      </section>

      {/* Cards */}
      <section className="mx-auto max-w-6xl px-8 pb-24">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-zinc-200 p-6">
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

          <div className="rounded-xl border border-zinc-200 p-6">
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

          <div className="rounded-xl border border-zinc-200 p-6">
            <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
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
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            </div>
            <h3 className="font-semibold text-zinc-900">LLM-agnostic</h3>
            <p className="mt-2 text-sm text-zinc-500">
              Works with Claude, ChatGPT, Gemini, Cursor — anything that
              accepts image and text input.
            </p>
          </div>
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
                title: "Click the Backseat button",
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
          Backseat — draw on the web, paste to your LLM
        </div>
      </footer>
    </main>
  );
}
