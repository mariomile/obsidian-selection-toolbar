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
  /** Show a before/after diff in preview mode. */
  showDiff: boolean;
}

export interface AIPanelDeps {
  getConfig: () => AIConfig;
  /** Built-in + user-defined actions, re-read on every open. */
  getActions: () => AIAction[];
}

export interface OpenOptions {
  /** Pre-select an action by id (auto-runs it if it needs no input). */
  actionId?: string;
  /** Re-run the last action on the new selection. */
  repeat?: boolean;
}

const DIFF_CHAR_CAP = 6000;

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

  // Working-state UI
  private firstDelta = false;
  private textEl: HTMLElement | null = null;

  // Diff
  private canDiff = false;
  private showingDiff = false;

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
    this.generating = true;
    this.result = "";
    this.showingDiff = false;
    this.controller = new AbortController();

    const direct = cfg.outputMode === "direct";
    const model = action.model || (action.quick ? cfg.modelQuick : cfg.model);

    this.startWorking(direct);
    this.renderFooter([{ label: "Stop", onClick: () => this.cancel() }]);

    if (direct) {
      // Clear the selection once, then append deltas at a tracked cursor.
      this.editor.replaceRange("", this.from, this.to);
      this.directEnd = { ...this.from };
    }

    try {
      await streamCompletion({
        cli: cfg.cli,
        model,
        system: action.system,
        user: buildUserMessage(action, this.original, input),
        signal: this.controller.signal,
        onDelta: (delta) => this.onDelta(delta, direct),
      });
    } catch (e) {
      this.generating = false;
      if (direct) this.restoreDirect();
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
    if (direct) {
      this.close();
      return;
    }
    this.setStatus("Done.");
    this.canDiff =
      cfg.showDiff &&
      this.original.trim().length > 0 &&
      this.result.trim() !== this.original.trim() &&
      this.original.length + this.result.length <= DIFF_CHAR_CAP;
    this.showingDiff = this.canDiff;
    this.renderOutput();
    this.renderResultFooter();
  }

  private onDelta(delta: string, direct: boolean): void {
    this.result += delta;
    if (direct && this.editor && this.directEnd) {
      this.editor.replaceRange(delta, this.directEnd);
      const offsetEnd = this.editor.posToOffset(this.directEnd) + delta.length;
      this.directEnd = this.editor.offsetToPos(offsetEnd);
      return;
    }
    if (!this.firstDelta) {
      // First token arrived: drop the working spinner, start showing text.
      this.firstDelta = true;
      this.outputEl.empty();
      this.outputEl.removeClass("is-empty");
      this.textEl = this.outputEl.createSpan({ cls: "selection-ai-text" });
      this.outputEl.createSpan({ cls: "selection-ai-caret" });
      this.setStatus("Streaming…");
    }
    this.textEl?.setText(this.result);
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  /** Animated "working" indicator covering the cold-start dead-air. */
  private startWorking(direct: boolean): void {
    this.firstDelta = false;
    this.textEl = null;
    this.outputEl.empty();
    this.outputEl.removeClass("is-empty");
    const w = this.outputEl.createDiv({ cls: "selection-ai-working" });
    w.createSpan({ cls: "selection-ai-spinner" });
    w.createSpan({
      cls: "selection-ai-working-label",
      text: direct ? "Writing into the editor…" : "Claude is working…",
    });
    this.setStatus("");
  }

  private renderOutput(): void {
    this.outputEl.empty();
    this.outputEl.removeClass("is-empty");
    if (this.showingDiff) {
      for (const seg of wordDiff(this.original, this.result)) {
        const cls =
          seg.type === "del"
            ? "selection-ai-del"
            : seg.type === "add"
            ? "selection-ai-add"
            : undefined;
        this.outputEl.createSpan(cls ? { cls, text: seg.text } : { text: seg.text });
      }
    } else {
      this.outputEl.setText(this.result);
    }
  }

  private renderResultFooter(): void {
    const buttons: FooterButton[] = [{ label: "Replace", cta: true, onClick: () => this.accept() }];
    if (this.canDiff) {
      buttons.push({
        label: this.showingDiff ? "Show result" : "Show diff",
        onClick: () => {
          this.showingDiff = !this.showingDiff;
          this.renderOutput();
          this.renderResultFooter();
        },
      });
    }
    buttons.push({ label: "Insert below", onClick: () => this.insertBelow() });
    buttons.push({ label: "Retry", onClick: () => this.retry() });
    buttons.push({ label: "Discard", onClick: () => this.close() });
    this.renderFooter(buttons);
  }

  /** Non-destructive: keep the selection, add the result on a new line after it. */
  private insertBelow(): void {
    if (this.editor && this.to && this.result) {
      const eol = { line: this.to.line, ch: this.editor.getLine(this.to.line).length };
      this.editor.replaceRange(`\n\n${this.result}`, eol, eol);
    }
    this.close();
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
    this.editor = null;
    this.from = null;
    this.to = null;
    this.original = "";
    this.result = "";
    this.directEnd = null;
    this.generating = false;
    this.selectedAction = null;
    this.firstDelta = false;
    this.textEl = null;
    this.canDiff = false;
    this.showingDiff = false;
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

interface FooterButton {
  label: string;
  cta?: boolean;
  onClick: () => void;
}

type DiffSeg = { type: "eq" | "del" | "add"; text: string };

/** Word-level diff (LCS over whitespace/word tokens). No dependencies. */
function wordDiff(a: string, b: string): DiffSeg[] {
  const A = a.match(/\s+|[^\s]+/g) ?? [];
  const B = b.match(/\s+|[^\s]+/g) ?? [];
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const segs: DiffSeg[] = [];
  const push = (type: DiffSeg["type"], text: string) => {
    const last = segs[segs.length - 1];
    if (last && last.type === type) last.text += text;
    else segs.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push("eq", A[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", A[i]);
      i++;
    } else {
      push("add", B[j]);
      j++;
    }
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("add", B[j++]);
  return segs;
}
