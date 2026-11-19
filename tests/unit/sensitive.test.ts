import { describe, expect, it } from 'vitest';
import { isSensitiveHost } from '../../src/lib/sensitive';

describe('isSensitiveHost', () => {
  it.each(['mail.google.com', 'accounts.google.com', 'www.paypal.com', 'online.citibank.com', 'my.1password.com', 'www.irs.gov', 'secure.bankofamerica.com'])(
    'blocks scripts on %s',
    (host) => expect(isSensitiveHost(host)).toBe(true),
  );

  it.each(['www.youtube.com', 'news.ycombinator.com', 'github.com', 'www.reddit.com', 'gmail-tips.example.com'])(
    'allows scripts on %s',
    (host) => expect(isSensitiveHost(host)).toBe(false),
  );
});
