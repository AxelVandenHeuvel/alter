import { useState } from 'react';
import { lineCount, plural } from '../../../lib/format';
import type { HealthStatus } from '../../../lib/health-status';
import type { ProposalRecord } from '../conversations';
import { ActionOutputs } from './ActionOutputs';
import { CodeBlock } from './CodeBlock';
import { CompareButton } from './CompareButton';
import { HealthLine } from './HealthLine';
import { AlertIcon, BookIcon, CheckIcon, ChevronIcon, CodeIcon, ShieldIcon, ZapIcon } from './icons';
import { ScriptSetup } from './ScriptSetup';

const STATE_LABEL: Record<ProposalRecord['state'], string> = {
  review: 'Needs your OK',
  applying: 'Applying',
  preview: 'Previewing',
  declined: 'Not run',
  saved: 'Saved',
  discarded: 'Discarded',
  replaced: 'Replaced by a newer version',
  ran: 'Done',
};

/** How each state reads at a glance: still on the page, waiting on the user, finished, or no longer relevant. */
const STATE_TONE: Record<ProposalRecord['state'], 'live' | 'attention' | 'done' | 'off'> = {
  review: 'attention',
  applying: 'live',
  preview: 'live',
  declined: 'off',
  saved: 'done',
  discarded: 'off',
  replaced: 'off',
  ran: 'done',
};

const SAVE_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘↵' : 'Ctrl ↵';

/** What the user has opened on a card: its details, and the CSS or script inside them. */
export interface CardView {
  expanded: boolean;
  code: 'css' | 'js' | null;
}

/** A card starts as its title and decisions. */
export const CARD_CLOSED: CardView = { expanded: false, code: null };

function stateLabel(record: ProposalRecord): string {
  if (record.kind === 'action' && record.state === 'applying') return 'Running';
  return STATE_LABEL[record.state];
}

export function ProposalCard({
  record,
  hostname,
  scriptsAvailable,
  health,
  view,
  onViewChange,
  onSave,
  onDiscard,
  onAnswer,
  onCompare,
}: {
  record: ProposalRecord;
  hostname: string;
  scriptsAvailable: boolean | null;
  /** Live status of this proposal on the page, while it is previewed. */
  health: HealthStatus | null;
  /** Kept by the thread, since a card moves (and React remakes it) when its run ends. */
  view: CardView;
  onViewChange: (view: CardView) => void;
  onSave: () => Promise<void>;
  onDiscard: () => Promise<void>;
  onAnswer: (approved: boolean) => void;
  /** Show the page without the preview while held. */
  onCompare: (showOriginal: boolean) => void;
}) {
  const { expanded, code: open } = view;
  const [busy, setBusy] = useState(false);
  const { proposal, state, scriptCheck, kind } = record;
  const cssLines = lineCount(proposal.css);
  const jsLines = lineCount(proposal.js);
  const hasScript = jsLines > 0;
  const tone = STATE_TONE[state];
  // A preview that isn't simply working (broken, stopped, or with nothing to change here) says so
  // without opening the details.
  const problem = state === 'preview' && health !== null && health.tone !== 'ok';

  const act = (action: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  const toggle = (part: 'css' | 'js') => onViewChange({ ...view, code: open === part ? null : part });

  return (
    <article className={`card proposal state-${state}`} data-testid="proposal-card">
      <div className="proposal-head">
        <h3 className="proposal-title">
          <button className="proposal-toggle" type="button" onClick={() => onViewChange({ ...view, expanded: !expanded })} aria-expanded={expanded}>
            <ChevronIcon size={12} className={`chevron ${expanded ? 'open' : ''}`} />
            <span>{proposal.title}</span>
          </button>
        </h3>
        <span className={`status status--${tone}`}>
          {state === 'review' && <ShieldIcon size={12} />}
          {tone === 'done' && <CheckIcon size={12} />}
          {stateLabel(record)}
        </span>
      </div>
      {problem && <HealthLine status={health} showDetails />}

      {expanded && (
        <div className="proposal-details">
          <p className="proposal-summary">{proposal.summary}</p>
          {/* A working preview needs no status line, only anything worth knowing about it. */}
          {state === 'preview' && !problem && health && health.details.length > 0 && (
            <div className="proposal-notes" data-testid="health-notes">
              {health.details.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
          <div className="proposal-tools">
            {cssLines > 0 && (
              <button className="tool" type="button" onClick={() => toggle('css')} aria-expanded={open === 'css'}>
                <CodeIcon size={13} /> {plural(cssLines, 'line')} of CSS
                <ChevronIcon size={12} className={`chevron ${open === 'css' ? 'open' : ''}`} />
              </button>
            )}
            {hasScript && (
              <button className="tool" type="button" onClick={() => toggle('js')} aria-expanded={open === 'js'}>
                <ZapIcon size={13} /> {plural(jsLines, 'line')} of script
                <ChevronIcon size={12} className={`chevron ${open === 'js' ? 'open' : ''}`} />
              </button>
            )}
            {proposal.focus.mode !== 'off' && (
              <span className="tool-note">
                <BookIcon size={13} /> {proposal.focus.mode === 'recipe' ? 'Recipe view' : 'Reader view'}
              </span>
            )}
          </div>
          {open && <CodeBlock code={open === 'css' ? proposal.css : proposal.js} label={open === 'css' ? 'CSS' : 'script'} />}
        </div>
      )}
      {state === 'ran' && record.report && <ActionOutputs report={record.report} />}

      {state === 'review' && scriptCheck && (
        <div className="script-review">
          <p className="script-review-title">
            {kind === 'action' ? 'This runs a script once, on this page only, that:' : 'This change runs a script that:'}
          </p>
          <ul className="script-facts">
            {scriptCheck.capabilities.map((capability) => (
              <li key={capability}>
                <span className="fact-dot" />
                {capability}
              </li>
            ))}
            {scriptCheck.warnings.map((warning) => (
              <li key={warning} className="warning">
                <AlertIcon size={12} />
                {warning}
              </li>
            ))}
          </ul>
          <p className="script-sandbox">
            <ShieldIcon size={12} />
            It can't access the internet, your passwords, or cookies.
          </p>
        </div>
      )}

      {state === 'review' && scriptsAvailable === false && <ScriptSetup />}
      {state === 'review' && (
        <div className="proposal-actions">
          <button className="button secondary" type="button" onClick={() => onAnswer(false)}>
            Don't run
          </button>
          {scriptsAvailable !== false && (
            <button className="button primary" type="button" disabled={!scriptsAvailable} onClick={() => onAnswer(true)}>
              {kind === 'action' ? 'Run once' : 'Run preview'}
            </button>
          )}
        </div>
      )}

      {state === 'preview' && (
        <div className="proposal-actions">
          {/* Scripts can't be paused mid-run, so only style changes can be compared. */}
          {!hasScript && <CompareButton onCompare={onCompare} />}
          <button className="button secondary" type="button" disabled={busy} onClick={act(onDiscard)}>
            Discard
          </button>
          <button className="button primary" type="button" disabled={busy} onClick={act(onSave)} title={`Save for ${hostname}`} aria-keyshortcuts="Meta+Enter Control+Enter">
            <span className="button-label">Save for {hostname}</span>
            <kbd className="button-kbd" aria-hidden="true">
              {SAVE_SHORTCUT}
            </kbd>
          </button>
        </div>
      )}

      {state === 'discarded' && hasScript && (
        <p className="proposal-note">If anything from the script is left on the page, reload it.</p>
      )}
    </article>
  );
}
