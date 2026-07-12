/** Accepting an AI suggestion is safe only while its source text is unchanged. */
export function selectionMatchesOriginal(current: string, original: string): boolean {
  return current === original;
}
