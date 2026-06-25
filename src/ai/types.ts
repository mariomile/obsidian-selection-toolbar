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
}

/** Resolve the user message for an action. */
export function buildUserMessage(action: AIAction, selection: string, input: string): string {
  return action.buildUser ? action.buildUser(selection, input.trim()) : selection;
}
