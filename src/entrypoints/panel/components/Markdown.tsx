import { Fragment } from 'react';
import { parseInline, parseMarkdown, type Inline } from '../markdown';

/** A reply from Claude, with its Markdown shown as formatting rather than symbols. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`markdown ${className ?? ''}`}>
      {parseMarkdown(text).map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <p key={i} className="markdown-heading">
              <Spans inline={block.content} />
            </p>
          );
        }
        if (block.kind === 'list') {
          const items = block.items.map((item, j) => (
            <li key={j}>
              <Spans inline={item} />
            </li>
          ));
          return block.ordered ? (
            <ol key={i} start={block.start}>
              {items}
            </ol>
          ) : (
            <ul key={i}>{items}</ul>
          );
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Spans inline={line} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** One line of Claude's text with only its inline formatting (bold, italic, code), for short summaries. */
export function InlineMarkdown({ text }: { text: string }) {
  return <Spans inline={parseInline(text)} />;
}

function Spans({ inline }: { inline: Inline[] }) {
  return inline.map((span, i) => {
    switch (span.kind) {
      case 'text':
        return <Fragment key={i}>{span.text}</Fragment>;
      case 'code':
        return <code key={i}>{span.text}</code>;
      case 'strong':
        return (
          <strong key={i}>
            <Spans inline={span.children} />
          </strong>
        );
      case 'em':
        return (
          <em key={i}>
            <Spans inline={span.children} />
          </em>
        );
    }
  });
}
