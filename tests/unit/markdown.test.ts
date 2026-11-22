import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../../src/entrypoints/panel/markdown';

const text = (t: string) => ({ kind: 'text', text: t });

describe('parseInline', () => {
  it('reads bold, italic, and code', () => {
    expect(parseInline('a **b** *c* `d`')).toEqual([
      text('a '),
      { kind: 'strong', children: [text('b')] },
      text(' '),
      { kind: 'em', children: [text('c')] },
      text(' '),
      { kind: 'code', text: 'd' },
    ]);
  });

  it('formats inside bold, but not inside code', () => {
    expect(parseInline('**a *b* c**')).toEqual([{ kind: 'strong', children: [text('a '), { kind: 'em', children: [text('b')] }, text(' c')] }]);
    expect(parseInline('`**not bold**`')).toEqual([{ kind: 'code', text: '**not bold**' }]);
  });

  it('leaves lone stars, multiplication, and snake_case alone', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
    expect(parseInline('font_size and max_width')).toEqual([text('font_size and max_width')]);
    expect(parseInline('**unclosed')).toEqual([text('**unclosed')]);
  });
});

describe('parseMarkdown', () => {
  it('splits paragraphs on blank lines and keeps line breaks inside them', () => {
    expect(parseMarkdown('One\ntwo\n\nThree')).toEqual([
      { kind: 'paragraph', lines: [[text('One')], [text('two')]] },
      { kind: 'paragraph', lines: [[text('Three')]] },
    ]);
  });

  it('reads bullet and numbered lists, and where a numbered one starts', () => {
    expect(parseMarkdown('Pick:\n- **A:** one\n* B\n\n3. three\n4) four')).toEqual([
      { kind: 'paragraph', lines: [[text('Pick:')]] },
      { kind: 'list', ordered: false, start: 1, items: [[{ kind: 'strong', children: [text('A:')] }, text(' one')], [text('B')]] },
      { kind: 'list', ordered: true, start: 3, items: [[text('three')], [text('four')]] },
    ]);
  });

  it('continues a list item onto the next line, and reads headings', () => {
    expect(parseMarkdown('## Options\n- a\n  more')).toEqual([
      { kind: 'heading', content: [text('Options')] },
      { kind: 'list', ordered: false, start: 1, items: [[text('a'), text(' '), text('more')]] },
    ]);
  });

  it('keeps anything that looks like HTML as text', () => {
    expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'paragraph', lines: [[text('<img src=x onerror=alert(1)>')]] }]);
  });
});
