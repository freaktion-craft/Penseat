# Penseat

Draw on your screen. Copy to clipboard.

A floating devtool overlay for React apps — annotate anything on screen, then grab it as a screenshot with one click.

## Install

```bash
npx penseat
```

That's it. Component files are copied into your project (shadcn-style).

### Setting up with a code agent

If you use Claude Code, Cursor, or another coding agent, tell it to run:

```bash
npx penseat agent
```

It makes no changes — it prints step-by-step setup instructions tailored
to the project (framework, layout file, import path), so the agent can
install the files and mount `<Penseat />` in the right place.

To remove Penseat later, tell the agent to run:

```bash
npx penseat remove
```

Same idea in reverse: it prints check-before-delete removal instructions
(unmount, delete the copied files, drop `html2canvas-pro` if nothing else
uses it) so the agent can take Penseat out without side effects.

## Usage

Add to your root layout:

```tsx
import Penseat from "@/components/penseat/penseat"

export default function Layout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Penseat />
      </body>
    </html>
  )
}
```

## Shortcuts

| Key | Action |
|-----|--------|
| `Cmd+Shift+D` | Toggle drawing mode |
| `V` | Inspect element (cursor) |
| `K` | Play / pause the motion player |
| `O` | Toggle onion skin |
| `←` `→` | Step the playhead (hold `Shift` for bigger steps) |
| `1` `2` `3` `4` | Switch colors (back to pen) |
| `E` | Eraser |
| `Cmd+Z` | Undo |
| `X` | Clear all |
| `Cmd+C` | Copy screenshot to clipboard |
| `Esc` | Close |

## Element inspector

Press `V` (or click the cursor in the toolbar) and hover — elements
highlight like devtools inspect. Click to select one: Penseat pins an
outline and a spec card to it showing what the element *has* — its CSS
transitions (property, duration, easing), animations (name, duration,
iterations), and any live Web Animations API animations.

Selection works like a design tool: **click** selects one element
(replacing the previous selection), **shift+click** adds to or removes
from the selection. Clicking a selected element again deselects it
(or collapses a multi-selection down to just it).

If the selected element has animated elements inside it, a small layers
button appears on the top-right corner of its outline. It opens a layer
menu: the element's children, auto-expanded along branches that contain
motion, with a keyframe diamond next to each animated layer (filled =
animates itself, outlined = motion deeper inside). Hovering a row
strokes that element on the page; clicking selects it (shift+click adds
it to the selection).

The cards are part of the copied screenshot, so when you paste into an
LLM it sees both what you circled and the timing behind it — made for
annotating micro-interactions and motion. Click a selected element again
to remove it.

## Motion player

Inspect an element with a *running* animation anywhere inside it and a
player docks at the bottom of the screen. You don't have to click the
exact animated node — motion usually lives on small descendants (an icon
in a button, dots in a card), so Penseat scans the selected element's
whole subtree and shows every animated element as a **layer**:

- **Layer tracks** — one row per animated layer × property, on a shared
  scene timeline. Staggered delays are visible: each layer's keyframes
  sit where they actually fire. Hover a row to highlight that element on
  the page.
- **Play / pause / restart** — drives the real animations via the Web
  Animations API, all layers together
- **Scrubber** — drag to any point in the scene; every layer follows,
  staggers included
- **Onion skin** — pauses the scene and overlays ghost frames of each
  animated layer, sampled across that layer's own delay-to-end window.
  Layers that move leave a fading trail in place; layers that animate
  without moving (opacity pulses, color cycles) get their frames laid
  out as a dashed filmstrip below the element instead. Ghosts and
  strips are part of the copied screenshot, so an LLM can see the
  motion in a single still image.

Inspect a whole section for scene debugging, a single element for focused
debugging, or a small composite (like a typing indicator) to see its
staggered parts together.

### Record a transition

CSS transitions exist only while they run, so the player normally can't
see them. Select an element that declares transitions and a record
button appears next to its outline: arm it, then trigger the transition
for real (hover, focus, press…). Penseat snapshots the transition's
keyframes and timing into animations it owns and opens the player —
scrub, onion-skin, and retime it like any animation. Closing the player
releases the element.

The recorder also captures **JS-driven motion** (Framer Motion springs,
GSAP, rAF loops — anything that writes inline styles per frame): while
armed, a burst of style writes is sampled every frame, simplified, and
rebuilt as a scrubbable animation.

### Framer Motion

Declared `motion.*` config is read straight off the React fiber:
`animate` / `whileHover` / `whileTap` targets and their `transition`
(spring stiffness/damping, duration, ease, delays, repeat) show on the
spec card and in copied prompts — the exact values a code agent needs
to edit, even when the animation itself runs on a JS loop the platform
can't expose. Spec cards and prompts also name the nearest React
component (`<MorphCard>`), so the paste-to-LLM flow points at source,
not just at DOM.

### Live timing edits

Every layer row carries **duration** and **ease** chips. Click the
duration to type a new one (`700ms`, `0.9s`); click the ease to pick
linear / ease / ease-in / ease-out / ease-in-out, a custom
cubic-bezier, or a **spring** — with live stiffness / damping / mass
sliders. Springs are simulated to a CSS `linear()` curve and set the
animation's duration to the spring's natural settle time. Changes apply
to the running animation instantly — scrub and onion-skin the result
until it feels right.

Press the **check** to commit: a numbered badge pins to the element and
the edit joins the change order. Copying then delivers that change
order twice — as clipboard text, and rendered as a monospace strip
under the screenshot itself. Chat UIs usually keep only the image half
of a mixed paste, so the pixels are the delivery that always arrives;
the numbered headers match the badges in the shot.

## Production

Penseat steps out of production builds automatically — the check is inlined
at build time, so production bundles contain none of its code (including
`html2canvas-pro`). You can leave `<Penseat />` in your layout when deploying.

To enable it on a deployed build (e.g. a Vercel Preview so teammates can
annotate it), set `NEXT_PUBLIC_PENSEAT=1` in that environment:

```bash
vercel env add NEXT_PUBLIC_PENSEAT preview   # value: 1
```

## Features

- Floating toolbar with drag-to-throw physics
- Element inspector — captures an element's transitions & animations onto the screenshot
- 4 colors + eraser
- Page screenshot with annotations copied to clipboard
- Keyboard shortcut hints on hover
- Auto-removed from production builds
- Works with any React app

## License

MIT
