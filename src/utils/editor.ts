import type { EditorView } from "@codemirror/view";
import type { VirtualElement } from "@floating-ui/dom";

/**
 * Build a Floating UI virtual reference element spanning the whole selection,
 * from CodeMirror's `coordsAtPos` (viewport pixel rect). Returns null when the
 * selection endpoints aren't currently laid out (e.g. scrolled out of view).
 */
export function selectionRect(view: EditorView): VirtualElement | null {
  const { from, to } = view.state.selection.main;
  const a = view.coordsAtPos(from);
  const b = view.coordsAtPos(to);
  if (!a || !b) return null;

  const left = Math.min(a.left, b.left);
  const right = Math.max(a.right, b.right);
  const top = Math.min(a.top, b.top);
  const bottom = Math.max(a.bottom, b.bottom);

  return {
    getBoundingClientRect: () => ({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      top,
      right,
      bottom,
      left,
    }),
  };
}
