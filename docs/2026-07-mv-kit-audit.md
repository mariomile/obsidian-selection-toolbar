# mv-kit audit — Exo AI Selection Toolbar (wave 9)

Audit of `styles.css` (496 lines pre-fix, 513 post-fix) + the UI code
(`src/toolbar.ts`, `src/settings.ts`, `src/ai/inline.ts`, `src/ai/panel.ts`,
`src/commands/registry.ts`, `src/ai/actions.ts`) against
`obsidian-cosmos-theme/docs/mv-kit.md`, both desktop and phone columns.
Scope: coherence-only fixes (radius / type / icons / motion tokens / empty
states / microcopy). No layout redesign, no DOM restructure — per
`docs/2026-07-24-suite-coherence-design.md` §C/D non-goals.

Per-rule verdict: **pass** (already compliant) / **fixed** (this wave) /
**waived** (kit rule doesn't apply here, with reason).

Before this wave `styles.css` consumed ZERO suite tokens
(`grep -c "var(--cosmos-\|var(--mv-"`: 0 hits). It now consumes 9 across 3
distinct tokens (`--cosmos-t-fast`, `--cosmos-native`, `--mv-wash`), every one
with the plugin's own pre-fix literal as the fallback where the pre-fix value
was a number, so a Cosmos-less vault renders at the same speed as before.

## ⚠️ Phone column — one global waiver, stated once

`manifest.json` sets **`"isDesktopOnly": true`**. Obsidian refuses to load
this plugin on iOS/Android entirely, so *no* surface in this repo ever renders
on Mario's iPhone. The reason is structural, not cosmetic: `src/ai/client.ts`
spawns the local `claude` binary through Node's `child_process`, which does
not exist in the mobile runtime.

Consequence for every phone cell below: the kit's phone MUSTs
(`--cosmos-touch-min` 44px floor, `--cosmos-press-scale` on `:active`, the
three `cosmos-*` entrance recipes, phone micro-label sizing) are **waived —
plugin never loads on phone**. `styles.css` correctly contains **zero**
`@media (pointer: coarse)` blocks and zero phone-scoped rules; adding them
would ship CSS that provably cannot execute, which is the opposite of the
minimal-fix mandate. This is the one place in the rollout so far where the
phone column is structurally N/A rather than "not yet done" — Portal, Masonry,
TabX and Horizon are all mobile-enabled and got real phone fixes.

Per the hard constraint, Obsidian's `EmulateMobile` was **not** used at any
point (it kills Node-dependent plugins — and this plugin is entirely
Node-dependent). The phone column below is derived by reading the stylesheet
and `manifest.json`, exactly as the brief specifies.

If Mario ever flips `isDesktopOnly` to `false` (viable only if the AI actions
are made optional on mobile), the phone rules become live and this repo needs
a dedicated follow-up wave: a `@media (pointer: coarse)` block raising
`.selection-toolbar-btn` (currently 30×30px), `.selection-ai-action`
(~24px tall) and `.selection-ai-btn` (~26px tall) to the 44px floor, plus
`--cosmos-press-scale` on their `:active` states. That is written down here so
the gap is recorded, not silently absorbed.

## Golden rule — theme-independent consumption

| Check | Desktop | Phone | Verdict |
|---|---|---|---|
| Every `var(--cosmos-…)` / `var(--mv-…)` carries a literal fallback | all 9 consumption sites do — 3 entrance animations (`var(--cosmos-t-fast, 90ms/90ms/140ms)` + `var(--cosmos-native, cubic-bezier(0.32, 0.72, 0, 1))`) and 3 `--stb-wash` declarations (`var(--cosmos-t-fast, 100ms/120ms/120ms)` + `var(--mv-wash, cubic-bezier(0.25, 1, 0.5, 1))`) | n/a (desktop-only) | **fixed** — see §3. |
| No plugin stylesheet redefines the suite tokens at `:root` / `body` | the file defines **no `:root` and no `body` block at all**. Its only custom properties are plugin-namespaced and rule-scoped: `--stb-wash` (declared inside the 3 rules that consume it, following mv-kit's own shipped `.portal-rail { --portal-motion: … }` example) and `--stb-cols` (set inline from `toolbar.ts`) | same | **pass** |

## §1 Radius + surfaces scale

| Surface | Desktop | Phone | Verdict |
|---|---|---|---|
| `.selection-toolbar` / `.selection-toolbar-overflow` container | `var(--radius-m)` | n/a | **pass** — native token, not a hand-picked pixel. |
| `.selection-ai-panel` container | `var(--radius-m)` | n/a | **pass** |
| `.sk-inline` (in-editor block widget) | `var(--radius-m)` | n/a | **pass** |
| `.selection-custom-action` (settings card) | `var(--radius-m)` | n/a | **pass** |
| `.selection-toolbar-btn`, `.selection-ai-prompt`, `.selection-ai-output`, `.selection-ai-btn`, `.sk-inline-stop` | `var(--radius-s)` | n/a | **pass** |
| `.selection-ai-action` — the plugin's one true *chip* surface | `var(--radius-s)` | n/a | **pass** — this IS the kit's "chip" in spirit and it already consumes a native token rather than a hardcoded pixel, satisfying the MUST's intent ("not a hand-picked pixel value"). Identical verdict class to Horizon wave 5's `.horizon-chip`. Snapping it to `--mv-r-chip` (5px) would be a 1px visual change for zero coherence gain. |
| `.selection-ai-spinner` — `border-radius: 50%` on a 14px ring | fixed tiny shape | n/a | **waived** — the round-cap idiom on a fixed circular glyph, not a pill/card/chip *surface* in the kit's §1 sense. Same waiver class as Sonar's badge-dot and Horizon's status dots. |
| `.sk-inline-skel-line` — `border-radius: 4px` on a 9px skeleton bar; `.sk-inline-caret` — `border-radius: 1px` on a 2px caret | fixed tiny shapes | n/a | **waived** — glyph-scale decorations. The kit's radius table has no entry for skeleton bars or text carets; forcing `--mv-r-chip` onto a 2px caret would distort it. Same waiver class as Horizon's 12px checkbox glyph. |
| Elevation on the two floating surfaces (`.selection-toolbar` → `var(--shadow-s)`, `.selection-ai-panel` → `var(--shadow-l, var(--shadow-s))`) | native Obsidian elevation tokens, already with a literal-token fallback on the panel | n/a | **waived, native-token equivalent** — the kit's MUST is "never *hardcode* elevation shadows for floating surfaces"; there is no hardcoded rgba here, the plugin consumes Obsidian's own elevation scale. Exact `--cosmos-pop-shadow` parity would be a visual change to both floating surfaces, outside this wave's minimal-fix mandate. Identical verdict to Horizon wave 5's three floating surfaces. |

## §2 Type sizes, icon sizes, touch targets

| Surface | Desktop | Phone | Verdict |
|---|---|---|---|
| `.selection-toolbar-btn .svg-icon` | `var(--icon-s)`, native | n/a | **pass** |
| `.selection-ai-action .svg-icon` (14px), `.sk-inline-stop-icon .svg-icon` (12px) | raw px on the SVG wrapper | n/a | **pass** — matches the kit's own §2 row ("Cosmos defines no separate icon-size scale"); same verdict Sonar wave 1 and Horizon wave 5 reached on the identical pattern. Icons are native `setIcon()` Lucide names (`bold`, `wand-2`, `ellipsis`, `sparkles`, `square`, …); the Huge Icons pack is Portal-core-module work (design doc §A), out of scope per-plugin. |
| Micro / secondary text: `.selection-ai-action`, `.selection-ai-status`, `.sk-inline-nochange`, `.sk-inline-stop` | `var(--font-ui-smaller)` at all four sites | n/a | **pass** |
| Body-ish text: `.selection-ai-prompt`, `.selection-ai-output`, `.selection-ai-btn`, `.sk-inline`, `.sk-inline-label` | `var(--font-ui-small)` | n/a | **pass** — no bespoke font size anywhere in the file (`grep "font-size: [0-9]"`: zero hits). |
| Touch-target floor (`--cosmos-touch-min`, 44px) | kit says "N/A (no minimum enforced)" on desktop; toolbar buttons are 30×30px, mouse-sized | **waived — plugin never loads on phone** (see the global waiver above) | **waived** |
| Bespoke phone micro-label size | none — no phone-scoped rule exists | same | **pass, vacuously** — the MUST NOT can't be violated by a stylesheet with no phone block. |

## §3 Motion

| Token / animation | Before | After | Verdict |
|---|---|---|---|
| `.selection-toolbar` entrance (`selection-toolbar-in`: opacity + `translateY(2px)` → none) | raw `90ms ease-out` | `var(--cosmos-t-fast, 90ms) var(--cosmos-native, cubic-bezier(0.32, 0.72, 0, 1))` | **fixed** — a floating-chrome entrance, so it takes the `cosmos-pop-in` easing (`--cosmos-native`, no overshoot). Duration stays on the plugin's own `90ms` as the literal fallback rather than being snapped to the canonical `140ms`: the fallback must reproduce the shipped feel with Cosmos absent. Same reasoning Horizon wave 5 applied to its `80ms` washes. |
| `.selection-ai-panel` entrance (same keyframe) | raw `90ms ease-out` | same as above | **fixed** |
| `.sk-inline-loading` entrance (`sk-inline-in`: opacity + `translateY(-2px)` → none) | raw `140ms ease-out` | `var(--cosmos-t-fast, 140ms) var(--cosmos-native, cubic-bezier(0.32, 0.72, 0, 1))` | **fixed** — `140ms` is already exactly `--cosmos-t-fast`'s canonical value, so this one is a pure token substitution with no timing change under Cosmos. |
| `.selection-toolbar-btn` hover/active wash | raw `background-color 100ms ease, color 100ms ease` | `--stb-wash: var(--cosmos-t-fast, 100ms) var(--mv-wash, cubic-bezier(0.25, 1, 0.5, 1))`, referenced twice in the shorthand | **fixed** — colour/background wash tier per the kit's `--mv-wash` row. The rule-scoped custom property is mv-kit's own shipped pattern (`.portal-rail { --portal-motion: … }`), not a `:root` definition. |
| `.selection-ai-action` hover/focus wash | raw `background-color 120ms ease, border-color 120ms ease` | same `--stb-wash` pattern, `120ms` fallback | **fixed** |
| `.sk-inline-stop` hover wash | raw `background-color 120ms ease, color 120ms ease` | same `--stb-wash` pattern, `120ms` fallback | **fixed** |
| `prefers-reduced-motion: reduce` overrides | `animation-duration: 0ms` ×2 blocks and `transition-duration: 0ms` ×1 — three raw `ms` values living *inside* the reduced-motion escape hatch | `animation: none` / `transition: none`, and the `transition: none` selector list extended to cover `.selection-ai-action` and `.sk-inline-stop` (previously only `.selection-toolbar-btn`) | **fixed** — every keyframe in this file resolves to the element's resting state (`opacity: 1; translateY(0)`; the spinner's `rotate(360deg)` is the identity transform), so cancelling outright is visually equivalent to a zero duration, and it removes the last raw `ms` values from the stylesheet. Extending the selector list is the same belt-and-suspenders Horizon wave 5 and TabX wave 4 applied: under Cosmos the duration tokens zero for free, but the no-Cosmos literal fallback stays live without an explicit override. |
| Animated properties | entrances animate `opacity` + `transform` only; hover states animate `background-color` / `color` / `border-color` | unchanged | **pass** — no layout-triggering property is animated anywhere. The kit's "composited only" MUST bites on entrance/reveal motion; colour washes on hover are the suite-wide convention accepted as **pass** in waves 1–8. |
| `.selection-ai-shimmer`, `.sk-shimmer` — keyframes animating `background-position` | continuous shimmer loops (working label, skeleton bars) | unchanged | **waived** — `background-position` is paint-only, triggers no layout, and there is no composited way to express a text-clipped gradient sweep. Both are killed outright under `prefers-reduced-motion`. |
| Loop periods: spinner `0.7s`, working-label shimmer `1.6s`, skeleton shimmer `1.15s` + `0.12s`/`0.24s` stagger delays, caret blink `1.1s` | raw seconds | unchanged | **waived** — these are *continuous loop periods*, not transition/entrance durations. The kit's duration ladder tops out at `--cosmos-t-panel` (300ms); a 1.6s shimmer cycle or a 1.1s blink cannot consume any of the four tiers without becoming a different animation. All six are inside the `prefers-reduced-motion` kill block, so the accessibility MUST that motivates the token rule is satisfied directly. Same class as Sonar wave 1's waived gesture-settle timing. |
| `--cosmos-spring` (overshoot) | never used | unchanged | **pass** — correctly not reached for on hover or reveal. |
| `prefers-reduced-motion` coverage | block covers toolbar, panel, toolbar buttons, spinner, caret, inline loading, skeleton bars, working label | plus the two extra transition targets above | **pass (extended)** — 100% of animated selectors are covered. |
| Phone entrance recipes (`cosmos-pop-in` / `cosmos-sheet-rise` / `cosmos-fade-in`) | n/a | **waived — plugin never loads on phone** | **waived** — note the desktop entrances above already follow the `cosmos-pop-in` *recipe* (opacity + small `translateY`, `--cosmos-native`), so the shape is right if the plugin ever goes mobile. |

## §4 Empty-state pattern

| Surface | Desktop | Phone | Verdict |
|---|---|---|---|
| `.sk-inline-nochange` — "No changes suggested" (shown when Claude returns text identical to the selection) | was `font-size: var(--font-ui-smaller)` + `color: var(--text-muted)` | n/a | **fixed** — `--text-muted` → `var(--text-faint)`, completing the kit's whisper recipe verbatim (`--text-faint` + `--font-ui-smaller`). This is the plugin's only real empty state and it read one step too loud. |
| `.selection-ai-output.is-empty` — "Pick an action or type an instruction." | the string is set on the element, but the `.is-empty` rule is `display: none`, so it never renders; the panel simply stays compact until there is output | n/a | **pass, not reachable** — nothing to restyle. Deliberate: the idle placeholder box is collapsed rather than shown, which is *quieter* than the kit's whisper recipe, not louder. |
| `.selection-ai-status` — transient status lines ("Stopped.", "Enter a value first.", error text) | `var(--font-ui-smaller)` + `var(--text-muted)`, `--text-error` in the error variant; `:empty` collapses the row | n/a | **pass, not an empty state** — these are *status* messages (feedback on an action that just ran), not "nothing here yet" states. The kit's whisper recipe governs empty states; forcing `--text-faint` onto an error message would make failures harder to notice. |
| `.sk-inline-label` — "Claude is writing…" | `var(--font-ui-small)` + `var(--text-muted)` | n/a | **pass, not an empty state** — an in-progress indicator paired with a live caret and a Stop button. |
| Section eyebrow / micro-label recipe | the plugin renders **no section headings** in its own chrome — the toolbar is a flat button row, the AI panel is chips + textarea + output, the inline widget is diff + buttons. Settings headings come from Obsidian's native `Setting().setHeading()` | n/a | **pass, not applicable** — no bespoke uppercase treatment exists to normalize (`grep "text-transform"` in `styles.css`: zero hits), so the MUST cannot be violated. |

## §5 Microcopy voice

| Rule | Desktop | Phone | Verdict |
|---|---|---|---|
| No `mod-cta` on buttons — plugin-authored | `src/ai/panel.ts:293` (`renderFooter`, the "Retry" button) and `src/ai/inline.ts:104` (the "Accept" button) both wrote `cls: "selection-ai-btn mod-cta"`, with a matching `.selection-ai-btn.mod-cta` pair of rules in `styles.css` | n/a | **fixed** — renamed to a plugin-owned modifier, `.selection-ai-btn.is-primary`, at all four sites (2 TS, 2 CSS). Deliberately a *rename*, not a deletion: dropping the class outright (Horizon wave 5's approach for its single confirm button) would strip the accent styling from "Accept" and "Retry", the two primary affordances in the AI flow, which is a visual regression rather than a coherence fix. `grep -rn "mod-cta" src/`: **zero hits** post-fix (the one remaining match anywhere in the repo is the CSS comment that documents *why* the class is not used). |
| No `mod-cta` on buttons — native Obsidian API | `src/settings.ts:324` calls `.setCta()` on the "Add custom action" button; Obsidian's own `ButtonComponent` adds `mod-cta` internally | n/a | **pass, per suite precedent** — Portal wave 2 ruled on this exact case: `.setCta()` is Obsidian's own `Setting`/`ButtonComponent` API, not a plugin-authored `mod-cta` class, and the kit's MUST NOT is aimed at the latter. Flagged here for visibility so Mario can overrule it in one line if he wants the rule read literally. |
| No native `<select>` — plugin-authored UI | `grep -rn "createEl('select'\|createEl(\"select\"\|<select" src/`: **zero hits**. Every picker the plugin renders itself is already chip-shaped: `.selection-ai-action` chips in the AI panel, `role="button"` divs in the toolbar and its overflow menu | n/a | **pass** — this is the chip+popover pattern the kit asks for, and it predates the kit. |
| No native `<select>` — settings tab | `src/settings.ts` uses `.addDropdown(…)` 4× (Model, Quick model, Output mode, per-custom-action Model), which Obsidian renders as a native `<select>` | n/a | **deferred, out of scope by design** — identical to Masonry wave 3's and TabX wave 4's verdicts on their own `addDropdown` uses. The programme doc excludes settings screens on purpose ("Niente settings screens (in coda programma)"), and replacing `addDropdown` with a chip+popover means writing a custom form component — exactly the component rework this wave's non-goals forbid. Flagged for the settings-screen cantiere, where all four dropdowns across the suite can be migrated together behind one shared component. |
| Sentence-case labels — settings | "Show delay", "Minimum selection length", "Multi-row toolbar", "Buttons per row", "Max buttons in the bar", "Commands", "AI text actions", "Enable AI actions", "Claude CLI path", "Model", "Quick model", "Output mode", "Test connection", "Custom actions", "Action 1", "Prompt (system)", "Ask for an extra input", "Input placeholder", "Add custom action" | n/a | **pass** — all sentence case. |
| Sentence-case labels — toolbar commands | "Bold", "Italic", "Strikethrough", "Highlight", "Inline code", "Heading 1/2/3", "Blockquote", "Bullet list", "Numbered list", "Checkbox", "Code block", "Comment", "Link", "Wikilink [[ ]]", "Clear formatting", "More", "AI actions" | n/a | **pass** — single-word and sentence-case throughout; no Title Case, no ALL CAPS. (Contrast Portal's and Masonry's deferred "All Docs".) |
| Sentence-case labels — AI actions | "Improve", "Fix grammar", "Shorten", "Expand", "Change tone", "Translate", "Custom", "Custom action"; buttons "Accept", "Retry", "Discard", "Stop", "Close" | n/a | **pass** |
| `.mva-pv` / `.mva-sel` / `.mva-btn` form-language classes | the settings tab delegates entirely to Obsidian's native `Setting` / `PluginSettingTab` API; the AI panel is not a settings form but floating action chrome with its own `.selection-ai-*` taxonomy | n/a | **pass, correctly out of scope** — same verdict Sonar wave 1, Portal wave 2, TabX wave 4 and Horizon wave 5 all reached: the `.mva-*` convention governs *custom forms*, and the portable, checkable rules (no `mod-cta`, no native `<select>`) are the ones enforced above. |
| English product copy, PM jargon untranslated | every user-facing string across `toolbar.ts`, `panel.ts`, `inline.ts`, `actions.ts`, `registry.ts`, `settings.ts`, `main.ts` is English — placeholders ("Ask Claude, or pick an action…", "Tone — e.g. formal, friendly, confident"), status lines, Notices, settings copy | n/a | **pass** — no mixed-language surface anywhere. (Contrast Horizon wave 5, which is Italian end-to-end and had to defer the whole question.) |

## Golden-rule raw-value leakage (post-fix grep, repo-wide)

Post-fix `styles.css` scan for raw `ms` / hex / `cubic-bezier` outside a
`var(--token, fallback)` expression: **zero hits**.

- `ms` values: 6, all inside a `var()` fallback (`90ms` ×2, `100ms`, `120ms` ×2, `140ms`)
- `cubic-bezier` values: 6, all inside a `var()` fallback
- hex colours: **0 in the whole file** — the plugin was already fully
  variable-driven on colour (`color-mix(in srgb, var(--color-red) 15%, transparent)`
  and friends), which is why the audit found nothing to fix in §1's colour surface

`src/style-contract.test.ts` now enforces this mechanically, alongside the two
comment-integrity assertions that exist because of Sonar's `af28344` outage.

## `!important` audit (exactly 2 — both reviewed individually)

| Declaration | Location | Verdict |
|---|---|---|
| `outline: 2px solid var(--interactive-accent) !important;` | the focus-ring preservation block at the foot of `styles.css` (`:is([class^="selection-"], [class*=" selection-"]) :is(button, .clickable-icon, [role="button"]):focus-visible`) | **waived, justified** — the toolbar's controls are `role="button"` **divs**, not `<button>` elements, so several themes (Cosmos included) and Obsidian core reset or suppress their focus ring at equal-or-higher specificity from a later-loading stylesheet. Without `!important` the keyboard-only path through the toolbar becomes invisible — an accessibility regression, not a cosmetic one. Same category as Horizon wave 5's waived focus-ring pair. |
| `box-shadow: none !important;` | same rule | **waived, justified** — the other half of the same override: it suppresses the themes that draw their focus indicator as a `box-shadow` instead of an `outline`, which would otherwise stack a glow *behind* the outline this block just forced on. Removing one without the other produces a double indicator. |

**Total: 2. None removed** — both are a single, documented specificity battle
against theme and core focus styling, not a shortcut around normal cascade.
`src/style-contract.test.ts` caps the file at 2 exactly (ratchet-down only):
any future edit that adds an `!important` without removing one fails the
contract test.

## Not touched (explicit non-goals, confirmed out of scope)

- No layout or DOM changes anywhere. Every fix in this wave is a token
  substitution, a colour-token swap on an existing declaration, or a class
  rename — no element was added, removed, reparented or resized.
- Settings-tab `addDropdown` → chip+popover migration (see §5) — deferred to
  the settings-screen cantiere, matching Masonry and TabX.
- `.setCta()` in `src/settings.ts` (see §5) — native Obsidian API, passed per
  Portal wave 2's precedent, flagged rather than silently changed.
- Continuous loop animations (spinner, shimmer, blink) and their stagger
  delays (see §3) — outside the kit's duration ladder; accessibility handled
  directly by the reduced-motion kill block.
- `--cosmos-pop-shadow` migration for the toolbar and AI panel (see §1) —
  native `--shadow-s`/`--shadow-l` already avoid hardcoded elevation values;
  exact suite-shadow parity is a visual change, deferred.
- Phone-scoped CSS (see the global waiver) — this plugin is
  `isDesktopOnly: true` and cannot render on a phone.

## Verification

- `pnpm typecheck` — **0 errors**
- `pnpm test` — **6/6 pass** (2 pre-existing in `src/ai/guard.test.ts` + 4 new
  in `src/style-contract.test.ts`, added in the following commit), 1 suite
- `pnpm lint` — **this repo has no lint script.** `package.json` defines
  `dev`, `build`, `release:check`, `typecheck`, `test` only, and there is no
  eslint/biome config in the tree. No lint run is claimed for this wave.
- Red-before-green: all four contract assertions demonstrated failing
  individually against a deliberately mutated `styles.css`, then restored
  byte-identically (sha1 `ee6ddf8c1184d219f0dedf78d06d63dc9ae256a6` before and
  after every probe). Evidence recorded in the contract commit message.
- Desktop screenshot / live vault reload verification: **pending** — not
  performed this wave.
- Phone verification: **not applicable** — `isDesktopOnly: true`. Obsidian's
  `EmulateMobile` was not used at any point.
