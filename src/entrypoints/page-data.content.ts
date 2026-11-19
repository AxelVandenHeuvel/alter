import { installCapture } from '../content/page-data';

/**
 * Keeps copies of the JSON the site loads, for change scripts to read (see content/page-data.ts).
 * Runs in the page's main world, so it has no extension APIs. Registered at document_start on
 * sites Alter has access to, and injected when Alter opens on a page.
 */
export default defineContentScript({
  registration: 'runtime',
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installCapture(window);
  },
});
