import { Component, Notice, setIcon, type Editor, type EditorPosition } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { computePosition, autoUpdate, offset, flip, shift } from "@floating-ui/dom";
import { buildUserMessage, type AIAction } from "./types";
import { streamCompletion, describeError, isAbort, type ResolvedCli } from "./client";
import { selectionRect } from "../utils/editor";

export interface AIConfig {
  cli: ResolvedCli;
  /** Default model. */
  model: string;
  /** Fast model for actions flagged `quick`. */
  modelQuick: string;
  outputMode: "preview" | "direct";
}

export interface AIPanelDeps {
  getConfig: () => AIConfig;
  /** Built-in + user-defined actions, re-read on every open. */
  getActions: () => AIAction[];
  /** Run the action inline in the editor (Notion-style). Used for preview mode. */
  runInline?: (view: EditorView, editor: Editor, action: AIAction, input: string) => void;
}

export interface OpenOptions {
  /** Pre-select an action by id (auto-runs it if it needs no input). */
  actionId?: string;
  /** Re-run the last action on the new selection. */
  repeat?: boolean;
}

/**
 * Floating panel anchored to the selection: pick an action or type a prompt.
 *
 * In **preview** mode (the default) it delegates to the inline editor and closes
 * immediately — the result streams into the note with a diff (see `inline.ts`).
 * In **direct** mode it streams Claude's output straight into the editor,
 * replacing the selection.
 */
export class AIPanel extends Component {
  private el: HTMLElement;
  private actionsEl!: HTMLElement;
  private promptInput!: HTMLTextAreaElement;
  private outputEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private footerEl!: HTMLElement;

  private view: EditorView | null = null;
  private editor: Editor | null = null;
  private from: EditorPosition | null = null;
  private to: EditorPosition | null = null;
  private original = "";
  private directEnd: EditorPosition | null = null;

  private controller: AbortController | null = null;
  private cleanupAutoUpdate: (() => void) | null = null;
  private visible = false;
  private generating = false;
  private selectedAction: AIAction | null = null;
  private lastAction: AIAction | null = null;
  private lastInput = "";

  constructor(private deps: AIPanelDeps) {
    super();
    this.el = document.body.createDiv({ cls: "selection-ai-panel" });
    this.el.hide();
    this.build();

    // Click anywhere outside the panel closes it (and aborts any run).
    // The toolbar's ✨ button stopPropagation's its mousedown, so the click
    // that opens the panel never reaches here.
    this.registerDomEvent(document, "mousedown", (e) => {
      if (!this.visible) return;
      if (this.el.contains(e.target as Node)) return;
      this.close();
    });
  }

  private build(): void {
    this.actionsEl = this.el.createDiv({ cls: "selection-ai-actions" });

    const row = this.el.createDiv({ cls: "selection-ai-prompt-row" });
    this.promptInput = row.createEl("textarea", {
      cls: "selection-ai-prompt",
      attr: { rows: "2", placeholder: "Ask Claude, or pick an action…" },
    });
    // Enter submits; Shift+Enter inserts a newline (multi-line prompt).
    this.registerDomEvent(this.promptInput, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.runFromInput();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });

    this.outputEl = this.el.createDiv({ cls: "selection-ai-output is-empty" });
    this.outputEl.setText("Pick an action or type an instruction.");
    this.statusEl = this.el.createDiv({ cls: "selection-ai-status" });
    this.footerEl = this.el.createDiv({ cls: "selection-ai-footer" });
  }

  private renderActions(): void {
    this.actionsEl.empty();
    for (const action of this.deps.getActions()) {
      const btn = this.actionsEl.createDiv({
        cls: "selection-ai-action",
        attr: { role: "button", tabindex: "0", "aria-label": action.label },
      });
      setIcon(btn.createSpan(), action.icon);
      btn.createSpan({ text: action.label });
      this.registerDomEvent(btn, "click", () => this.selectAction(action));
      this.registerDomEvent(btn, "keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.selectAction(action);
        }
      });
    }
  }

  open(view: EditorView, editor: Editor, opts: OpenOptions = {}): void {
    this.reset();
    this.view = view;
    this.editor = editor;
    this.from = editor.getCursor("from");
    this.to = editor.getCursor("to");
    this.original = editor.getSelection();

    this.renderActions();

    const ref = selectionRect(view);
    this.el.show();
    this.visible = true;

    this.cleanupAutoUpdate?.();
    if (ref) {
      this.cleanupAutoUpdate = autoUpdate(ref, this.el, () => {
        computePosition(ref, this.el, {
          placement: "bottom",
          middleware: [offset(8), flip({ fallbackPlacements: ["top"] }), shift({ padding: 8 })],
        }).then(({ x, y }) => {
          this.el.style.left = `${x}px`;
          this.el.style.top = `${y}px`;
        });
      });
    }
    this.promptInput.focus();

    if (opts.repeat) {
      if (this.lastAction) void this.generate(this.lastAction, this.lastInput);
      else this.setStatus("No previous AI action yet — pick one.", true);
      return;
    }
    if (opts.actionId) {
      const action = this.deps.getActions().find((a) => a.id === opts.actionId);
      if (action) this.selectAction(action);
    }
  }

  private selectAction(action: AIAction): void {
    if (this.generating) return;
    this.selectedAction = action;
    if (action.needsInput) {
      this.promptInput.placeholder = action.inputPlaceholder ?? "…";
      this.promptInput.focus();
      this.setStatus(`Type the value for "${action.label}", then press Enter.`);
      return;
    }
    void this.generate(action, "");
  }

  private runFromInput(): void {
    if (this.generating) return;
    const input = this.promptInput.value.trim();
    const selected = this.selectedAction;
    if (selected?.needsInput) {
      if (!input) {
        this.setStatus("Enter a value first.", true);
        return;
      }
      void this.generate(selected, input);
      return;
    }
    if (!input) return;
    const custom = this.deps.getActions().find((a) => a.id === "custom");
    if (custom) void this.generate(custom, input);
  }

  private async generate(action: AIAction, input: string): Promise<void> {
    const cfg = this.deps.getConfig();
    if (!this.editor || !this.from || !this.to) return;

    this.lastAction = action;
    this.lastInput = input;

    // Preview mode → run inline in the editor (Notion-style); the panel closes.
    if (cfg.outputMode !== "direct" && this.view && this.deps.runInline) {
      this.deps.runInline(this.view, this.editor, action, input);
      this.close();
      return;
    }

    // Direct mode → stream straight into the editor, replacing the selection.
    this.generating = true;
    this.controller = new AbortController();
    const model = action.model || (action.quick ? cfg.modelQuick : cfg.model);

    this.startWorking();
    this.renderFooter([{ label: "Stop", onClick: () => this.cancel() }]);

    // Clear the selection once, then append deltas at a tracked cursor.
    this.editor.replaceRange("", this.from, this.to);
    this.directEnd = { ...this.from };

    try {
      await streamCompletion({
        cli: cfg.cli,
        model,
        system: action.system,
        user: buildUserMessage(action, this.original, input),
        signal: this.controller.signal,
        onDelta: (delta) => this.onDelta(delta),
      });
    } catch (e) {
      this.generating = false;
      this.restoreDirect();
      if (isAbort(e)) {
        this.setStatus("Stopped.");
      } else {
        this.setStatus(describeError(e), true);
        new Notice(describeError(e));
      }
      this.renderFooter([
        { label: "Retry", cta: true, onClick: () => this.retry() },
        { label: "Close", onClick: () => this.close() },
      ]);
      return;
    }

    this.generating = false;
    this.close();
  }

  private onDelta(delta: string): void {
    if (!this.editor || !this.directEnd) return;
    this.editor.replaceRange(delta, this.directEnd);
    const offsetEnd = this.editor.posToOffset(this.directEnd) + delta.length;
    this.directEnd = this.editor.offsetToPos(offsetEnd);
  }

  /** Animated "working" indicator covering the cold-start dead-air. */
  private startWorking(): void {
    this.outputEl.empty();
    this.outputEl.removeClass("is-empty");
    const w = this.outputEl.createDiv({ cls: "selection-ai-working" });
    w.createSpan({ cls: "selection-ai-spinner" });
    w.createSpan({ cls: "selection-ai-working-label", text: "Writing into the editor…" });
    this.setStatus("");
  }

  /** Restore the original selection text after a failed/cancelled direct run. */
  private restoreDirect(): void {
    if (!this.editor || !this.from || !this.directEnd) return;
    this.editor.replaceRange(this.original, this.from, this.directEnd);
    this.editor.setSelection(
      this.from,
      this.editor.offsetToPos(this.editor.posToOffset(this.from) + this.original.length)
    );
    this.directEnd = null;
  }

  private retry(): void {
    if (this.lastAction) void this.generate(this.lastAction, this.lastInput);
  }

  private cancel(): void {
    this.controller?.abort();
  }

  private renderFooter(buttons: FooterButton[]): void {
    this.footerEl.empty();
    for (const b of buttons) {
      const btn = this.footerEl.createEl("button", {
        cls: b.cta ? "selection-ai-btn mod-cta" : "selection-ai-btn",
        text: b.label,
      });
      this.registerDomEvent(btn, "click", (e) => {
        e.preventDefault();
        b.onClick();
      });
    }
  }

  private setStatus(text: string, isError = false): void {
    this.statusEl.setText(text);
    this.statusEl.toggleClass("is-error", isError);
  }

  isVisible(): boolean {
    return this.visible;
  }

  close(): void {
    this.controller?.abort();
    this.controller = null;
    this.cleanupAutoUpdate?.();
    this.cleanupAutoUpdate = null;
    this.el.hide();
    this.visible = false;
    this.reset();
  }

  private reset(): void {
    this.view = null;
    this.editor = null;
    this.from = null;
    this.to = null;
    this.original = "";
    this.directEnd = null;
    this.generating = false;
    this.selectedAction = null;
    this.promptInput.value = "";
    this.promptInput.placeholder = "Ask Claude, or pick an action…";
    this.outputEl.addClass("is-empty");
    this.outputEl.setText("Pick an action or type an instruction.");
    this.setStatus("");
    this.footerEl.empty();
  }

  onunload(): void {
    this.controller?.abort();
    this.cleanupAutoUpdate?.();
    this.el.remove();
  }
}

interface FooterButton {
  label: string;
  cta?: boolean;
  onClick: () => void;
}
