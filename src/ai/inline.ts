import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { StateField, StateEffect, type Extension } from "@codemirror/state";
import { setIcon } from "obsidian";
import { wordDiff } from "./diff";

export interface InlineCallbacks {
  onAccept: () => void;
  onDiscard: () => void;
  onRetry: () => void;
  onStop: () => void;
}

export interface InlineState {
  from: number;
  to: number;
  original: string;
  suggestion: string;
  status: "loading" | "review";
  cb: InlineCallbacks;
}

/** Replace / clear the whole inline edit. */
export const setInline = StateEffect.define<InlineState | null>();
/** Update suggestion text + status of the current inline edit. */
export const patchInline = StateEffect.define<{ suggestion: string; status: "loading" | "review" }>();

export const inlineField = StateField.define<InlineState | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setInline)) value = e.value;
      else if (e.is(patchInline) && value) {
        value = { ...value, suggestion: e.value.suggestion, status: e.value.status };
      }
    }
    // Keep the anchor valid if the doc changes elsewhere while we're pending.
    if (value && tr.docChanged) {
      value = {
        ...value,
        from: tr.changes.mapPos(value.from),
        to: tr.changes.mapPos(value.to, 1),
      };
    }
    return value;
  },
});

class InlineWidget extends WidgetType {
  constructor(private s: InlineState) {
    super();
  }

  eq(other: InlineWidget): boolean {
    return other.s.status === this.s.status && other.s.suggestion === this.s.suggestion;
  }

  toDOM(): HTMLElement {
    const box = document.createElement("div");
    box.className = "sk-inline";

    if (this.s.status === "loading") {
      if (this.s.suggestion) {
        // Streaming: show the result appearing live, with a trailing caret.
        const txt = box.createDiv({ cls: "sk-inline-streamtext" });
        txt.setText(this.s.suggestion);
        txt.createSpan({ cls: "sk-inline-caret" });
        const bar = box.createDiv({ cls: "sk-inline-bar" });
        this.makeStop(bar);
      } else {
        // Pre-first-token: a skeleton that previews the shape of the incoming
        // text. Reads as "almost here" — feels faster than an indeterminate spinner.
        box.addClass("sk-inline-loading");
        const skel = box.createDiv({ cls: "sk-inline-skeleton" });
        skel.createDiv({ cls: "sk-inline-skel-line" });
        skel.createDiv({ cls: "sk-inline-skel-line" });
        skel.createDiv({ cls: "sk-inline-skel-line is-short" });
        const foot = box.createDiv({ cls: "sk-inline-foot" });
        foot.createSpan({ cls: "sk-inline-label", text: "Claude is writing…" });
        this.makeStop(foot);
      }
      return box;
    }

    box.addClass("sk-inline-review");
    const diff = box.createDiv({ cls: "sk-inline-diff" });
    for (const seg of wordDiff(this.s.original, this.s.suggestion)) {
      const cls =
        seg.type === "del" ? "selection-ai-del" : seg.type === "add" ? "selection-ai-add" : undefined;
      diff.createSpan(cls ? { cls, text: seg.text } : { text: seg.text });
    }
    const bar = box.createDiv({ cls: "sk-inline-bar" });
    const btn = (label: string, cta: boolean, fn: () => void) => {
      const b = bar.createEl("button", {
        cls: cta ? "selection-ai-btn mod-cta" : "selection-ai-btn",
        text: label,
      });
      b.onclick = (e) => {
        e.preventDefault();
        fn();
      };
    };
    btn("Accept", true, () => this.s.cb.onAccept());
    btn("Retry", false, () => this.s.cb.onRetry());
    btn("Discard", false, () => this.s.cb.onDiscard());
    return box;
  }

  private makeStop(parent: HTMLElement): void {
    const stop = parent.createEl("button", { cls: "sk-inline-stop", attr: { "aria-label": "Stop" } });
    setIcon(stop.createSpan({ cls: "sk-inline-stop-icon" }), "square");
    stop.createSpan({ text: "Stop" });
    stop.onclick = (e) => {
      e.preventDefault();
      this.s.cb.onStop();
    };
  }

  ignoreEvent(): boolean {
    // Let our buttons handle clicks; don't route events to the editor.
    return true;
  }
}

const inlineDecorations = EditorView.decorations.compute([inlineField], (state) => {
  const s = state.field(inlineField);
  if (!s) return Decoration.none;
  const anchor = Math.min(s.to, state.doc.length);
  const lineEnd = state.doc.lineAt(anchor).to;
  const widget = Decoration.widget({ widget: new InlineWidget(s), side: 1, block: true });
  return Decoration.set([widget.range(lineEnd)]);
});

export function inlineExtension(): Extension {
  return [inlineField, inlineDecorations];
}

/** Read the current inline edit from a view (null if none). */
export function getInline(view: EditorView): InlineState | null {
  return view.state.field(inlineField, false) ?? null;
}
