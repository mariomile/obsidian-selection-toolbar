import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { StateField, StateEffect, type Extension } from "@codemirror/state";
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
    if (other.s.status !== this.s.status) return false;
    // Loading is visually stable (just the pill) → never rebuild while streaming.
    return this.s.status === "review" ? other.s.suggestion === this.s.suggestion : true;
  }

  toDOM(): HTMLElement {
    const box = document.createElement("div");
    box.className = "sk-inline";

    if (this.s.status === "loading") {
      box.addClass("sk-inline-loading");
      box.createSpan({ cls: "selection-ai-spinner" });
      box.createSpan({ cls: "selection-ai-working-label", text: "Claude is working…" });
      const stop = box.createEl("button", { cls: "sk-inline-stop", text: "Stop" });
      stop.onclick = (e) => {
        e.preventDefault();
        this.s.cb.onStop();
      };
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
