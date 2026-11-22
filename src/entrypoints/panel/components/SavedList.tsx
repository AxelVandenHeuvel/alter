import { useEffect, useState } from 'react';
import { describeHealth, type HealthStatus } from '../../../lib/health-status';
import { deletePatch, restorePatch, updatePatch, type Patch } from '../../../lib/patches';
import { healthContext, type PageHealthState } from '../health';
import { CodeBlock } from './CodeBlock';
import { HealthLine } from './HealthLine';
import { ChevronIcon, TrashIcon } from './icons';
import { InlineMarkdown } from './Markdown';
import { Toggle } from './Toggle';

function rowStatus(
  patch: Patch,
  paused: boolean,
  revisingId: string | null,
  health: PageHealthState | null,
  scriptsAvailable: boolean | null,
): HealthStatus | null {
  if (!patch.enabled) return { tone: 'off', text: 'Turned off', details: [] };
  if (paused) return { tone: 'off', text: 'Paused', details: [] };
  if (patch.id === revisingId) return { tone: 'off', text: 'Off while you preview a new version', details: [] };
  return describeHealth(patch, health?.changes[patch.id], healthContext(health, scriptsAvailable));
}

/** How long "Undo" stays offered after deleting a saved change. */
const UNDO_MS = 8000;

function SavedRow({
  patch,
  status,
  onDelete,
}: {
  patch: Patch;
  status: HealthStatus | null;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`saved-row ${patch.enabled ? '' : 'off'}`} data-testid="saved-row">
      <div className="saved-main">
        <button className="saved-title" type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={patch.title}>
          <ChevronIcon size={12} className={`chevron ${open ? 'open' : ''}`} />
          <span className="saved-text">
            <span className="saved-name">{patch.title}</span>
            <HealthLine status={status} />
          </span>
        </button>
        <Toggle
          checked={patch.enabled}
          label={`${patch.enabled ? 'Turn off' : 'Turn on'} ${patch.title}`}
          onChange={(enabled) => void updatePatch(patch.hostname, patch.id, { enabled })}
        />
      </div>
      {open && (
        <div className="saved-detail">
          <p>
            <InlineMarkdown text={patch.summary} />
          </p>
          {status && status.details.length > 0 && (
            <div className="saved-health-details">
              {status.details.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
          <p className="muted">
            Asked for: “{patch.intent}” · {new Date(patch.createdAt).toLocaleDateString()}
          </p>
          {patch.css.trim() && <CodeBlock code={patch.css} label="CSS" />}
          {patch.js.trim() && <CodeBlock code={patch.js} label="script" />}
          <div className="saved-actions">
            <button className="button ghost danger small" type="button" onClick={onDelete}>
              <TrashIcon size={12} /> Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function SavedList({
  patches,
  paused,
  revisingId,
  health,
  scriptsAvailable,
}: {
  patches: Patch[];
  paused: boolean;
  /** A saved change whose new version is being previewed (it's off in the page meanwhile). */
  revisingId: string | null;
  health: PageHealthState | null;
  scriptsAvailable: boolean | null;
}) {
  const [open, setOpen] = useState(true);
  const [deleted, setDeleted] = useState<{ patch: Patch; index: number } | null>(null);

  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => setDeleted(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [deleted]);

  if (patches.length === 0 && !deleted) return null;
  const remove = (patch: Patch) => {
    setDeleted({ patch, index: patches.findIndex((p) => p.id === patch.id) });
    void deletePatch(patch.hostname, patch.id);
  };
  const undo = () => {
    if (!deleted) return;
    void restorePatch(deleted.patch, deleted.index);
    setDeleted(null);
  };
  const active = patches.filter((p) => p.enabled).length;
  return (
    <section className="saved">
      <button className="saved-header" type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronIcon size={12} className={`chevron ${open ? 'open' : ''}`} />
        <span>Saved on this site</span>
        {patches.length > 0 && <span className="count">{paused ? 'paused' : `${active}/${patches.length} on`}</span>}
      </button>
      {open && (
        <ul className="saved-list">
          {patches.map((patch) => (
            <SavedRow
              key={patch.id}
              patch={patch}
              status={rowStatus(patch, paused, revisingId, health, scriptsAvailable)}
              onDelete={() => remove(patch)}
            />
          ))}
        </ul>
      )}
      {deleted && (
        <div className="undo-bar" role="status">
          <span>
            Deleted “<span className="undo-title">{deleted.patch.title}</span>”
          </span>
          <button className="link" type="button" onClick={undo}>
            Undo
          </button>
        </div>
      )}
    </section>
  );
}
