/**
 * Alter's brand colors and type for the UI it draws on web pages (the minimized
 * button, the area picker, the reading views) and the toolbar badge. These live in
 * shadow roots and can't use the panel's CSS variables, so they share these values;
 * keep them in step with the --accent tokens in the panel's styles.css.
 * Alter is black, white, and gray, like the logo.
 */
export const BRAND = {
  accent: '#18181b',
  /** The accent as "r, g, b", for translucent fills. */
  accentRgb: '24, 24, 27',
  /** The accent on dark backgrounds. */
  accentOnDark: '#ededef',
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
} as const;
