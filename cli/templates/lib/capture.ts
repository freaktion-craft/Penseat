import html2canvas from "html2canvas-pro";

/**
 * Captures the page + drawing annotations and copies to clipboard.
 *
 * Key trick: ClipboardItem accepts Promise<Blob>, so we call
 * navigator.clipboard.write() IMMEDIATELY during the user gesture,
 * passing a promise that resolves later after html2canvas finishes.
 * This keeps the clipboard write within the user activation window.
 */
export function captureAndCopy(
  drawingCanvas: HTMLCanvasElement,
  text?: string | null
): Promise<void> {
  // Create the async blob promise — resolved after capture completes.
  // The change-order text is ALSO rendered into the image as a strip
  // below the screenshot: chat UIs usually keep only the image half of
  // a mixed clipboard paste, so pixels are the delivery that always
  // arrives (the badges the prompt references are in the shot anyway).
  const blobPromise = captureComposite(drawingCanvas)
    .then((composite) => (text ? appendPromptStrip(composite, text) : composite))
    .then(
      (composite) =>
        new Promise<Blob>((resolve, reject) => {
          composite.toBlob(
            (b) =>
              b ? resolve(b) : reject(new Error("Failed to create blob")),
            "image/png"
          );
        })
    );

  // One clipboard item, two formats: the screenshot plus (when timing
  // edits exist) a plain-text change order for a code agent — kept as
  // text too for text-only paste targets, and because text is lossless
  // where image text relies on the model reading pixels
  const formats: Record<string, Blob | Promise<Blob>> = {
    "image/png": blobPromise,
  };
  if (text) formats["text/plain"] = new Blob([text], { type: "text/plain" });

  // Write to clipboard IMMEDIATELY (during user gesture) with promised data
  return navigator.clipboard.write([new ClipboardItem(formats)]);
}

// Draw the prompt as a dark monospace strip under the screenshot.
// Rendered big and high-contrast: exact values (durations, beziers)
// must survive being read back out of pixels by a vision model.
function appendPromptStrip(
  shot: HTMLCanvasElement,
  text: string
): HTMLCanvasElement {
  const scale = shot.width / window.innerWidth;
  const fontSize = Math.round(13 * scale);
  const lineHeight = Math.round(fontSize * 1.55);
  const pad = Math.round(16 * scale);
  const font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;

  // Wrap to the canvas width
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const maxWidth = shot.width - pad * 2;
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    if (measure.measureText(raw).width <= maxWidth) {
      lines.push(raw);
      continue;
    }
    let line = "";
    for (const word of raw.split(" ")) {
      const probe = line ? `${line} ${word}` : word;
      if (measure.measureText(probe).width > maxWidth && line) {
        lines.push(line);
        line = `  ${word}`;
      } else {
        line = probe;
      }
    }
    if (line.trim()) lines.push(line);
  }
  const MAX_LINES = 48;
  if (lines.length > MAX_LINES) lines.splice(MAX_LINES, lines.length, "…");

  const stripHeight = pad * 2 + lines.length * lineHeight;
  const out = document.createElement("canvas");
  out.width = shot.width;
  out.height = shot.height + stripHeight;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(shot, 0, 0);
  ctx.fillStyle = "#18181b";
  ctx.fillRect(0, shot.height, out.width, stripHeight);
  ctx.font = font;
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    // Numbered element headers pop in the badge color; body text stays light
    ctx.fillStyle = /^\[\d+\]/.test(line) ? "#7dd3fc" : "#e4e4e7";
    ctx.fillText(line, pad, shot.height + pad + i * lineHeight + lineHeight / 2);
  });
  return out;
}

async function captureComposite(
  drawingCanvas: HTMLCanvasElement
): Promise<HTMLCanvasElement> {
  // Screenshot the page DOM (visible viewport)
  const pageCanvas = await html2canvas(document.body, {
    useCORS: true,
    allowTaint: true,
    x: window.scrollX,
    y: window.scrollY,
    width: window.innerWidth,
    height: window.innerHeight,
    ignoreElements: (el) => {
      return el.closest("[data-penseat]") !== null;
    },
  });

  // Composite page + drawing annotations
  const composite = document.createElement("canvas");
  composite.width = pageCanvas.width;
  composite.height = pageCanvas.height;
  const ctx = composite.getContext("2d")!;

  ctx.drawImage(pageCanvas, 0, 0);

  // The drawing canvas is document-sized — crop visible viewport portion
  const dpr = window.devicePixelRatio || 1;
  ctx.drawImage(
    drawingCanvas,
    window.scrollX * dpr,
    window.scrollY * dpr,
    window.innerWidth * dpr,
    window.innerHeight * dpr,
    0,
    0,
    composite.width,
    composite.height
  );

  return composite;
}
