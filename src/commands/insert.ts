import type { Editor } from "obsidian";

/** [selection](url) with the "url" placeholder pre-selected for quick typing. */
export function applyLink(editor: Editor): void {
  const sel = editor.getSelection();
  const from = editor.getCursor("from");
  editor.replaceSelection(`[${sel}](url)`);
  // Offset to the "url" placeholder: "[" + sel + "](" === sel.length + 3
  const urlStart = editor.offsetToPos(editor.posToOffset(from) + sel.length + 3);
  const urlEnd = editor.offsetToPos(editor.posToOffset(urlStart) + 3);
  editor.setSelection(urlStart, urlEnd);
}

/** [[selection]] internal link. */
export function applyInternalLink(editor: Editor): void {
  const sel = editor.getSelection();
  editor.replaceSelection(`[[${sel}]]`);
}

/** Strip common inline + line markdown markers from the selection. */
export function applyClearFormatting(editor: Editor): void {
  let sel = editor.getSelection();
  const patterns: Array<[RegExp, string]> = [
    [/\*\*(.*?)\*\*/g, "$1"],
    [/~~(.*?)~~/g, "$1"],
    [/==(.*?)==/g, "$1"],
    [/`(.*?)`/g, "$1"],
    [/\*(.*?)\*/g, "$1"],
    [/_(.*?)_/g, "$1"],
    [/^#{1,6}\s/gm, ""],
    [/^>\s/gm, ""],
  ];
  for (const [re, rep] of patterns) sel = sel.replace(re, rep);
  editor.replaceSelection(sel);
}
