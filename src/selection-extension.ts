import { EditorView, type ViewUpdate } from "@codemirror/view";

export interface SelectionEvent {
  view: EditorView;
  hasSelection: boolean;
  length: number;
}

/**
 * Build a CM6 extension that forwards selection/geometry changes to `onChange`.
 * Forwards raw events — debouncing (and the "show delay" policy) lives in the
 * plugin so it can be tuned live from settings without reloading.
 */
export function selectionToolbarExtension(onChange: (e: SelectionEvent) => void) {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.selectionSet || update.docChanged || update.geometryChanged) {
      const sel = update.state.selection.main;
      onChange({
        view: update.view,
        hasSelection: !sel.empty,
        length: sel.to - sel.from,
      });
    }
  });
}
