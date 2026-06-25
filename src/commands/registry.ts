import type { ToolbarCommand } from "./types";
import { applyWrapToggle, isWrapActive } from "./wrap";
import { applyLinePrefixToggle } from "./line";
import { applyCodeBlock, applyComment } from "./block";
import { applyLink, applyInternalLink, applyClearFormatting } from "./insert";

/** Helper for the symmetric wrap-toggle commands. */
const wrap = (id: string, label: string, icon: string, marker: string): ToolbarCommand => ({
  id,
  label,
  icon,
  group: "format",
  apply: (e) => applyWrapToggle(e, marker),
  isActive: (e) => isWrapActive(e, marker),
});

const HEADING_MATCH = /^#{1,6}\s/;

/**
 * The full catalog. Order here is the default toolbar order; settings can
 * hide commands and reorder by selecting a subset (kept in this order).
 */
export const COMMANDS: ToolbarCommand[] = [
  // format (inline wrap-toggle)
  wrap("bold", "Bold", "bold", "**"),
  wrap("italic", "Italic", "italic", "*"),
  wrap("strikethrough", "Strikethrough", "strikethrough", "~~"),
  wrap("highlight", "Highlight", "highlighter", "=="),
  wrap("code", "Inline code", "code", "`"),

  // block (line-prefix / fenced)
  {
    id: "h1", label: "Heading 1", icon: "heading-1", group: "block",
    apply: (e) => applyLinePrefixToggle(e, { match: HEADING_MATCH, prefix: "# ", exclusive: true }),
  },
  {
    id: "h2", label: "Heading 2", icon: "heading-2", group: "block",
    apply: (e) => applyLinePrefixToggle(e, { match: HEADING_MATCH, prefix: "## ", exclusive: true }),
  },
  {
    id: "h3", label: "Heading 3", icon: "heading-3", group: "block",
    apply: (e) => applyLinePrefixToggle(e, { match: HEADING_MATCH, prefix: "### ", exclusive: true }),
  },
  {
    id: "quote", label: "Blockquote", icon: "quote", group: "block",
    apply: (e) => applyLinePrefixToggle(e, { match: /^>\s/, prefix: "> ", exclusive: true }),
  },
  {
    id: "bullet", label: "Bullet list", icon: "list", group: "block",
    apply: (e) => applyLinePrefixToggle(e, { match: /^-\s(?!\[)/, prefix: "- ", exclusive: true }),
  },
  {
    id: "number", label: "Numbered list", icon: "list-ordered", group: "block",
    apply: (e) => applyLinePrefixToggle(e, { match: /^\d+\.\s/, prefix: (_i, n) => `${n}. `, exclusive: true }),
  },
  {
    id: "checkbox", label: "Checkbox", icon: "list-checks", group: "block",
    apply: (e) => applyLinePrefixToggle(e, { match: /^-\s\[[ xX]\]\s/, prefix: "- [ ] ", exclusive: true }),
  },
  { id: "codeblock", label: "Code block", icon: "code-2", group: "block", apply: applyCodeBlock },
  { id: "comment", label: "Comment", icon: "message-square", group: "block", apply: applyComment },

  // insert
  { id: "link", label: "Link", icon: "link", group: "insert", apply: applyLink },
  { id: "internal-link", label: "Internal link", icon: "file-symlink", group: "insert", apply: applyInternalLink },
  { id: "clear", label: "Clear formatting", icon: "remove-formatting", group: "insert", apply: applyClearFormatting },
];

const ALL_IDS = COMMANDS.map((c) => c.id);

/** Resolve enabled ids (empty = all) into commands, preserving registry order. */
export function commandsFor(enabledIds: string[]): ToolbarCommand[] {
  if (!enabledIds.length) return COMMANDS;
  const enabled = new Set(enabledIds);
  return COMMANDS.filter((c) => enabled.has(c.id));
}

export { ALL_IDS };
