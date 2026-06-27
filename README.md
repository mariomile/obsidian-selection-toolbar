# Selection Toolbar

A floating formatting toolbar for [Obsidian](https://obsidian.md) that appears when you select text in the editor — quick access to the most common Markdown commands, plus AI text actions powered by Claude. Desktop only.

The toolbar is themed entirely via Obsidian's CSS variables, so it matches your active theme (light, dark, or any community theme) automatically.

![Floating formatting toolbar over a text selection](docs/toolbar.png)

![AI actions panel with a before/after diff preview](docs/ai-panel.png)

## Features

- **Inline formatting** (toggle on/off): bold, italic, strikethrough, highlight, inline code.
- **Block formatting**: H1–H3, blockquote, bullet / numbered / checkbox lists, code block, comment.
- **Insert**: link, internal `[[link]]`, clear formatting.
- **AI text actions** (✨): Improve, Fix grammar, Shorten, Expand, Change tone, Translate, and a free-form custom prompt — streamed from Claude.
- Configurable: enable/disable individual buttons, show delay, minimum selection length.

## Installation

**Requirements:** Obsidian 1.4+ (desktop), and [Claude Code](https://www.anthropic.com/claude-code) installed and signed in (run `claude` once in a terminal). AI actions use your Claude subscription via the local CLI — no API key.

### Via BRAT (easiest today)

1. Install the **BRAT** community plugin.
2. BRAT → *Add beta plugin* → `mariomile/obsidian-selection-toolbar`.
3. Enable **Selection Toolbar** under Community plugins. BRAT auto-updates it.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/mariomile/obsidian-selection-toolbar/releases/latest).
2. Copy them into `<your-vault>/.obsidian/plugins/selection-toolbar/`.
3. Reload Obsidian and enable the plugin.

> Community-plugins directory (one-click install) submission is planned — see below.

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
npm run dev      # esbuild watch — rebuilds on every save
npm run build    # tsc typecheck + minified production build
```

By default the build outputs `main.js` to the project root. To auto-deploy into your vault during dev, point the build at your plugin folder with either:

- an env var: `OBSIDIAN_PLUGIN_DIR="/path/to/Vault/.obsidian/plugins/selection-toolbar" npm run dev`, or
- a gitignored `.obsidian-plugin-dir` file in the project root containing that absolute path.

esbuild then copies `main.js`, `manifest.json`, and `styles.css` there on each build.

## Architecture

- **Selection detection** — a CodeMirror 6 `updateListener` editor extension (no polling); per-pane, never fires in reading mode.
- **Positioning** — `@floating-ui/dom` with `flip`/`shift`, anchored to a virtual element built from `coordsAtPos`.
- **Commands** — a data-driven registry; transformation logic is shared by kind (wrap-toggle / line-prefix / block / insert).
- **AI** — `src/ai/`: a typed action catalog, a streaming client that spawns the local `claude -p` CLI and parses its `stream-json` output (`content_block_delta` / `text_delta`), and a floating panel. No SDK is bundled.

## License

MIT
