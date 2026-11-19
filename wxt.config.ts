import { defineConfig } from 'wxt';
import { stripDarkReaderPageScript } from './build/strip-darkreader-page-script';

// E2E builds pre-grant host access (the permission prompt can't be clicked in
// automation) and enable the scripted fake model provider. Eval builds pre-grant
// host access too, but talk to the real model (scripts/eval).
const isE2E = process.env.ALTER_E2E === '1';
const isEval = process.env.ALTER_EVAL === '1';
const preGranted = isE2E || isEval;

export default defineConfig({
  srcDir: 'src',
  outDir: isE2E ? '.output-e2e' : isEval ? '.output-eval' : '.output',
  modules: ['@wxt-dev/module-react'],
  // What people download from each GitHub release.
  zip: { artifactTemplate: 'alter-{{version}}.zip' },
  vite: () => ({
    plugins: [stripDarkReaderPageScript()],
    define: { 'import.meta.env.ALTER_E2E': JSON.stringify(isE2E) },
    // Extension bundles load from disk, so chunk size doesn't affect load time much.
    build: { chunkSizeWarningLimit: 1500 },
  }),
  manifest: {
    name: 'Alter',
    description: 'Describe how you want a website to look, and Alter restyles it for you.',
    // userScripts.execute (previews) arrived in Chrome 135, and the "Allow User Scripts" switch in 138.
    minimum_chrome_version: '138',
    permissions: ['activeTab', 'storage', 'unlimitedStorage', 'scripting', 'tabs', 'userScripts', 'contextMenus', 'webNavigation'],
    optional_host_permissions: ['*://*/*'],
    // <all_urls> also stands in for activeTab, which only a real click on the toolbar icon grants.
    ...(preGranted ? { host_permissions: ['<all_urls>'] } : {}),
    action: { default_title: 'Open Alter' },
    commands: {
      'toggle-alter': {
        suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
        description: 'Open or close Alter on this page',
      },
    },
    // The floating panel is this extension page in a frame on the site. The dynamic URL
    // changes every session, so sites can't use it to detect that Alter is installed.
    web_accessible_resources: [
      { resources: ['panel.html', 'chunks/*', 'assets/*', 'icon/*'], matches: ['http://*/*', 'https://*/*'], use_dynamic_url: true },
    ],
  },
});
