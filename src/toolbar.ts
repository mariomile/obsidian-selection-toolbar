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
  /** Max command buttons in the bar before the rest go to a ⋯ menu (0 = all). */
  maxButtons: number;
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

  // Overflow ("More") menu
  private overflowEl: HTMLElement | null = null;
  private moreBtn: HTMLElement | null = null;
  private overflowVisible = false;

  constructor(private deps: ToolbarDeps) {
    super();
    this.el = document.body.createDiv({ cls: "selection-toolbar" });
    this.el.setAttribute("role", "toolbar");
    this.el.hide();
    this.buildButtons();

    // Dismiss the overflow menu on an outside click. (Toolbar buttons
    // stopPropagation on mousedown, so clicking ⋯ itself won't self-close.)
    this.registerDomEvent(document, "mousedown", (e) => {
      if (!this.overflowVisible) return;
      const t = e.target as Node;
      if (this.overflowEl?.contains(t) || this.moreBtn?.contains(t)) return;
      this.hideOverflow();
    });
  }

  private buildButtons(): void {
    this.el.empty();
    this.buttons.clear();
    this.destroyOverflow();

    const cmds = this.deps.commands;
    const max = this.deps.maxButtons;
    let visible = cmds;
    let overflow: ToolbarCommand[] = [];
    if (max > 0 && cmds.length > max) {
      visible = cmds.slice(0, max - 1);
      overflow = cmds.slice(max - 1);
    }

    let prevGroup: string | null = null;
    for (const cmd of visible) {
      if (prevGroup && cmd.group !== prevGroup) this.addSeparator(this.el);
      prevGroup = cmd.group;
      const btn = this.makeButton(this.el, cmd.icon, cmd.label, () => this.runCommand(cmd));
      this.buttons.set(cmd.id, btn);
    }

    if (overflow.length) {
      this.addSeparator(this.el);
      this.moreBtn = this.makeButton(this.el, "ellipsis", "More", () => this.toggleOverflow());
      this.buildOverflow(overflow);
    }

    if (this.deps.onAI) {
      this.addSeparator(this.el);
      const ai = this.makeButton(this.el, "wand-2", "AI actions", () => this.runAI());
      ai.addClass("is-ai");
    }
  }

  private buildOverflow(cmds: ToolbarCommand[]): void {
    this.overflowEl = document.body.createDiv({
      cls: "selection-toolbar selection-toolbar-overflow",
    });
    this.overflowEl.setAttribute("role", "toolbar");
    this.overflowEl.hide();

    let prevGroup: string | null = null;
    for (const cmd of cmds) {
      if (prevGroup && cmd.group !== prevGroup) this.addSeparator(this.overflowEl);
      prevGroup = cmd.group;
      const btn = this.makeButton(this.overflowEl, cmd.icon, cmd.label, () => {
        this.runCommand(cmd);
        this.hideOverflow();
      });
      this.buttons.set(cmd.id, btn);
    }
  }

  private addSeparator(parent: HTMLElement): void {
    parent.createDiv({ cls: "selection-toolbar-sep" });
  }

  private makeButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void
  ): HTMLElement {
    const btn = parent.createDiv({
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

  private toggleOverflow(): void {
    if (this.overflowVisible) this.hideOverflow();
    else this.showOverflow();
  }

  private showOverflow(): void {
    if (!this.overflowEl || !this.moreBtn) return;
    this.overflowEl.show();
    this.overflowVisible = true;
    computePosition(this.moreBtn, this.overflowEl, {
      placement: "bottom",
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      if (!this.overflowEl) return;
      this.overflowEl.style.left = `${x}px`;
      this.overflowEl.style.top = `${y}px`;
    });
  }

  private hideOverflow(): void {
    this.overflowEl?.hide();
    this.overflowVisible = false;
  }

  private destroyOverflow(): void {
    this.overflowEl?.remove();
    this.overflowEl = null;
    this.moreBtn = null;
    this.overflowVisible = false;
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
    this.hideOverflow();
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
    this.hideOverflow();
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
    this.destroyOverflow();
    this.el.remove();
  }
}
