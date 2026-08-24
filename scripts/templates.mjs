#!/usr/bin/env node
// Keep cli/templates/ in lockstep with src/ — the CLI ships these copies.
//   node scripts/templates.mjs check   exit 1 if any template drifted
//   node scripts/templates.mjs sync    copy src -> cli/templates
import { copyFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIRRORED = [
  "components/drawing-canvas.tsx",
  "components/penseat-bar.tsx",
  "components/penseat-impl.tsx",
  "components/element-inspector.tsx",
  "components/motion-player.tsx",
  "components/penseat.tsx",
  "lib/capture.ts",
];

const mode = process.argv[2];
if (mode !== "check" && mode !== "sync") {
  console.error("usage: node scripts/templates.mjs <check|sync>");
  process.exit(2);
}

let drifted = 0;
for (const file of MIRRORED) {
  const src = join(root, "src", file);
  const tpl = join(root, "cli/templates", file);
  const same = (() => {
    try {
      return readFileSync(src, "utf8") === readFileSync(tpl, "utf8");
    } catch {
      return false;
    }
  })();
  if (same) continue;
  if (mode === "sync") {
    copyFileSync(src, tpl);
    console.log(`synced  ${file}`);
  } else {
    console.error(`drifted ${file}`);
    drifted++;
  }
}

if (drifted) {
  console.error(
    `\n${drifted} template(s) out of sync — run: npm run sync-templates`
  );
  process.exit(1);
}
if (mode === "check") console.log("templates in sync");
