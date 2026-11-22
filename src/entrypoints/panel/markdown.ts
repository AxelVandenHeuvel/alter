/**
 * The little Markdown Claude writes in replies: paragraphs, bullet and numbered lists, headings,
 * **bold**, *italic*, and `code`. Parsed into plain data that components render as React
 * elements, never as HTML, so nothing in a reply can inject markup. Anything else stays as
 * written.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string };

export type Block =
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'heading'; content: Inline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Inline[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: Inline[][] | null = null;
  let list: Extract<Block, { kind: 'list' }> | null = null;
  const end = () => {
    paragraph = null;
    list = null;
  };

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') {
      end();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      end();
      blocks.push({ kind: 'heading', content: parseInline(heading[1]!.trim()) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = numbered !== null;
      if (!list || list.ordered !== ordered) {
        paragraph = null;
        list = { kind: 'list', ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
        blocks.push(list);
      }
      list.items.push(parseInline((bullet ? bullet[1]! : numbered![2]!).trim()));
      continue;
    }
    if (list) {
      // A line under a list item continues it.
      const items: Inline[][] = list.items;
      items[items.length - 1]!.push({ kind: 'text', text: ' ' }, ...parseInline(line.trim()));
      continue;
    }
    if (!paragraph) {
      paragraph = [];
      blocks.push({ kind: 'paragraph', lines: paragraph });
    }
    paragraph.push(parseInline(line.trim()));
  }
  return blocks;
}

/** `code` first (nothing inside it is formatting), then **bold**, then *italic*. */
const INLINE = /`([^`\n]+)`|\*\*(.+?)\*\*|__(.+?)__|\*(?![\s*])(.+?)(?<![\s*])\*/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push({ kind: 'text', text: text.slice(last, match.index) });
    const [, code, bold, underscored, italic] = match;
    if (code !== undefined) out.push({ kind: 'code', text: code });
    else if (bold !== undefined || underscored !== undefined) out.push({ kind: 'strong', children: parseInline(bold ?? underscored!) });
    else out.push({ kind: 'em', children: parseInline(italic!) });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
