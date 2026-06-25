import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const prod = process.argv[2] === "production";

// Auto-deploy straight into the vault's plugin folder (same pattern as the
// "Native" plugin). esbuild watch then rebuilds + redeploys on every save.
const outdir = resolve(
  process.env.HOME,
  "Vaults/marioverse.ai/.obsidian/plugins/selection-toolbar"
);

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

// Copy static assets next to the bundle (runs once at startup; re-run
// `npm run dev` after editing manifest.json / styles.css).
copyFileSync("manifest.json", resolve(outdir, "manifest.json"));
copyFileSync("styles.css", resolve(outdir, "styles.css"));

if (prod) {
  await context.rebuild();
  await context.dispose();
  process.exit(0);
} else {
  await context.watch();
}
