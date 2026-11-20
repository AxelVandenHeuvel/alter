# Alter

Describe how you want a website to look or read, and Alter changes it.
Open Alter on any site, type "create a dark mode", "hide  reels/shorts", or "add a button that exports this table to CSV", and the change appears on the page as a live preview.
Save it and it applies every time you visit that site.

Changes are CSS, a built-in dark theme engine, and, for things CSS can't do, scripts that you review and approve before they run.
Alter can also run one-time actions on the page you're on, like downloading a post as a text file.

## Install

Alter isn't in the Chrome Web Store, so you install it from a release.
You need Chrome 138 or newer and your own Anthropic API key.

1. Download `alter-<version>.zip` from the [latest release](https://github.com/AxelVandenHeuvel/alter/releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
   Keep the folder: Chrome runs Alter from it.
4. On any website, click the Alter icon (pin it from the puzzle-piece menu), choose **Alter** from the right-click menu, or press ⌘⇧Y (Ctrl+Shift+Y).
5. Create a key at https://console.anthropic.com/settings/keys and paste it into Alter.
   It stays in your browser and goes only to Anthropic.
6. Optional, for changes that need a script: on Alter's details page in `chrome://extensions`, turn on **Allow User Scripts**.
   Alter walks you through this the first time a change needs one.

**Cost.** You pay Anthropic for what you use.
Every reply shows what it cost, Settings adds up the month, and you can set a monthly limit there.

**Updating.** Installs from a release don't update themselves.
When a newer version is out, a dot appears on the Settings button, and Settings links to it.
Download it, replace the contents of the folder you installed from with the new files, and click the reload button on Alter's card in `chrome://extensions`.
Your saved changes and key are kept, since Chrome ties them to that folder.

## Using it

- Alter floats over the page without moving it.
  Drag it by its title, and shrink it with –.
- The suggestions in an empty panel fit the page: "Show just the recipe" on recipe pages, "Show just the article" on articles, a light theme for pages that are already dark.
- A preview shows its title and status, with **Discard** and **Save** below.
  Click the title for the details: what the change does and its code.
  A preview that isn't working, or has nothing to change on the page, says so without opening it.
- Press and hold the eye button on a preview to see the page without it, and let go to see the change again (mouse, touch, or hold Space).
- Each saved change has **Change this**, which starts a request about it in the message box, and **Delete**, which offers **Undo** for a few seconds.
- ⌘↵ (Ctrl+↵) saves the change you're previewing, from anywhere in the panel.
- In the message box, the up arrow brings back your last message; **Esc** tucks the panel away into the corner button, conversation intact.
- The toolbar icon shows how many saved changes are on for the site you're on, so it's always clear when a site looks different because of Alter.
- Settings lists every site you've changed, so you can clear one without visiting it, and shows the keyboard shortcut (changeable at `chrome://extensions/shortcuts`).

## How it works

```
Panel (React, extension iframe) Page (content script, isolated world)
 chat + agent loop  ── msg ──▶ snapshot / query / computed styles
 Claude via BYO key            applier: <style> layers + Dark Reader engine
 save / toggle / delete ─────▶ chrome.storage.local ──▶ re-render live
Background worker: registers the page agent at document_start on hosts with saved changes
```

- **Floating panel**: the panel is Alter's own extension page in an iframe the page agent places over the site (`src/content/widget.ts`), so it runs in the extension's origin (the site can't read it or reach the API key) and never resizes the page. Its URL is web-accessible only through Chrome's per-session dynamic URL, so sites can't use it to detect Alter.
- **Agent loop** (`src/agent/`): Claude gets a compressed outline of the page (wrapper divs and generated class names removed, repeated items collapsed, request-related elements expanded) and six tools: `get_snapshot`, `query_selector`, `get_computed_styles`, `find_page_data`, `propose_patch`, and `run_action`.
  Every proposal is previewed on the page, and the tool result reports the measured colors afterwards so the model can check its own work and retry.
- **No account, no servers**: Alter talks straight to Claude.
  The user's own key goes only to Anthropic; every reply shows which model answered and what it cost (worked out from the response's token usage, `src/agent/pricing.ts`), Settings adds up the month, and an optional monthly limit stops requests once it's reached (`src/lib/spend.ts`).
- **Provider interface** (`src/agent/provider.ts`): the loop is provider-neutral.
  A conversation's transcript stays with the provider and model that wrote it; switching starts a new transcript and sends the page again.
  `AnthropicProvider` uses strict tool use, adaptive thinking, prompt caching, and server-side refusal fallbacks.
  Claude Sonnet 5.5 is the default; Haiku 5.5 (cheapest) and Opus 5.5 (most capable) can be picked in Settings.
- **Design rules**: the system prompt (`src/agent/prompt.ts`, "Making changes look good") tells Claude to start from the site's own fonts, colors, and design tokens, and to meet a short list of quality rules: readable contrast, comfortable type, one spacing scale, a coherent palette, working hover and focus states, no layout breakage, and restraint.
  Fixes blend in, added elements match the site, and a new look the user asks for is applied as one coherent design.
  The rules are part of the cached prompt, so they add no noticeable time.
- **Data the site loaded** (`src/content/page-data.ts`): sites download more than they show (a post's author comes with their follower count), so a small script Alter ships runs in the page's main world from document start, on sites Alter has access to, and keeps copies of the JSON responses the site receives through `fetch` and `XMLHttpRequest`, plus JSON embedded in the page.
  It only reads responses; it never makes a request, and it skips sensitive sites.
  Copies reach Alter's isolated worlds as DOM events, where change scripts read them with `alter.data.each` and `alter.data.onLoad`, and the model searches them with the `find_page_data` tool.
  The site can see and fake those events, which only changes what a script displays.
- **Visual check** (`src/content/visual-check.ts`): the page is measured before the first preview and after each one, and only problems the change caused are reported to the model: text below WCAG contrast (measured against what is actually painted behind it), text that was readable and is now covered, hidden, invisible, or on an image it can't measure, large areas that kept the old look when the page flipped between light and dark, sideways scrolling, and newly cut-off text.
  Screen-reader-only text is left out, since nobody sees it.
  Logos and icons are checked in screenshots taken before and after (`src/entrypoints/panel/pixel-check.ts`): one that showed before and now blends into what is behind it (a white logo left on a page that turned light) is reported too.
  The check covers what is on screen and takes tens of milliseconds, plus about half a second for the screenshots.
  The model is asked to fix what it finds up to two times per request, then to tell the user what is still off.
- **Dark mode** uses the Dark Reader engine (bundled `darkreader` package), which analyzes the page's real stylesheets.
  The model turns it on, tunes it, and adds CSS for site-specific fixes.
- **Scripts** run through `chrome.userScripts`, the API Chrome provides for user-approved scripts.
  The model writes the body of a function that receives `alter` (`src/userscript/runtime.js`), a small helper library whose watchers, listeners, timers, and elements are all tracked, so turning a change off removes it cleanly.
  Previews run with `userScripts.execute`; saved scripts are registered with `userScripts.register`, each in its own isolated world.
- **Screenshots and selected areas**: the crosshair button next to the message box lets you drag a box over part of the page (or click an element) to point at it ("this is cut off, fix it"); pasting a screenshot works too.
  For a selected area the AI gets the cropped screenshot plus the exact elements inside it (`src/content/select-area.ts`), so "this" is unambiguous.
  Screenshots use `chrome.tabs.captureVisibleTab`, which Chrome allows after Alter is opened from its icon, menu, or shortcut (activeTab).
- **Labels computed from the page**: "add a cost-per-ounce column" or "show price per GB" adds small inline labels with a script.
  The runtime provides `alter.badge` (labels in their own shadow root, readable on light and dark pages), `alter.parsePrice`, `alter.parseQuantity`, and `alter.unitPrice`, which refuses to compare different kinds of units rather than guess.
  Data from other sites isn't supported: scripts have no network access by design. Cross-site data sources are a possible later addition.
- **Currency conversion**: "convert all the prices to yen" replaces each price with `alter.convert`, keeping the original on hover.
  Scripts can't download exchange rates, so Alter does (`src/lib/rates.ts`): the European Central Bank's daily reference rates, through [Frankfurter](https://frankfurter.dev) because the ECB's own feed doesn't allow requests from extensions.
  They're downloaded only when a script that converts prices runs (and reused for 12 hours), plus at browser start if a saved change converts prices; the request carries nothing about your pages.
  The preview result tells the model which day's rates the script got.
  The model is told which day's rates it has, and says so, since the store still charges in its own currency.
- **Reader and recipe views** are built in, like the dark engine: "strip this article down to text" or "show me just the recipe" turns on a clean reading view over the page.
  Reader view uses Mozilla's Readability (the engine behind Firefox's Reader View); recipe view reads the schema.org recipe data most recipe sites publish, and falls back to reader view without it.
  The view lives in a closed shadow root so the site can't restyle or script it, shows only allowlisted, sanitized content, and has a "Show original" button.
  Narrower focus that should keep the site usable ("only comments from the original poster") is done with CSS and scripts instead.
- **One-time actions** (`run_action`) are for requests about the page in front of you rather than the site from now on: "download this post as a text file", "copy this table as CSV".
  The script runs once after you approve it, in a throwaway world with the same sandbox and checks, and hands its results back; the panel saves the file or copies the text.
  Nothing is saved for the site and the page is left as it was.
- **Live health**: every preview and saved change shows what it is doing on the current page, polled while the panel is open.
  CSS reports which rules match something here; scripts report how many elements each `alter.onElement` selector handled, their errors, and their latest `alter.log` note.
  The model gets the same report after each preview, so it fixes selectors that match nothing, or says plainly that it could not verify a change whose target isn't on screen.
- **Saved changes** are stored per hostname.
  Each proposal either revises a saved change (`revises: id`) or is a new one, so one chat can build up several independent changes.

## Privacy

Alter has no account and no servers of its own.

- **To Anthropic**, only when you ask for a change: an outline of the current page (without form values, and with email addresses and long numbers removed), any screenshot you attach, and what the model looks up while making the change.
- **Kept in your browser**: your API key, saved changes, conversations, and spending totals.
- **Copies of site data**: on sites Alter has access to, it keeps copies of the data the site itself loads, in that tab only, so changes can show things the site has but doesn't display.
  Only what the model looks up in it while making a change is sent.
- **Exchange rates**: when a change converts prices, Alter downloads the European Central Bank's rates through [Frankfurter](https://frankfurter.dev), at most twice a day.
- **Update check**: once a day, Alter asks GitHub for the latest release.

The last two requests carry nothing about your pages.

## What Alter doesn't do

Alter changes how pages look and read in your own browser; it never acts on a site for you.
The model declines requests to click or submit automatically, engage like a bot (like, follow, comment), get around ads, paywalls or other site restrictions, or collect data in bulk.
The script checker enforces the core of this independently: scripts that call `.click()` or `dispatchEvent` are rejected.

## Safety

- Page content is wrapped as untrusted data, and the system prompt tells the model never to follow instructions inside it.
- Every proposed stylesheet goes through `src/lib/css-safety.ts`: no `@import`, no remote `url()`, no `expression()` or `javascript:`.
  That blocks CSS-based data exfiltration (attribute selectors plus remote background images).
- Scripts:
  - Every script world has a CSP of `default-src 'none'`, so Chrome blocks every network request a script makes or causes (fetch, images, stylesheets, injected HTML).
    An E2E test checks this against the real configured world.
  - `src/lib/js-safety.ts` parses each script (acorn) and rejects what CSP can't see: navigation, `window.open`, cookies, storage, `eval`, form submission, password fields, messaging, computed access to globals, and breaking out of the wrapper.
    It also lists in plain words what the script does for the approval card.
  - Nothing runs until you click **Run preview**, and the code is in the card's details.
  - Scripts never run on email, sign-in, password manager, banking, payment, government, or cloud console sites (`src/lib/sensitive.ts`).
  - Scripts never run while a password field is in use: showing, focused, or filled in.
    A sign-in dialog that's in the page but closed, as on most shopping sites, doesn't stop them; the moment it opens, or a hidden field gets focus or input, the runtime stops the script until the page reloads.
  - Stopping a script really stops it.
    The runtime wraps each world's `addEventListener`, `on…` handlers, timers, and observers once, and every callback a script registers does nothing after its run ends, including ones it made without `alter`'s helpers.
    So a script that is turned off, replaced, or stopped by a password field can't keep listening to keys.
- Snapshots drop hidden elements, scripts, and form values, and redact email addresses and long numbers.
- The API key lives in the extension's own IndexedDB, which content scripts can't reach.
- Host access is requested per site, the first time you use Alter there.
- A conversation and its unsaved preview belong to the page they started on: closing and reopening Alter brings them back, and reloading or leaving the page ends them.

## Development

To build it yourself: `npm install`, then `npm run build`, and load `.output/chrome-mv3` with **Load unpacked** as above.
For hot reload, run `npm run dev` instead.

| Command | What it does |
|---|---|
| `npm run dev` | Chrome with the extension loaded and hot reload |
| `npm run check` | Type-check, lint, and unit tests |
| `npm run test:e2e` | Builds an E2E variant and drives the real extension in Chromium with a scripted model |
| `npm run build` / `npm run zip` | Production build / the zip attached to each release |
| `npm run verify:chrome` | Checks in your installed Google Chrome what the test browser can't: the floating panel opens over the page without moving it, works on strict-CSP sites, is ready to type into, can ask for site access, minimizes and closes (`verify:widget`); saved changes survive an extension reload and can still be turned off (`verify:reload`) |
| `npm run eval` | Runs Alter on real sites with the real model and grades the results (below) |
| `npm run eval:login` | Opens the eval's Chrome profile to sign in to sites and answer cookie banners |
| `npm run icons` | Re-render `public/icon/*.png` from `assets/logo-source.jpg` |

E2E builds (`ALTER_E2E=1`) pre-grant host access and swap in `src/agent/fake.ts`, so tests are deterministic and need no API key.
That code is compiled out of production builds.

### Eval on real sites

`npm run eval` (`scripts/eval/`) measures how well Alter does what people ask on real sites, with the real model.
Each case in `scripts/eval/cases.mjs` is a request on a page, like "make this light mode" on a dark Google results page.
The runner opens the page in your installed Chrome with a build that has host access pre-granted (`ALTER_EVAL=1`), types the request into the panel, approves scripts, saves the change, and reloads the page.
A judge model (Claude Opus) then grades screenshots from before, during, and after, along with Alter's reply and the visual check, and says what is wrong.
Results, screenshots, and transcripts go to `eval-results/<time>/report.html`, compared with the previous run.

- It needs `ANTHROPIC_API_KEY` in `.env.local`; use a key from a workspace with a spending limit.
  A full run costs about $2 and takes about 5 minutes.
- The browser profile is kept in `.eval-profile`, so sign-ins and cookie choices made with `npm run eval:login` last.
- `npm run eval -- hn-* google-light` runs only some cases, `--skip x-*` leaves some out, `--model opus` changes Alter's model, and `--repeat 3` runs each case several times, since results vary from run to run.

### Releasing

Bump `version` in `package.json`, commit, then tag and push it: `git tag v0.2.0 && git push origin v0.2.0`.
The release workflow (`.github/workflows/release.yml`) checks that the tag matches the version, runs the checks, and publishes a GitHub release with the zip attached.
Installed copies notice the new release within a day.

## Next iterations

See [ROADMAP.md](ROADMAP.md).

## License

[MIT](LICENSE)
