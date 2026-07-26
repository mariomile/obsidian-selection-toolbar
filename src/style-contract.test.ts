import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * mv-kit style contract (obsidian-cosmos-theme/docs/mv-kit.md).
 *
 * Ported from obsidian-sonar's vitest version (commit 3acb417) via horizon's
 * node:test port (f9d9c99), keeping all four assertions verbatim in intent —
 * the same enforcement now lands uniformly across the suite. Encodes only the
 * state landed by the wave-9 mv-kit audit (previous commit), nothing
 * aspirational. Full per-rule verdict: docs/2026-07-mv-kit-audit.md.
 */

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

/** Strip comments so `/* 90ms *\/`-style prose in doc comments doesn't trip
 * the raw-value scan below. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("mv-kit style contract", () => {
  // Regression guard (mv-kit.md's own MUST NOT, ~lines 26-34): a comment that
  // writes a token glob immediately followed by a slash terminates the comment
  // early. Everything after it parses as garbage and the browser DROPS the
  // enclosing rule — this cost Sonar its `.sonar-modal { width: 880px }` in the
  // 2026-07 audit wave (af28344). Invisible to tsc, to node:test and to the
  // raw-value scan below, so it gets its own assertion.
  it("no CSS comment terminates early (token glob followed by a slash)", () => {
    const offenders = css
      .split("\n")
      .map((line, idx) => ({ line: line.trim(), n: idx + 1 }))
      .filter(({ line }) => /--[\w-]*\*\//.test(line));

    assert.deepEqual(offenders, []);
  });

  it("stripping comments leaves no orphaned prose (structural parse check)", () => {
    // If a comment closed early, its remaining lines survive the strip as
    // stray ` * ...` prose sitting in declaration position.
    const orphans = stripComments(css)
      .split("\n")
      .map((line, idx) => ({ line: line.trim(), n: idx + 1 }))
      .filter(({ line }) => /^\*\s|^\*$/.test(line));

    assert.deepEqual(orphans, []);
  });

  it("raw ms/hex/cubic-bezier values appear only as var() fallbacks", () => {
    const lines = stripComments(css).split("\n");

    // A raw ms/hex/cubic-bezier is allowed ONLY when it sits inside a
    // `var(--token, <fallback>)` expression — i.e. the line contains a
    // `var(--something,` before the raw value. This is the line-level
    // heuristic from mv-kit.md's own audit procedure ("grep the plugin's
    // stylesheet for raw ms / hex values outside a var() fallback"), not a
    // full CSS parse.
    const rawMsPattern = /\b\d+ms\b/g;
    const rawHexPattern = /#[0-9a-fA-F]{3,8}\b/g;
    const rawCubicBezierPattern = /cubic-bezier\([^)]*\)/g;

    const violations: string[] = [];

    lines.forEach((line, idx) => {
      // Native Obsidian tokens count too: the requirement is "never a bare
      // value", not "only the suite's own tokens may carry fallbacks".
      const hasVarFallback = /var\(\s*--[\w-]+\s*,/.test(line);

      for (const pattern of [rawMsPattern, rawHexPattern, rawCubicBezierPattern]) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          if (!hasVarFallback) {
            violations.push(`line ${idx + 1}: "${match[0]}" in "${line.trim()}"`);
          }
        }
      }
    });

    assert.deepEqual(violations, []);
  });

  it("caps !important declarations at the post-mv-kit-audit count (ratchet down only)", () => {
    const importantCount = (css.match(/!important;/g) ?? []).length;
    // Ceiling set exactly at the post-fix count landed by the wave-9 mv-kit
    // audit (2026-07): both live in the single focus-ring preservation block
    // at the foot of the file (`outline` + `box-shadow: none`), which exists
    // to stop themes and Obsidian core from erasing the keyboard focus ring
    // on the toolbar's role="button" divs. Reviewed individually and waived
    // as necessary specificity overrides, not shortcuts. Any future edit that
    // adds an !important without removing one fails this test — the ceiling
    // can only ratchet down.
    assert.ok(
      importantCount <= 2,
      `!important count ${importantCount} exceeds the frozen ceiling of 2`,
    );
  });

  // mv-kit §6 (Elevation & motion depth) — wave 2026-07 dinamica, per
  // docs/2026-07-mv-kit-audit.md's "§6 — wave 2026-07 dinamica" section.
  //
  // "a touch tap must never leave a stuck hover state — plugins must not
  // fight it with custom :hover outside @media (hover: hover) on
  // phone-reachable elements." A bare `.foo:hover { }` rule at the
  // stylesheet's top level fires on tap on touch devices and the visual
  // state sticks until an unrelated tap elsewhere, because touch has no
  // pointer to leave. Every plugin-owned `:hover` selector (`.selection-*`,
  // `.sk-inline-*`) must sit inside an `@media (hover: hover)` block.
  //
  // Excludes `:focus-visible` — keyboard-only, never fires from a touch tap,
  // so it is not a §6 hover-richness concern (mv-kit.md's own hover-richness
  // MUST NOT names touch taps specifically, not focus).
  it("§6: no bare :hover rule outside @media (hover: hover) on a plugin-owned selector", () => {
    const lines = stripComments(css).split("\n");

    let depth = 0;
    const hoverGateDepths: number[] = [];
    const violations: string[] = [];
    // Selector lists can span multiple comma-continued lines (e.g.
    // ".foo:hover,\n.foo:focus-visible {") — accumulate them so a :hover
    // that only appears on an earlier continuation line is still caught.
    let pendingSelector = "";

    lines.forEach((rawLine, idx) => {
      const line = rawLine.trim();
      const opensHoverGate = /@media\s*\(hover:\s*hover\)/.test(line) && line.includes("{");

      if (opensHoverGate) hoverGateDepths.push(depth);

      if (!opensHoverGate && !line.includes("{") && line.endsWith(",")) {
        // A selector-list continuation line (no declaration block yet).
        pendingSelector += ` ${line}`;
      } else if (!opensHoverGate && line.includes("{")) {
        const fullSelector = `${pendingSelector} ${line}`;
        pendingSelector = "";

        const opensBareHoverRule =
          /(?:^|,|\s)\.(?:selection|sk-inline)-[\w-]+(?:[.:][\w-]+)*:hover\b/.test(fullSelector);

        if (opensBareHoverRule && hoverGateDepths.length === 0) {
          violations.push(`line ${idx + 1}: "${fullSelector.trim()}"`);
        }
      } else if (!opensHoverGate) {
        pendingSelector = "";
      }

      for (const ch of rawLine) {
        if (ch === "{") depth += 1;
        if (ch === "}") {
          depth -= 1;
          const gateDepth = hoverGateDepths[hoverGateDepths.length - 1];
          if (gateDepth !== undefined && depth <= gateDepth) {
            hoverGateDepths.pop();
          }
        }
      }
    });

    assert.deepEqual(violations, []);
  });
});
