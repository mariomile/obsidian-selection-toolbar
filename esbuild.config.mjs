import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";

const prod = process.argv[2] === "production";

// Output location. Default: the project root (publishable — no personal paths in
// git). To auto-deploy into your vault during dev, either set the
// OBSIDIAN_PLUGIN_DIR env var, or create a gitignored `.obsidian-plugin-dir`
// file containing the absolute path to your plugin folder.
const projectRoot = process.cwd();
const localDirFile = resolve(projectRoot, ".obsidian-plugin-dir");
const outdir =
  process.env.OBSIDIAN_PLUGIN_DIR ||
  (existsSync(localDirFile) ? readFileSync(localDirFile, "utf8").trim() : projectRoot);

mkdirSync(outdir, { recursive: true });

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
    // Node builtins (child_process, os, …) are external via builtin-modules —
    // resolved at runtime by Electron. @floating-ui/dom is intentionally NOT
    // external, so it gets bundled into main.js. The AI backend uses the local
    // `claude` CLI (no SDK to bundle).
  ],
  format: "cjs",
  target: "es2021",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: resolve(outdir, "main.js"),
});

// Copy static assets next to the bundle when deploying elsewhere (skip when
// building in place — they're already here). Re-run after editing them.
if (resolve(outdir) !== resolve(projectRoot)) {
  copyFileSync("manifest.json", resolve(outdir, "manifest.json"));
  copyFileSync("styles.css", resolve(outdir, "styles.css"));
}

if (prod) {
  await context.rebuild();
  await context.dispose();
  process.exit(0);
} else {
  await context.watch();
}
