# Penseat

Draw on your screen. Copy to clipboard.

A floating devtool overlay for React apps — annotate anything on screen, then grab it as a screenshot with one click.

## Install

```bash
npx penseat
```

That's it. Component files are copied into your project (shadcn-style).

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
| `1` `2` `3` `4` | Switch colors |
| `E` | Eraser |
| `Cmd+Z` | Undo |
| `X` | Clear all |
| `Cmd+C` | Copy screenshot to clipboard |
| `Esc` | Close |

## Features

- Floating toolbar with drag-to-throw physics
- 4 colors + eraser
- Page screenshot with annotations copied to clipboard
- Keyboard shortcut hints on hover
- Works with any React app

## License

MIT
