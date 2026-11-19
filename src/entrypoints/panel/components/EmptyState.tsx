import { useEffect, useState } from 'react';
import { askPageIfPresent } from '../../../lib/page-client';
import { useToggleShortcut } from '../hooks';
import { DEFAULT_SUGGESTIONS, suggestionsFor } from '../suggestions';
import { ArrowRightIcon, CropIcon } from './icons';

/** How long to wait for the page before showing general suggestions. */
const SUMMARY_TIMEOUT_MS = 800;

/** Suggestions for the page in the tab, or null while the page is being looked at. */
function usePageSuggestions(tabId: number): string[] | null {
  const [state, setState] = useState<{ tabId: number; suggestions: string[] } | null>(null);
  useEffect(() => {
    let done = false;
    const finish = (suggestions: string[]) => {
      if (done) return;
      done = true;
      setState({ tabId, suggestions });
    };
    const timer = setTimeout(() => finish(DEFAULT_SUGGESTIONS), SUMMARY_TIMEOUT_MS);
    void askPageIfPresent(tabId, { type: 'alter:summary' }).then((summary) => finish(suggestionsFor(summary)));
    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, [tabId]);
  return state?.tabId === tabId ? state.suggestions : null;
}

export function EmptyState({ tabId, hostname, onPick }: { tabId: number; hostname: string; onPick: (text: string) => void }) {
  const suggestions = usePageSuggestions(tabId);
  const shortcut = useToggleShortcut();
  return (
    <div className="empty">
      <h2>What should {hostname} look like?</h2>
      <p className="empty-lead">Describe a change to preview it on the page. Save it to keep it every time you visit.</p>
      {/* While the page is read, invisible placeholders hold the space so nothing jumps. */}
      <div className={`suggestions ${suggestions ? 'suggestions--ready' : ''}`} aria-hidden={!suggestions}>
        <p className="section-label">Try</p>
        <ul>
          {(suggestions ?? DEFAULT_SUGGESTIONS).map((s) => (
            <li key={s}>
              <button className="suggestion" type="button" tabIndex={suggestions ? 0 : -1} onClick={() => onPick(s)}>
                <span>{s}</span>
                <ArrowRightIcon size={14} className="suggestion-arrow" />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <ul className="tips">
        <li>
          <CropIcon size={13} /> Point at part of the page to show what you mean
        </li>
        {shortcut && (
          <li>
            <kbd>{shortcut}</kbd> Open or close Alter on any page
          </li>
        )}
      </ul>
    </div>
  );
}
