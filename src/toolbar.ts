import { Component, setIcon, type Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";
import {
  computePosition,
  autoUpdate,
  offset,
  flip,
  shift,
  type VirtualElement,
} from "@floating-ui/dom";
import type { ToolbarCommand } from "./commands/types";
import { selectionRect } from "./utils/editor";

export interface ToolbarDeps {
  commands: ToolbarCommand[];
  /** Map a CM view to its Obsidian Editor (owned by the plugin). */
  resolveEditor: (view: EditorView) => Editor | null;
  /** When set, an AI (✨) button is rendered that calls this on click. */
  onAI?: (view: EditorView, editor: Editor) => void;
}

/**
 * The single floating formatting toolbar. Lives on document.body (escapes the
 * editor's overflow clipping), is re-pointed to whichever pane fired, and is
 * positioned over the selection with Floating UI.
 */
export class SelectionToolbar extends Component {
  private el: HTMLElement;
  private buttons = new Map<string, HTMLElement>();
  private currentView: EditorView | null = null;
  private cleanupAutoUpdate: (() => void) | null = null;
  private visible = false;

  constructor(private deps: ToolbarDeps) {
    super();
    this.el = document.body.createDiv({ cls: "selection-toolbar" });
    this.el.setAttribute("role", "toolbar");
    this.el.hide();
    this.buildButtons();
  }

  private buildButtons(): void {
    this.el.empty();
    this.buttons.clear();
    let prevGroup: string | null = null;

    for (const cmd of this.deps.commands) {
      if (prevGroup && cmd.group !== prevGroup) this.addSeparator();
      prevGroup = cmd.group;
      const btn = this.makeButton(cmd.icon, cmd.label, () => this.runCommand(cmd));
      this.buttons.set(cmd.id, btn);
    }

    if (this.deps.onAI) {
      this.addSeparator();
      const ai = this.makeButton("wand-2", "AI actions", () => this.runAI());
      ai.addClass("is-ai");
    }
  }

  private addSeparator(): void {
    this.el.createDiv({ cls: "selection-toolbar-sep" });
  }

  private makeButton(icon: string, label: string, onClick: () => void): HTMLElement {
    const btn = this.el.createDiv({
      cls: "selection-toolbar-btn",
      attr: { "aria-label": label, role: "button", tabindex: "0" },
    });
    setIcon(btn, icon);
    // CRITICAL: preventDefault on mousedown so clicking the button does NOT
    // move focus out of the editor and collapse the selection before onClick.
    this.registerDomEvent(btn, "mousedown", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    this.registerDomEvent(btn, "click", (evt) => {
      evt.preventDefault();
      onClick();
    });
    this.registerDomEvent(btn, "keydown", (evt: KeyboardEvent) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        onClick();
      }
    });
    return btn;
  }

  private runCommand(cmd: ToolbarCommand): void {
    if (!this.currentView) return;
    const editor = this.deps.resolveEditor(this.currentView);
    if (!editor) return;
    cmd.apply(editor);
    // The selection changed → the updateListener re-evaluates and we reposition
    // or hide. Refresh active states immediately for snappy feedback.
    this.refreshActiveStates();
  }

  private runAI(): void {
    if (!this.currentView || !this.deps.onAI) return;
    const editor = this.deps.resolveEditor(this.currentView);
    if (!editor) return;
    const view = this.currentView;
    this.hide();
    this.deps.onAI(view, editor);
  }

  show(view: EditorView): void {
    this.currentView = view;
    const ref = selectionRect(view);
    if (!ref) {
      this.hide();
      return;
    }
    this.el.show();
    this.visible = true;
    this.refreshActiveStates();
    this.track(ref);
  }

  private track(ref: VirtualElement): void {
    this.cleanupAutoUpdate?.();
    this.cleanupAutoUpdate = autoUpdate(ref, this.el, () => {
      computePosition(ref, this.el, {
        placement: "top",
        middleware: [offset(8), flip({ fallbackPlacements: ["bottom"] }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        this.el.style.left = `${x}px`;
        this.el.style.top = `${y}px`;
      });
    });
  }

  private refreshActiveStates(): void {
    if (!this.currentView) return;
    const editor = this.deps.resolveEditor(this.currentView);
    if (!editor) return;
    for (const cmd of this.deps.commands) {
      const btn = this.buttons.get(cmd.id);
      if (btn) btn.toggleClass("is-active", !!cmd.isActive?.(editor));
    }
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.el.hide();
    this.cleanupAutoUpdate?.();
    this.cleanupAutoUpdate = null;
    this.currentView = null;
  }

  isVisible(): boolean {
    return this.visible;
  }

  onunload(): void {
    this.cleanupAutoUpdate?.();
    this.el.remove();
  }
}
