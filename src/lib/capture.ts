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
  promptText: string
): Promise<void> {
  // Create the async blob promise — resolved after capture completes
  const blobPromise = captureComposite(drawingCanvas).then(
    (composite) =>
      new Promise<Blob>((resolve, reject) => {
        composite.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("Failed to create blob")),
          "image/png"
        );
      })
  );

  // Write to clipboard IMMEDIATELY (during user gesture) with promised data
  const items: Record<string, string | Blob | Promise<string | Blob>> = {
    "image/png": blobPromise,
  };

  if (promptText.trim()) {
    items["text/plain"] = new Blob([promptText.trim()], {
      type: "text/plain",
    });
  }

  return navigator.clipboard.write([new ClipboardItem(items)]);
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
