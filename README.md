# Selection Toolbar

A floating formatting toolbar for [Obsidian](https://obsidian.md) that appears when you select text in the editor — quick access to the most common Markdown commands, plus AI text actions powered by Claude. Desktop only.

The toolbar is themed entirely via Obsidian's CSS variables, so it matches your active theme (light, dark, or any community theme) automatically.

## Features

- **Inline formatting** (toggle on/off): bold, italic, strikethrough, highlight, inline code.
- **Block formatting**: H1–H3, blockquote, bullet / numbered / checkbox lists, code block, comment.
- **Insert**: link, internal `[[link]]`, clear formatting.
- **AI text actions** (✨): Improve, Fix grammar, Shorten, Expand, Change tone, Translate, and a free-form custom prompt — streamed from Claude.
- Configurable: enable/disable individual buttons, show delay, minimum selection length.

## AI actions & privacy

AI actions run through your **local [Claude Code](https://www.anthropic.com/claude-code) CLI**, using your existing Claude **subscription** — no API key and no metered API billing. They are **optional**.

- **Requirements**: Claude Code installed and signed in. Run `claude` once in a terminal to log in; the plugin then shells out to it.
- **No API key**: the plugin spawns `claude -p` and reuses your Claude Code login. Nothing is stored in `data.json` except your UI preferences.
- **Network use**: when you run an AI action, the **selected text** and your prompt are sent to Anthropic *through Claude Code* (which makes the request). The plugin itself opens no other network connections and collects no telemetry.
- **CLI path**: auto-detected via a login shell. If your `claude` lives somewhere unusual (e.g. under `nvm`), set the absolute path in settings (`which claude`).
- **Output modes**: *Preview* (review, then Accept/Discard — the default) or *Direct* (stream straight into the editor; `Cmd/Ctrl+Z` to undo).
- **Model**: defaults to Claude Code's configured model; `opus` / `sonnet` / `haiku` selectable in settings.
- **Note on terms**: using a subscription via Claude Code as a backend for another app is a gray area in Anthropic's usage terms — use for personal workflows and check your plan's terms.

## Development

```bash
npm install
npm run dev      # esbuild watch — builds + deploys into the vault plugin folder
npm run build    # tsc typecheck + minified production build
```

`esbuild.config.mjs` deploys the built `main.js`, `manifest.json`, and `styles.css` directly into `~/Vaults/marioverse.ai/.obsidian/plugins/selection-toolbar/`. Adjust the `outdir` for a different vault.

## Architecture

- **Selection detection** — a CodeMirror 6 `updateListener` editor extension (no polling); per-pane, never fires in reading mode.
- **Positioning** — `@floating-ui/dom` with `flip`/`shift`, anchored to a virtual element built from `coordsAtPos`.
- **Commands** — a data-driven registry; transformation logic is shared by kind (wrap-toggle / line-prefix / block / insert).
- **AI** — `src/ai/`: a typed action catalog, a streaming client that spawns the local `claude -p` CLI and parses its `stream-json` output (`content_block_delta` / `text_delta`), and a floating panel. No SDK is bundled.

## License

MIT
