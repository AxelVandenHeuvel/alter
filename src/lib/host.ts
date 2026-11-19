/** Hostname helpers. Patches are scoped to an exact hostname (any port, http or https). */

export function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

/** Match pattern covering every page on the hostname, for permissions and content script registration. */
export function originPattern(hostname: string): string {
  return `*://${hostname}/*`;
}

/** Hosts where extensions cannot run scripts, so Alter can't either. */
const BLOCKED_HOSTS = new Set(['chromewebstore.google.com', 'chrome.google.com']);

export function isModifiable(url: string | undefined): boolean {
  const hostname = hostnameOf(url);
  return hostname !== null && !BLOCKED_HOSTS.has(hostname);
}
