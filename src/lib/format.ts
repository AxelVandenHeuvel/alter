/** Small text formatting shared by the panel and the agent. */

/** "1 rule", "3 rules". */
export function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${count} ${count === 1 ? word : pluralWord}`;
}

/** The size of produced text, the way people think of it: characters, then KB. */
export function describeSize(text: string): string {
  if (text.length < 1024) return plural(text.length, 'character');
  const kb = text.length / 1024;
  return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
}

/** How many lines a piece of code has, ignoring leading and trailing blank lines. */
export function lineCount(code: string): number {
  const trimmed = code.trim();
  return trimmed ? trimmed.split('\n').length : 0;
}
