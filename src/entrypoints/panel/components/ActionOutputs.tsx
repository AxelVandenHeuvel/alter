import { useState } from 'react';
import { describeSize } from '../../../lib/format';
import type { ScriptReport } from '../../../lib/userscripts';
import { copyText, safeFilename, saveFile } from '../outputs';
import { HealthLine } from './HealthLine';
import { CheckIcon, CopyIcon, DownloadIcon } from './icons';

/** What a one-time action produced, with ways to get it again. */
export function ActionOutputs({ report }: { report: ScriptReport }) {
  const [copied, setCopied] = useState(false);
  const downloads = report.outputs?.downloads ?? [];
  const clipboard = report.outputs?.clipboard ?? null;

  const copyAgain = async () => {
    if (clipboard === null) return;
    await copyText(clipboard);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="action-outputs" data-testid="action-outputs">
      {downloads.map((file, i) => (
        <div key={`${file.filename}-${i}`} className="output-row">
          <DownloadIcon size={14} />
          <span className="output-name">{safeFilename(file.filename)}</span>
          <span className="output-size">{describeSize(file.text)}</span>
          <button className="button secondary small" type="button" onClick={() => saveFile(file)}>
            Download again
          </button>
        </div>
      ))}
      {clipboard !== null && (
        <div className="output-row">
          <CopyIcon size={14} />
          <span className="output-name">Copied text</span>
          <span className="output-size">{describeSize(clipboard)}</span>
          <button className="button secondary small" type="button" onClick={() => void copyAgain()}>
            {copied ? (
              <>
                <CheckIcon size={12} /> Copied
              </>
            ) : (
              'Copy again'
            )}
          </button>
        </div>
      )}
      {report.errors.length > 0 && (
        <HealthLine status={{ tone: 'error', text: report.errors[report.errors.length - 1]!, details: [] }} />
      )}
      {downloads.length === 0 && clipboard === null && report.errors.length === 0 && (
        <p className="proposal-note">It ran but didn't produce a file or anything to copy.</p>
      )}
    </div>
  );
}
