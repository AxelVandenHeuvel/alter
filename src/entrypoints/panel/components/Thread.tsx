import { useEffect, useRef, useState } from 'react';
import { formatCost } from '../../../agent/pricing';
import type { HealthStatus } from '../../../lib/health-status';
import { modelName } from '../../../lib/settings';
import type { Conversation, RunUsage } from '../conversations';
import { AlertIcon } from './icons';
import { Markdown } from './Markdown';
import { CARD_CLOSED, ProposalCard, type CardView } from './ProposalCard';

export function Thread({
  conversation,
  scriptsAvailable,
  previewHealth,
  onSave,
  onDiscard,
  onAnswer,
  onCompare,
}: {
  conversation: Conversation;
  scriptsAvailable: boolean | null;
  previewHealth: HealthStatus | null;
  onSave: (proposalId: string) => Promise<void>;
  onDiscard: (proposalId: string) => Promise<void>;
  onAnswer: (proposalId: string, approved: boolean) => void;
  onCompare: (showOriginal: boolean) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  // What's open on each card, by proposal id: a card moves into its reply when the run ends.
  const [views, setViews] = useState<Record<string, CardView>>({});
  const { items, running, status, progress, runProposalId } = conversation;
  const liveRecord = running && runProposalId ? conversation.proposals[runProposalId] : undefined;

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [items.length, running, progress, runProposalId, liveRecord?.state]);

  const card = (record: NonNullable<typeof liveRecord>) => (
    <ProposalCard
      record={record}
      hostname={conversation.hostname}
      scriptsAvailable={scriptsAvailable}
      health={record.id === conversation.previewId ? previewHealth : null}
      view={views[record.id] ?? CARD_CLOSED}
      onViewChange={(view) => setViews((current) => ({ ...current, [record.id]: view }))}
      onSave={() => onSave(record.id)}
      onDiscard={() => onDiscard(record.id)}
      onAnswer={(approved) => onAnswer(record.id, approved)}
      onCompare={onCompare}
    />
  );

  return (
    <div className="thread" aria-live="polite">
      {items.map((item) => {
        if (item.kind === 'user') {
          return (
            <div key={item.id} className="bubble user">
              {item.attachments?.map((attachment) => (
                <img key={attachment.id} className="bubble-image" src={attachment.dataUrl} alt="Screenshot you attached" />
              ))}
              <span>{item.text}</span>
            </div>
          );
        }
        if (item.kind === 'error') {
          return (
            <div key={item.id} className="assistant">
              <div className="notice error" role="alert">
                <AlertIcon size={14} />
                <span>{item.text}</span>
              </div>
              {item.usage && <UsageLine usage={item.usage} />}
            </div>
          );
        }
        const record = item.proposalId ? conversation.proposals[item.proposalId] : undefined;
        return (
          <div key={item.id} className="assistant">
            {item.text && <Markdown className="assistant-text" text={item.text} />}
            {record && card(record)}
            {item.usage && <UsageLine usage={item.usage} />}
          </div>
        );
      })}
      {liveRecord && <div className="assistant">{card(liveRecord)}</div>}
      {/* While a card waits for approval, the card itself is the status. */}
      {running && liveRecord?.state !== 'review' && (
        <div className="working" data-testid="working">
          <span className="working-status">{status}</span>
          {progress && <span className="working-progress">{progress}</span>}
          {/* A seam stitching itself, for the tailor Alter is named after. */}
          <span className="stitch" aria-hidden="true" />
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

/** Which model answered, and what the request cost on the user's own key. */
function UsageLine({ usage }: { usage: RunUsage }) {
  if (usage.cost === null) return null;
  return (
    <p className="usage-line" data-testid="usage">
      {modelName(usage.model)} · {formatCost(usage.cost)}
    </p>
  );
}
