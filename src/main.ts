import { Plugin, MarkdownView, Notice, debounce, type Editor, type Debouncer } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { SelectionToolbar } from "./toolbar";
import { AIPanel, type OpenOptions, type AIConfig } from "./ai/panel";
import {
  resolveCli,
  testConnection,
  streamCompletion,
  isAbort,
  describeError,
  type ResolvedCli,
} from "./ai/client";
import { selectionToolbarExtension, type SelectionEvent } from "./selection-extension";
import { inlineExtension, setInline, patchInline, getInline, type InlineCallbacks } from "./ai/inline";
import { commandsFor, COMMANDS } from "./commands/registry";
import { AI_ACTIONS, customToAction } from "./ai/actions";
import { buildUserMessage, type AIAction } from "./ai/types";
import {
  type SelectionToolbarSettings,
  DEFAULT_SETTINGS,
  SelectionToolbarSettingTab,
} from "./settings";

export default class SelectionToolbarPlugin extends Plugin {
  settings!: SelectionToolbarSettings;
  private toolbar!: SelectionToolbar;
  private aiPanel!: AIPanel;
  private mouseDown = false;
  private cli: ResolvedCli = { bin: "claude", pathEnv: process.env.PATH ?? "" };
  private debouncedSelection!: Debouncer<[SelectionEvent], void>;
  private inlineAbort: AbortController | null = null;
  private lastInline: { view: EditorView; action: AIAction; input: string } | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.refreshCli();

    // AI panel is created once; it reads live config + actions via callbacks.
    this.aiPanel = new AIPanel({
      getConfig: () => this.aiConfig(),
      getActions: () => this.aiActions(),
      runInline: (view, editor, action, input) => this.runInline(view, editor, action, input),
    });
    this.addChild(this.aiPanel);

    this.buildToolbar();
    this.rebuildDebouncer();
    this.registerCommands();

    // Anti-flicker: don't show the toolbar while the primary button is held
    // (i.e. the user is still dragging out a selection).
    this.registerDomEvent(document, "mousedown", (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    this.registerDomEvent(document, "mouseup", () => {
      this.mouseDown = false;
    });

    // Escape hides the toolbar and closes the AI panel.
    this.registerDomEvent(document, "keydown", (e) => {
      if (e.key !== "Escape") return;
      if (this.aiPanel.isVisible()) this.aiPanel.close();
      else if (this.toolbar.isVisible()) this.toolbar.hide();
    });

    // The detector forwards raw events; we debounce here so the delay is live.
    // inlineExtension renders the in-editor AI loading/diff decorations.
    this.registerEditorExtension([
      inlineExtension(),
      selectionToolbarExtension((ev) => this.debouncedSelection(ev)),
    ]);

    this.addSettingTab(new SelectionToolbarSettingTab(this.app, this));
  }

  private rebuildDebouncer(): void {
    this.debouncedSelection = debounce(
      (ev: SelectionEvent) => this.onSelection(ev),
      this.settings.showDelayMs,
      true
    );
  }

  private onSelection(ev: SelectionEvent): void {
    // Don't fight the AI panel for screen space.
    if (this.aiPanel.isVisible()) {
      this.toolbar.hide();
      return;
    }
    // Nor the inline AI edit (a CM6 widget, not the panel) — hide while it's open.
    if (getInline(ev.view)) {
      this.toolbar.hide();
      return;
    }
    if (this.mouseDown) {
      this.toolbar.hide();
      return;
    }
    if (!ev.hasSelection || ev.length < this.settings.minSelectionLength) {
      this.toolbar.hide();
      return;
    }
    this.toolbar.show(ev.view);
  }

  private async refreshCli(): Promise<void> {
    this.cli = await resolveCli(this.settings.claudeCliPath);
  }

  /** Built-in presets + user-defined custom actions (read live from settings). */
  private aiActions(): AIAction[] {
    return [...AI_ACTIONS, ...this.settings.customActions.map(customToAction)];
  }

  /** Registered once at load (NOT in buildToolbar, which re-runs on save). */
  private registerCommands(): void {
    for (const cmd of COMMANDS) {
      this.addCommand({
        id: `format-${cmd.id}`,
        name: cmd.label,
        editorCallback: (editor) => cmd.apply(editor),
      });
    }
    this.addCommand({
      id: "ai-open",
      name: "AI: open actions for selection",
      editorCheckCallback: (checking, editor) => this.aiCommand(checking, editor),
    });
    // One command per input-free preset (so each can take a hotkey).
    for (const a of AI_ACTIONS) {
      if (a.needsInput) continue; // tone/translate/custom are reached via "ai-open"
      this.addCommand({
        id: `ai-${a.id}`,
        name: `AI: ${a.label}`,
        editorCheckCallback: (checking, editor) => this.aiCommand(checking, editor, { actionId: a.id }),
      });
    }
    this.addCommand({
      id: "ai-repeat",
      name: "AI: repeat last action",
      editorCheckCallback: (checking, editor) => this.aiCommand(checking, editor, { repeat: true }),
    });
  }

  /** Gate AI commands on a selection; when fired, open the panel for it. */
  private aiCommand(checking: boolean, editor: Editor, opts: OpenOptions = {}): boolean {
    const ok = this.settings.aiEnabled && editor.somethingSelected();
    if (checking) return ok;
    if (!ok) return false;
    const cm = (editor as unknown as { cm?: EditorView }).cm;
    if (!cm) return false;
    this.toolbar.hide();
    this.aiPanel.open(cm, editor, opts);
    return true;
  }

  /** Used by the settings "Test connection" button. */
  async runConnectionTest(): Promise<{ ok: boolean; message: string }> {
    await this.refreshCli();
    return testConnection(this.cli, this.settings.aiModelQuick || "haiku");
  }

  private aiConfig(): AIConfig {
    return {
      cli: this.cli,
      model: this.settings.aiModel,
      modelQuick: this.settings.aiModelQuick,
      outputMode: this.settings.aiOutputMode,
      showDiff: this.settings.aiShowDiff,
    };
  }

  /** Run an AI action inline in the editor (loading pill → diff → accept/discard). */
  private runInline(view: EditorView, editor: Editor, action: AIAction, input: string): void {
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    const original = editor.getSelection();
    if (!original) return;
    // The inline card replaces the toolbar — never show both at once.
    this.toolbar.hide();
    this.lastInline = { view, action, input };
    this.streamInline(view, from, to, original, action, input);
  }

  private streamInline(
    view: EditorView,
    from: number,
    to: number,
    original: string,
    action: AIAction,
    input: string
  ): void {
    this.inlineAbort?.abort();
    const controller = new AbortController();
    this.inlineAbort = controller;
    const cfg = this.aiConfig();
    const model = action.model || (action.quick ? cfg.modelQuick : cfg.model);
    const clear = () => view.dispatch({ effects: setInline.of(null) });

    const cb: InlineCallbacks = {
      onAccept: () => {
        const s = getInline(view);
        if (s) {
          view.dispatch({
            changes: { from: s.from, to: s.to, insert: s.suggestion },
            effects: setInline.of(null),
          });
        }
        this.inlineAbort = null;
      },
      onDiscard: () => {
        controller.abort();
        clear();
        this.inlineAbort = null;
      },
      onRetry: () => {
        const li = this.lastInline;
        if (!li) return;
        const s = getInline(view);
        this.streamInline(view, s ? s.from : from, s ? s.to : to, original, li.action, li.input);
      },
      onStop: () => controller.abort(),
    };

    view.dispatch({
      effects: setInline.of({ from, to, original, suggestion: "", status: "loading", cb }),
    });

    let acc = "";
    let lastTick = 0;
    void streamCompletion({
      cli: cfg.cli,
      model,
      system: action.system,
      user: buildUserMessage(action, original, input),
      signal: controller.signal,
      onDelta: (d) => {
        acc += d;
        // Show the result appearing live (throttled to limit re-renders).
        const now = Date.now();
        if (now - lastTick >= 60) {
          lastTick = now;
          view.dispatch({ effects: patchInline.of({ suggestion: acc, status: "loading" }) });
        }
      },
    })
      .then(() => {
        if (controller.signal.aborted) return;
        view.dispatch({ effects: patchInline.of({ suggestion: acc.trim(), status: "review" }) });
      })
      .catch((e) => {
        if (isAbort(e)) {
          if (acc.trim()) view.dispatch({ effects: patchInline.of({ suggestion: acc.trim(), status: "review" }) });
          else clear();
          return;
        }
        clear();
        new Notice(describeError(e));
      });
  }

  private buildToolbar(): void {
    const aiReady = this.settings.aiEnabled;
    this.toolbar = new SelectionToolbar({
      commands: commandsFor(this.settings.enabledCommandIds),
      resolveEditor: (view) => this.resolveEditor(view),
      onAI: aiReady ? (view, editor) => this.aiPanel.open(view, editor) : undefined,
      maxButtons: this.settings.toolbarMaxButtons,
      multiRow: this.settings.toolbarMultiRow,
      columns: this.settings.toolbarColumns,
    });
    this.addChild(this.toolbar);
  }

  /** Map a CM EditorView to the Obsidian Editor of the matching markdown leaf. */
  private resolveEditor(view: EditorView): Editor | null {
    let found: Editor | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (found) return;
      const v = leaf.view;
      if (v instanceof MarkdownView) {
        // editor.cm is the underlying CM6 EditorView (not in the public types).
        const cm = (v.editor as unknown as { cm?: EditorView }).cm;
        if (cm === view) found = v.editor;
      }
    });
    return found;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Rebuild dependent pieces so changes apply live.
    await this.refreshCli();
    this.rebuildDebouncer();
    this.removeChild(this.toolbar);
    this.buildToolbar();
  }

  onunload(): void {
    // Toolbar + AI panel (child Components), DOM events, and the editor
    // extension are all cleaned up automatically by Obsidian.
  }
}
