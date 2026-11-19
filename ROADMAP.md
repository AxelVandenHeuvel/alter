# Roadmap

What's next for Alter, in the order we plan to do it.
Each item says why it matters, what we'd build, and how we'd know it worked.

## Where things stand

The real-site eval (`npm run eval`, see the README) passes 12 of 17 cases.
The baseline report is `eval-results/2026-10-12T23-58-17/report.html`.
The two X cases are tested by hand, not by the eval.

These cases still fail:

| Case | What goes wrong | Fixed by |
|---|---|---|
| wikipedia-reading | Alter says the column got narrower, but it didn't. | 1 |
| hn-modern | Vote arrows and titles end up misaligned, and the design quality varies between runs. | 1 |
| amazon-unit-price | Alter sometimes adds a unit price next to the one Amazon already shows. | 1 |
| mdn-light | The "Try it" demo is in a frame and stays dark. | 2 (1 makes Alter say so) |
| guardian-reader | An ad in a frame stays on the page. | 2 (1 makes Alter say so) |

Results vary between runs, so compare with `npm run eval -- --repeat 3` rather than a single run.

## 1. Let Alter see its own result

**Why.**
Today Alter works from text only.
It writes a change, applies the preview, and gets back the visual check report as text: contrast problems, text that disappeared, graphics that disappeared.
It never sees the page.
So it can't notice problems the report doesn't measure, and it describes what it meant to do rather than what happened.
Four of the five failing cases come from this.

**What we'd build.**

1. Send the screenshot with the report.
   The panel already takes a screenshot after each preview, for the logo check (`src/entrypoints/panel/pixel-check.ts`).
   That screenshot goes to the model with the text report, scaled down to about 1280px wide.
   On the first preview, the "before" screenshot goes too, so the model can compare.
2. Check before replying.
   The instructions ask Alter to look at the screenshot and confirm each thing it's about to say.
   If something it changed isn't visible, it fixes it.
   If it can't confirm something, for example because it's below what's on screen, it says so plainly.
   If the page looks wrong in a way the report missed (misalignment, a duplicate, a black box), it fixes it or mentions it.
3. A way to look further down.
   A small tool lets Alter scroll the page, take a screenshot, and scroll back.
   It uses the same capture code, and Chrome's limit of two screenshots per second still applies.

**Details that matter.**

- When capture fails (the tab isn't showing, or the permission is missing), Alter works as it does today, and the instructions tell it that it hasn't seen the page.
- Alter's own widget covers part of the page, so we hide it during the capture.
- A screenshot can show more than the page text Alter already sends, so the privacy policy has to say this, and a setting turns it off.
- Each screenshot is about 1,500 tokens, roughly half a cent on Sonnet.
  Prompt caching keeps earlier screenshots cheap.
  A typical request has 2-3 screenshots, so about 1-2 cents more, and about a second more per round.

**How we'd know it worked.**

1. Run the 5 failing cases 3 times each on the current code, as a baseline.
2. Build the change with unit and E2E tests.
   The fake agent checks that a screenshot arrives, and a test covers a claim being fixed after looking.
3. Run the same 15 runs again, then one full run to catch anything that now fails.
4. The bar: wikipedia-reading and amazon-unit-price pass most runs, hn-modern improves, and mdn-light and guardian-reader stop claiming more than they did.

Expected eval spend is $4-6.

**What it won't fix.**
It can't change frames (that's item 2).
It can't see parts of the page it hasn't scrolled to.
Design quality on "make it modern" requests improves but still varies, because seeing a problem doesn't guarantee a good fix.

## 2. Reach into embedded frames

**Why.**
MDN's demos, embedded players, comment widgets and ads live in frames that Alter's changes don't touch.
A light or dark theme that leaves a black box on the page looks broken.

**What we'd build.**
Inject changes into frames too (`allFrames` for CSS and scripts, where Chrome allows it).
Where a frame can't be reached, the visual check reports it so Alter can tell the user.

**How we'd know it worked.**
mdn-light and guardian-reader pass.

## 3. Grow the eval from real use

**Why.**
The 17 cases are guesses at what people ask.

**What we'd do.**
Whenever Alter does something badly, note the site and the request, and add it to `scripts/eval/cases.mjs`.
After a few weeks the score reflects real use, and every fix is checked against all of it.

## 4. Chrome Web Store

Alter ships as open source: people install a release zip with Developer mode, and Settings says when a newer release is out.
The store would reach people who won't do that, and update them automatically.
It's worth it once people outside developer circles ask for it.

- A privacy policy at a public URL.
  The README's Privacy section is the starting point: page outlines and screenshots go to Anthropic, copies of site data stay in the tab, and the exchange rate and update checks carry nothing about the user's pages.
- The listing: descriptions, 1280x800 screenshots, a 440x280 promo tile, and a reason for each permission.
  The review for user scripts is slow.
- A 128px icon drawn at 96px with transparent padding, readable on the store's white page.
- The update check (`src/lib/updates.ts`) turned off for store installs, since the store updates them.

## Later

- **Self-repairing saved changes.**
  When a site changes and a saved change stops matching (the health report already sees selectors matching nothing), re-run the original request and offer the new version.
  The eval can replay this.
  It matters most once people have saved changes that sites break, so it comes after shipping.
- **Firefox build.**
  Firefox has `userScripts` as an optional permission and a sidebar instead of a side panel.
- **Models on the user's computer.**
  An Ollama version was built and removed: it was too slow to be worth it while Claude is this cheap.
  Worth another look if local models get much faster.
- **MCP.**
  Discussed and put off.
  Revisit once the core is shipped.

## Open questions

- **Your own key, or a hosted option?**
  Today everyone brings their own Anthropic key.
  A hosted free tier, or a shared library of changes for popular sites, would make Alter usable without a key.
  It also means running a server, paying for usage, and handling accounts.
  Decide before the store listing, since it changes the onboarding and the privacy policy.
