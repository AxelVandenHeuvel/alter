/**
 * Sites where Alter refuses to run scripts at all: email, identity providers,
 * password managers, payments, banking, and cloud consoles. CSS changes still
 * work there. Pages with password fields are also protected at runtime.
 */
const SENSITIVE_DOMAINS = [
  // Email
  'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'mail.yahoo.com', 'proton.me',
  'protonmail.com', 'icloud.com', 'fastmail.com',
  // Identity and sign-in
  'accounts.google.com', 'login.microsoftonline.com', 'login.live.com', 'appleid.apple.com', 'okta.com', 'auth0.com',
  'onelogin.com', 'duosecurity.com',
  // Password managers
  '1password.com', 'bitwarden.com', 'lastpass.com', 'dashlane.com', 'keepersecurity.com',
  // Payments, banking, and investing
  'paypal.com', 'stripe.com', 'venmo.com', 'wise.com', 'revolut.com', 'chase.com', 'wellsfargo.com', 'bankofamerica.com',
  'citi.com', 'capitalone.com', 'americanexpress.com', 'discover.com', 'usbank.com', 'schwab.com', 'fidelity.com',
  'vanguard.com', 'robinhood.com', 'coinbase.com', 'kraken.com', 'binance.com', 'hsbc.com', 'barclays.co.uk', 'ing.com',
  // Cloud and admin consoles
  'console.aws.amazon.com', 'signin.aws.amazon.com', 'portal.azure.com', 'console.cloud.google.com', 'admin.google.com',
];

export function isSensitiveHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  // Errs on the side of caution: a false positive only means no scripts on that site.
  if (host.includes('bank')) return true;
  if (/\.gov(\.[a-z]{2})?$/.test(host)) return true;
  return SENSITIVE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
