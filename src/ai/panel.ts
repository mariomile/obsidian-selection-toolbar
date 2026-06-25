import { Component, Notice, setIcon, type Editor, type EditorPosition } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { computePosition, autoUpdate, offset, flip, shift } from "@floating-ui/dom";
import { AI_ACTIONS } from "./actions";
import { buildUserMessage, type AIAction } from "./types";
import { streamCompletion, describeError, isAbort, type ResolvedCli } from "./client";
import { selectionRect } from "../utils/editor";

export interface AIConfig {
  cli: ResolvedCli;
  model: string;
  outputMode: "preview" | "direct";
}

export interface AIPanelDeps {
  getConfig: () => AIConfig;
}

/** Floating panel anchored to the selection: pick an action → stream Claude. */
export class AIPanel extends Component {
  private el: HTMLElement;
  private actionsEl!: HTMLElement;
  private promptInput!: HTMLInputElement;
  private outputEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private footerEl!: HTMLElement;

  private editor: Editor | null = null;
  private from: EditorPosition | null = null;
  private to: EditorPosition | null = null;
  private original = "";
  private result = "";
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
  }

  private build(): void {
    this.actionsEl = this.el.createDiv({ cls: "selection-ai-actions" });
    for (const action of AI_ACTIONS) {
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

    const row = this.el.createDiv({ cls: "selection-ai-prompt-row" });
    this.promptInput = row.createEl("input", {
      cls: "selection-ai-prompt",
      attr: { type: "text", placeholder: "Describe an edit, or pick an action above…" },
    });
    this.registerDomEvent(this.promptInput, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
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

  open(view: EditorView, editor: Editor): void {
    this.reset();
    this.editor = editor;
    this.from = editor.getCursor("from");
    this.to = editor.getCursor("to");
    this.original = editor.getSelection();

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
    const custom = AI_ACTIONS.find((a) => a.id === "custom")!;
    void this.generate(custom, input);
  }

  private async generate(action: AIAction, input: string): Promise<void> {
    const cfg = this.deps.getConfig();
    if (!this.editor || !this.from || !this.to) return;

    this.lastAction = action;
    this.lastInput = input;
    this.generating = true;
    this.result = "";
    this.controller = new AbortController();

    const direct = cfg.outputMode === "direct";
    this.outputEl.removeClass("is-empty");
    this.outputEl.setText("");
    this.setStatus(direct ? "Writing into the editor…" : "Generating with Claude Code…");
    this.renderFooter([{ label: "Stop", onClick: () => this.cancel() }]);

    if (direct) {
      // Clear the selection once, then append deltas at a tracked cursor.
      this.editor.replaceRange("", this.from, this.to);
      this.directEnd = { ...this.from };
    }

    try {
      await streamCompletion({
        cli: cfg.cli,
        model: cfg.model,
        system: action.system,
        user: buildUserMessage(action, this.original, input),
        signal: this.controller.signal,
        onDelta: (delta) => this.onDelta(delta, direct),
      });
    } catch (e) {
      if (isAbort(e)) {
        if (direct) this.restoreDirect();
        this.generating = false;
        return;
      }
      if (direct) this.restoreDirect();
      this.setStatus(describeError(e), true);
      new Notice(describeError(e));
      this.renderFooter([
        { label: "Retry", cta: true, onClick: () => this.retry() },
        { label: "Close", onClick: () => this.close() },
      ]);
      this.generating = false;
      return;
    }

    this.generating = false;
    if (direct) {
      this.close();
      return;
    }
    this.setStatus("Done.");
    this.renderFooter([
      { label: "Replace", cta: true, onClick: () => this.accept() },
      { label: "Retry", onClick: () => this.retry() },
      { label: "Discard", onClick: () => this.close() },
    ]);
  }

  private onDelta(delta: string, direct: boolean): void {
    this.result += delta;
    if (direct && this.editor && this.directEnd) {
      this.editor.replaceRange(delta, this.directEnd);
      const offsetEnd = this.editor.posToOffset(this.directEnd) + delta.length;
      this.directEnd = this.editor.offsetToPos(offsetEnd);
    } else {
      this.outputEl.setText(this.result);
      this.outputEl.scrollTop = this.outputEl.scrollHeight;
    }
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

  private accept(): void {
    if (this.editor && this.from && this.to && this.result) {
      this.editor.replaceRange(this.result, this.from, this.to);
    }
    this.close();
  }

  private retry(): void {
    if (this.lastAction) void this.generate(this.lastAction, this.lastInput);
  }

  private cancel(): void {
    this.controller?.abort();
  }

  private renderFooter(buttons: Array<{ label: string; cta?: boolean; onClick: () => void }>): void {
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
    this.editor = null;
    this.from = null;
    this.to = null;
    this.original = "";
    this.result = "";
    this.directEnd = null;
    this.generating = false;
    this.selectedAction = null;
    this.promptInput.value = "";
    this.promptInput.placeholder = "Describe an edit, or pick an action above…";
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
