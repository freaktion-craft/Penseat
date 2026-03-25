#!/usr/bin/env node

import { existsSync, mkdirSync, copyFileSync, readFileSync } from "fs";
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
const uiDir = join(componentsDir, "ui");
const libDir = join(base, "lib");

// ── Check if already installed ──
if (existsSync(join(componentsDir, "penseat.tsx"))) {
  console.log(`  ${yellow("!")} Penseat is already installed at ${dim(componentsDir)}`);
  console.log(`  ${dim("  Delete the folder and re-run to reinstall.")}`);
  process.exit(0);
}

// ── Copy files ──
console.log(`  ${dim("Installing to")} ${cyan(componentsDir.replace(cwd + "/", ""))}`);
console.log();

mkdirSync(uiDir, { recursive: true });
mkdirSync(libDir, { recursive: true });

const files = [
  { from: "components/penseat.tsx", to: join(componentsDir, "penseat.tsx") },
  { from: "components/penseat-bar.tsx", to: join(componentsDir, "penseat-bar.tsx") },
  { from: "components/drawing-canvas.tsx", to: join(componentsDir, "drawing-canvas.tsx") },
  { from: "components/ui/button.tsx", to: join(componentsDir, "ui", "button.tsx") },
  { from: "lib/capture.ts", to: join(libDir, "capture.ts") },
];

// Only copy utils.ts if it doesn't exist (shadcn projects already have it)
const utilsTarget = join(libDir, "utils.ts");
if (!existsSync(utilsTarget)) {
  files.push({ from: "lib/utils.ts", to: utilsTarget });
}

for (const f of files) {
  copyFileSync(join(TEMPLATES, f.from), f.to);
}

console.log(`  ${green("+")} Copied ${files.length} files`);

// ── Install dependencies ──
const needed = [
  "html2canvas-pro",
  "lucide-react",
  "@base-ui/react",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
];

const missing = needed.filter((d) => !deps[d]);

if (missing.length > 0) {
  console.log(`  ${dim("Installing dependencies...")}`);

  // Detect package manager
  let pm = "npm";
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) pm = "bun";
  else if (existsSync(join(cwd, "pnpm-lock.yaml"))) pm = "pnpm";
  else if (existsSync(join(cwd, "yarn.lock"))) pm = "yarn";

  const installCmd = pm === "npm"
    ? `npm install ${missing.join(" ")}`
    : pm === "yarn"
      ? `yarn add ${missing.join(" ")}`
      : `${pm} add ${missing.join(" ")}`;

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
console.log(`  ${green("Done!")} Draw away.`);
console.log();
