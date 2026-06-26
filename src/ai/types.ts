/** A preset AI action applied to the selected text. */
export interface AIAction {
  id: string;
  label: string;
  /** Lucide icon name. */
  icon: string;
  /** System prompt describing the task. */
  system: string;
  /** If true, the action needs a free-text parameter (tone, language, …). */
  needsInput?: boolean;
  /** Placeholder shown in the prompt input when this action is the target. */
  inputPlaceholder?: string;
  /** Build the user message from selection + optional input. Default: selection. */
  buildUser?: (selection: string, input: string) => string;
  /** Use the configured "quick" (fast) model — for high-frequency simple edits. */
  quick?: boolean;
  /** Explicit model override (used by custom actions). Wins over quick/default. */
  model?: string;
  /** Marks user-defined actions (vs built-in presets). */
  custom?: boolean;
}

/** A user-defined action, persisted in settings. */
export interface CustomAction {
  id: string;
  label: string;
  system: string;
  needsInput: boolean;
  inputPlaceholder?: string;
  /** "" / "default" → use the global default model. */
  model: string;
}

/** Resolve the user message for an action. */
export function buildUserMessage(action: AIAction, selection: string, input: string): string {
  return action.buildUser ? action.buildUser(selection, input.trim()) : selection;
}
