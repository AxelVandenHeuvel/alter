import type { HealthStatus } from '../../../lib/health-status';

/**
 * One-line live status for a change, with optional detail lines. Built from
 * spans so it can sit inside buttons.
 */
export function HealthLine({ status, showDetails = false }: { status: HealthStatus | null; showDetails?: boolean }) {
  if (!status) return null;
  return (
    <span className={`health health--${status.tone}`} data-testid="health">
      <span className="health-text">
        <span className="health-dot" aria-hidden="true" />
        <span>{status.text}</span>
      </span>
      {showDetails &&
        status.details.map((line) => (
          <span key={line} className="health-detail">
            {line}
          </span>
        ))}
    </span>
  );
}
