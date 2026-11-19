import { ExternalIcon } from './icons';

export function openExtensionDetails(): void {
  void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
}

/** Walks the user through Chrome's one-time "Allow User Scripts" switch. */
export function ScriptSetup() {
  return (
    <div className="setup" data-testid="script-setup">
      <p className="setup-title">Turn on scripts for Alter</p>
      <p className="setup-text">Chrome asks you to allow this once before any extension can run scripts you approve.</p>
      <ol className="setup-steps">
        <li>
          <span>Open Alter's details page</span>
          <button className="button secondary small" type="button" onClick={openExtensionDetails}>
            Open <ExternalIcon size={12} />
          </button>
        </li>
        <li>
          <span>Turn on “Allow User Scripts”</span>
        </li>
      </ol>
      <p className="setup-text">This card updates as soon as it's on.</p>
    </div>
  );
}
