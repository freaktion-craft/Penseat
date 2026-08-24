#!/usr/bin/env node

import { existsSync, mkdirSync, copyFileSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(__dirname, "templates");
const cwd = process.cwd();

// ── Colors ──
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

// ── Shared project detection (agent commands) ──
function detectProject() {
  let pkgJson = null;
  try {
    pkgJson = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  } catch {}
  const allDeps = pkgJson
    ? { ...pkgJson.dependencies, ...pkgJson.devDependencies }
    : {};
  const srcDir = existsSync(join(cwd, "src"));
  const firstExisting = (candidates) =>
    candidates.find((p) => existsSync(join(cwd, p))) ?? null;
  const appLayout = firstExisting([
    "src/app/layout.tsx",
    "src/app/layout.jsx",
    "app/layout.tsx",
    "app/layout.jsx",
  ]);
  const pagesApp = firstExisting([
    "src/pages/_app.tsx",
    "src/pages/_app.jsx",
    "pages/_app.tsx",
    "pages/_app.jsx",
  ]);
  return { pkgJson, allDeps, srcDir, appLayout, pagesApp };
}

function detectPm() {
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

// ── Agent mode: print setup instructions for AI coding agents ──
// Makes no changes to the project — it tells the agent what to do.
if (process.argv[2] === "agent" || process.argv[2] === "--agent") {
  const { pkgJson, allDeps, srcDir, appLayout, pagesApp } = detectProject();
  const alreadyInstalled = existsSync(
    join(cwd, srcDir ? "src" : ".", "components", "penseat", "penseat.tsx")
  );
  const agentImportPath = srcDir
    ? "@/components/penseat/penseat"
    : "./components/penseat/penseat";
  const mountFile = appLayout ?? pagesApp;
  const mountTarget = appLayout
    ? `Edit \`${appLayout}\` (Next.js App Router root layout). Render <Penseat /> as the last child of <body>, after {children}.`
    : pagesApp
      ? `Edit \`${pagesApp}\` (Next.js Pages Router custom App). Render <Penseat /> next to <Component {...pageProps} />.`
      : `Edit the root component of the app (one that renders on every page). Render <Penseat /> once, at the end of its JSX.`;

  console.log(`# Penseat setup — instructions for coding agents

Penseat is a development-only screen-annotation overlay for React apps:
the developer draws on the running app, then copies an annotated
screenshot to the clipboard (typically to paste into an LLM). It strips
itself from production builds, so it is safe to leave mounted permanently.

This command made no changes to the project. Follow the steps below.

## Detected project (from ${cwd})

- package.json: ${pkgJson ? "found" : "NOT FOUND — if this is wrong, re-run from the project root"}
- react: ${allDeps.react ?? "NOT FOUND — Penseat requires a React project"}
- next: ${allDeps.next ?? "not found (generic React project)"}
- source dir: ${srcDir ? "src/" : "project root (no src/)"}
- mount file: ${mountFile ?? "not auto-detected"}
- penseat files: ${alreadyInstalled ? "already installed — skip step 1" : "not installed"}

## Step 1 — copy the files

Run from the project root:

    npx penseat

This copies the component source into \`components/penseat/\` and
\`lib/capture.ts\` (shadcn-style — the project owns the code), and installs
\`html2canvas-pro\` as a devDependency using the project's package manager.
If it reports "already installed", the files exist; continue to step 2.

## Step 2 — mount the component

${mountTarget}

    import Penseat from "${agentImportPath}";

    // inside the returned JSX, after the page content:
    <Penseat />

- If the project does not use the \`@\` import alias, use a relative
  import to \`components/penseat/penseat\` instead.
- A Next.js root layout may stay a Server Component — Penseat is a
  Client Component ("use client") and needs no changes around it.
- Mount it exactly once.

## Step 3 — verify

1. Start the dev server: a round pen button appears in the bottom-right
   corner of every page.
2. Press Cmd+Shift+D (Ctrl+Shift+D on Windows/Linux): the button expands
   into a toolbar and the page becomes drawable.
3. Run the production build: it must pass unchanged. Penseat and its
   html2canvas-pro dependency are excluded from production bundles by a
   build-time check, so nothing needs to be removed before deploying.

## Facts you may need

- Production: disabled automatically. To enable on a deployed build
  (e.g. a Vercel Preview), set NEXT_PUBLIC_PENSEAT=1 in that environment
  before building.
- Do not edit the copied files as part of setup.
- To remove Penseat later: \`npx penseat remove\` prints removal
  instructions.
- Shortcuts: Cmd+Shift+D toggle, 1-4 colors, E eraser, Cmd+Z undo,
  X clear, Cmd+C copy screenshot, Esc close.`);
  process.exit(0);
}

// ── Remove mode: print removal instructions for AI coding agents ──
// Makes no changes to the project — it tells the agent what to do.
if (process.argv[2] === "remove" || process.argv[2] === "uninstall") {
  const { pkgJson, srcDir, appLayout, pagesApp } = detectProject();
  const rel = srcDir ? "src/" : "";
  const penseatDirAbs = join(cwd, srcDir ? "src" : ".", "components", "penseat");
  let penseatFiles = [];
  try {
    penseatFiles = readdirSync(penseatDirAbs);
  } catch {}
  const captureRel = `${rel}lib/capture.ts`;
  const captureExists = existsSync(join(cwd, captureRel));

  // Find where <Penseat /> is actually mounted
  let mountedIn = null;
  for (const f of [appLayout, pagesApp].filter(Boolean)) {
    try {
      if (/penseat/i.test(readFileSync(join(cwd, f), "utf8"))) {
        mountedIn = f;
        break;
      }
    } catch {}
  }

  const h2cIn = pkgJson?.dependencies?.["html2canvas-pro"]
    ? "dependencies"
    : pkgJson?.devDependencies?.["html2canvas-pro"]
      ? "devDependencies"
      : null;
  const pm = detectPm();
  const uninstallCmd =
    pm === "npm"
      ? "npm uninstall html2canvas-pro"
      : pm === "yarn"
        ? "yarn remove html2canvas-pro"
        : `${pm} remove html2canvas-pro`;

  console.log(`# Penseat removal — instructions for coding agents

Goal: remove the Penseat screen-annotation devtool from this project
completely, with no side effects on anything else. Follow the steps in
order (unmount first, so nothing references the files when they are
deleted). Every deletion has a check — do the check before deleting.

This command made no changes to the project.

## Detected state (from ${cwd})

- penseat components: ${penseatFiles.length > 0 ? `${rel}components/penseat/ (${penseatFiles.join(", ")})` : "not found"}
- capture lib: ${captureExists ? captureRel : "not found"}
- mounted in: ${mountedIn ?? "not found in the usual mount files — search the codebase for \"penseat\""}
- html2canvas-pro: ${h2cIn ? `in ${h2cIn}` : "not in package.json"}
- package manager: ${pm}

## Step 1 — unmount the component

${mountedIn ? `Edit \`${mountedIn}\`:` : "Search the codebase for `<Penseat` and in the file that renders it:"}
- Delete the \`import Penseat from ...\` line.
- Delete the \`<Penseat />\` element.
- Change nothing else in the file.

## Step 2 — delete the copied files

1. Delete the directory \`${rel}components/penseat/\`. It contains only
   Penseat's own files (penseat.tsx, penseat-impl.tsx, penseat-bar.tsx,
   drawing-canvas.tsx, element-inspector.tsx, motion-player.tsx — older
   installs may lack some). If the directory contains files not on that
   list, they are not Penseat's: leave those files in place and delete
   only the listed ones.
2. \`${captureRel}\` is Penseat's capture helper. Before deleting it,
   search the rest of the codebase for imports of \`lib/capture\` (e.g.
   \`@/lib/capture\` or a relative path). If nothing else imports it,
   delete the file — but NOT the \`lib/\` directory, which may hold other
   files. If something else does import it, keep the file and skip
   step 3.

## Step 3 — remove the dependency

\`html2canvas-pro\` exists only for Penseat's capture helper. Confirm no
remaining source file imports \`html2canvas-pro\` (after steps 1-2 there
should be none), then run:

    ${uninstallCmd}

${h2cIn === null ? "(Detected as not present in package.json — skip this step.)\n\n" : h2cIn === "dependencies" ? "(Detected in `dependencies` — an older Penseat install put it there; the command above removes it from either section.)\n\n" : ""}## Step 4 — verify

1. Search the source tree (excluding node_modules and lockfiles) for
   "penseat" case-insensitively: there should be no hits left.
2. Start the dev server and run the production build: both must pass.
3. If the deployment environment (e.g. Vercel) has a NEXT_PUBLIC_PENSEAT
   variable, it is now unused — tell the user they can remove it.`);
  process.exit(0);
}

// ── Banner ──
console.log();
console.log(`  ${bold("penseat")} ${dim("— draw on your screen, copy to clipboard")}`);
console.log();

// ── Detect project ──
const pkgPath = join(cwd, "package.json");
if (!existsSync(pkgPath)) {
  console.log(`  ${red("!")} No package.json found. Run this inside a React project.`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

if (!deps.react) {
  console.log(`  ${red("!")} No React dependency found. Penseat requires a React project.`);
  process.exit(1);
}

// ── Detect src/ directory ──
const hasSrc = existsSync(join(cwd, "src"));
const base = hasSrc ? join(cwd, "src") : cwd;

const componentsDir = join(base, "components", "penseat");
const libDir = join(base, "lib");

// ── Check if already installed ──
if (existsSync(join(componentsDir, "penseat.tsx"))) {
  console.log(`  ${yellow("!")} Penseat is already installed at ${dim(componentsDir)}`);
  console.log(`  ${dim("  Delete the folder and re-run to reinstall.")}`);
  console.log(`  ${dim("  To remove cleanly: `npx penseat remove`")}`);
  process.exit(0);
}

// ── Copy files ──
console.log(`  ${dim("Installing to")} ${cyan(componentsDir.replace(cwd + "/", ""))}`);
console.log();

mkdirSync(componentsDir, { recursive: true });
mkdirSync(libDir, { recursive: true });

const files = [
  { from: "components/penseat.tsx", to: join(componentsDir, "penseat.tsx") },
  { from: "components/penseat-impl.tsx", to: join(componentsDir, "penseat-impl.tsx") },
  { from: "components/penseat-bar.tsx", to: join(componentsDir, "penseat-bar.tsx") },
  { from: "components/drawing-canvas.tsx", to: join(componentsDir, "drawing-canvas.tsx") },
  { from: "components/element-inspector.tsx", to: join(componentsDir, "element-inspector.tsx") },
  { from: "components/motion-player.tsx", to: join(componentsDir, "motion-player.tsx") },
  { from: "lib/capture.ts", to: join(libDir, "capture.ts") },
];

for (const f of files) {
  copyFileSync(join(TEMPLATES, f.from), f.to);
}

console.log(`  ${green("+")} Copied ${files.length} files`);

// ── Install dependencies ──
const needed = [
  "html2canvas-pro",
];

const missing = needed.filter((d) => !deps[d]);

if (missing.length > 0) {
  console.log(`  ${dim("Installing dependencies...")}`);

  const pm = detectPm();

  // Dev dependency — penseat code is stripped from production builds,
  // so the capture library is only needed at dev/build time
  const installCmd = pm === "npm"
    ? `npm install -D ${missing.join(" ")}`
    : pm === "yarn"
      ? `yarn add -D ${missing.join(" ")}`
      : `${pm} add -D ${missing.join(" ")}`;

  try {
    execSync(installCmd, { cwd, stdio: "pipe" });
    console.log(`  ${green("+")} Installed ${missing.length} dependencies ${dim(`(${pm})`)}`);
  } catch {
    console.log(`  ${yellow("!")} Auto-install failed. Run manually:`);
    console.log(`  ${dim(`  ${installCmd}`)}`);
  }
} else {
  console.log(`  ${green("+")} All dependencies already installed`);
}

// ── Usage instructions ──
const importPath = hasSrc ? "@/components/penseat/penseat" : "./components/penseat/penseat";

console.log();
console.log(`  ${bold("Usage:")} Add to your root layout:`);
console.log();
console.log(dim(`    import Penseat from "${importPath}"`));
console.log();
console.log(dim(`    export default function Layout({ children }) {`));
console.log(dim(`      return (`));
console.log(dim(`        <html>`));
console.log(dim(`          <body>`));
console.log(dim(`            {children}`));
console.log(dim(`            <Penseat />`));
console.log(dim(`          </body>`));
console.log(dim(`        </html>`));
console.log(dim(`      )`));
console.log(dim(`    }`));
console.log();
console.log(`  ${bold("Shortcuts:")} ${dim("Cmd+Shift+D")} toggle  ${dim("1-4")} colors  ${dim("E")} eraser  ${dim("Cmd+C")} copy`);
console.log();
console.log(`  ${bold("Production:")} Penseat removes itself from production builds automatically.`);
console.log(`  ${dim("  To enable on preview deploys, set NEXT_PUBLIC_PENSEAT=1 in that env.")}`);
console.log();
console.log(`  ${bold("Using a code agent?")} ${dim("`npx penseat agent` prints setup instructions for it.")}`);
console.log();
console.log(`  ${green("Done!")} Draw away.`);
console.log();
