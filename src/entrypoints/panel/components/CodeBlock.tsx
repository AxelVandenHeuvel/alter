import { useEffect, useState } from 'react';
import { copyText } from '../outputs';
import { CheckIcon, CopyIcon } from './icons';

/** A change's CSS or script, with a button to copy it. */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="code-block">
      <pre className="code">{code.trim()}</pre>
      <button
        className="code-copy"
        type="button"
        onClick={() => void copyText(code.trim()).then(() => setCopied(true))}
        aria-label={copied ? 'Copied' : `Copy ${label}`}
        title={copied ? 'Copied' : `Copy ${label}`}
      >
        {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      </button>
    </div>
  );
}
