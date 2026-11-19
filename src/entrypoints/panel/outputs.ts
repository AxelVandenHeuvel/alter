import type { ActionOutputs } from '../../lib/userscripts';

/** Keep model-chosen file names to a safe, plain name. */
export function safeFilename(name: string): string {
  const cleaned = name
    // Control characters are exactly what this strips.
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'alter-output.txt';
}

/** Save text as a file from the panel; no downloads permission needed. */
export function saveFile(file: ActionOutputs['downloads'][number]): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename(file.filename);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

/** Deliver what an action produced. Returns problems to show, e.g. a clipboard the browser refused. */
export async function deliverOutputs(outputs: ActionOutputs | null): Promise<string[]> {
  const problems: string[] = [];
  for (const file of outputs?.downloads ?? []) saveFile(file);
  if (outputs?.clipboard !== null && outputs?.clipboard !== undefined) {
    try {
      await copyText(outputs.clipboard);
    } catch (error) {
      problems.push(`Couldn't copy to the clipboard (${error instanceof Error ? error.message : String(error)}). Use Copy again.`);
    }
  }
  return problems;
}
