import type { Plugin } from 'vite';

/**
 * Dark Reader injects an inline <script> into the page's main world to watch
 * the page's own stylesheet edits. Alter never puts <script> tags into pages:
 * strict sites block them anyway (logging CSP errors), and the Chrome Web Store
 * rejects extensions that inject them. Without it, Dark Reader falls back to
 * watching stylesheets itself, so dark mode keeps working.
 *
 * The build fails if the code to remove is no longer found, so a Dark Reader
 * update can't quietly bring the injection back.
 */
const PAGE_SCRIPT_BLOCK =
  /\{\s*const proxyScript = createOrUpdateScript\("darkreader--proxy"\);[\s\S]*?proxyScript\.remove\(\);\s*\}/;

export function stripDarkReaderPageScript(): Plugin {
  return {
    name: 'alter:strip-darkreader-page-script',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]node_modules[\\/]darkreader[\\/]darkreader\.mjs$/.test(id.split('?')[0]!)) return null;
      if (!PAGE_SCRIPT_BLOCK.test(code)) {
        this.error('Dark Reader changed: the page-script injection to strip was not found. Update build/strip-darkreader-page-script.ts.');
      }
      return { code: code.replace(PAGE_SCRIPT_BLOCK, '/* Alter: Dark Reader page-script injection removed at build time. */'), map: null };
    },
  };
}
