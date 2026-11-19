// The eval's report: one page per run, with every case's screenshots and verdict side by side.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SCORES = [
  ['did_what_was_asked', 'Asked'],
  ['looks_good', 'Looks'],
  ['nothing_broken', 'Intact'],
  ['reply_honest', 'Honest'],
];

function caseCard(result, previous) {
  const v = result.verdict;
  const was = previous?.get(result.file);
  const trend = was === undefined || was === result.pass ? '' : result.pass ? '<span class="trend up">now passes</span>' : '<span class="trend down">now fails</span>';
  const shots = [
    ['before', 'Before'],
    ['preview', 'Preview'],
    ['after', result.screenshots.preview ? 'After reload' : 'After'],
    ['panel', 'Panel'],
  ]
    .filter(([key]) => result.screenshots[key])
    .flatMap(([key, label]) => result.screenshots[key].map((file, i) => [file, i ? `${label}, scrolled` : label]));
  const tools = Object.entries(result.toolCalls)
    .map(([name, count]) => `${name} ×${count}`)
    .join(', ');
  return `
  <article class="case ${result.pass ? 'pass' : 'fail'}" id="${escape(result.file)}">
    <header>
      <span class="badge">${result.pass ? 'Pass' : 'Fail'}</span>
      <h2>${escape(result.file)}</h2>${trend}
      <span class="meta">${escape(result.outcome)} · $${result.cost.toFixed(2)} · ${Math.round(result.durationMs / 1000)}s · ${result.modelCalls} model calls</span>
    </header>
    <p class="request">“${escape(result.request)}” <a href="${escape(result.url)}">${escape(new URL(result.url).hostname)}</a></p>
    ${
      v
        ? `<div class="scores">${SCORES.map(([key, label]) => `<span class="score s${v[key]}">${label} <b>${v[key]}</b></span>`).join('')}</div>
    <p>${escape(v.summary)}</p>
    ${v.issues.length ? `<ul class="issues">${v.issues.map((issue) => `<li>${escape(issue)}</li>`).join('')}</ul>` : ''}`
        : `<p class="error">Not graded${result.judgeError ? `: ${escape(result.judgeError)}` : ''}</p>`
    }
    ${result.error ? `<p class="error">Error: ${escape(result.error)}</p>` : ''}
    ${result.scriptErrors.length ? `<p class="error">Script errors: ${escape(result.scriptErrors.join('; '))}</p>` : ''}
    <dl>
      <dt>Reply</dt><dd>${escape(result.reply) || '<i>none</i>'}</dd>
      <dt>Visual check</dt><dd>${escape(result.visualSummary)}</dd>
      <dt>Tools</dt><dd>${escape(tools) || '<i>none</i>'}</dd>
      ${result.downloads.length ? `<dt>Files</dt><dd>${result.downloads.map((d) => escape(d.name)).join(', ')}</dd>` : ''}
    </dl>
    <div class="shots">${shots
      .map(([file, label]) => `<figure><a href="${escape(file)}"><img loading="lazy" src="${escape(file)}" alt="${label}"></a><figcaption>${label}</figcaption></figure>`)
      .join('')}</div>
    <p class="links"><a href="${escape(result.file)}-transcript.json">Transcript</a></p>
  </article>`;
}

/** Write report.html into the run's folder and return its path. */
export function writeReport(folder, run, previous) {
  // Runs from before repeats existed have no file name; their id is the same thing.
  const before = previous ? new Map(previous.results.map((r) => [r.file ?? r.id, r.pass])) : null;
  const comparison = previous ? `Previous run (${escape(previous.name)}): ${previous.passed}/${previous.total} passed.` : 'First run.';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alter eval</title>
<style>
  :root { --bg: #f6f6f4; --card: #fff; --text: #1d1d1b; --muted: #6b6b66; --line: #e3e3de; --pass: #1f7a3d; --fail: #b3261e; --pass-bg: #e6f4ea; --fail-bg: #fce8e6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #161615; --card: #1f1f1d; --text: #ececea; --muted: #9b9b95; --line: #33332f; --pass: #7fd09a; --fail: #f2a39c; --pass-bg: #1d3325; --fail-bg: #3a1f1c; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, system-ui, sans-serif; }
  main { max-width: 1200px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .summary { color: var(--muted); margin: 0 0 24px; }
  .summary b { color: var(--text); }
  nav { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 24px; }
  nav a { padding: 2px 10px; border-radius: 999px; font-size: 13px; text-decoration: none; }
  nav a.pass { background: var(--pass-bg); color: var(--pass); }
  nav a.fail { background: var(--fail-bg); color: var(--fail); }
  .case { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .case header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
  .case h2 { font-size: 18px; margin: 0; }
  .badge { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 6px; }
  .pass .badge { background: var(--pass-bg); color: var(--pass); }
  .fail .badge { background: var(--fail-bg); color: var(--fail); }
  .meta { color: var(--muted); font-size: 13px; margin-left: auto; }
  .trend { font-size: 12px; font-weight: 600; }
  .trend.up { color: var(--pass); }
  .trend.down { color: var(--fail); }
  .request { font-size: 16px; margin: 8px 0; }
  .request a { color: var(--muted); font-size: 13px; margin-left: 6px; }
  .scores { display: flex; flex-wrap: wrap; gap: 6px; }
  .score { font-size: 13px; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--line); }
  .s1, .s2 { color: var(--fail); }
  .s5 { color: var(--pass); }
  .issues { margin: 8px 0; padding-left: 20px; }
  .error { color: var(--fail); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 12px 0; font-size: 14px; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
  figure { margin: 0; }
  figure img { width: 100%; border: 1px solid var(--line); border-radius: 6px; display: block; }
  figcaption { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .links { font-size: 13px; margin: 8px 0 0; }
  a { color: inherit; }
</style></head>
<body><main>
  <h1>${run.passed}/${run.total} passed</h1>
  <p class="summary"><b>${escape(run.model)}</b> · $${run.cost.toFixed(2)} including the judge · ${Math.round(run.durationMs / 60_000)} min · ${escape(run.startedAt)}<br>${comparison}</p>
  <nav>${run.results.map((r) => `<a class="${r.pass ? 'pass' : 'fail'}" href="#${escape(r.file)}">${escape(r.file)}</a>`).join('')}</nav>
  ${run.results.map((r) => caseCard(r, before)).join('')}
</main></body></html>`;
  const file = path.join(folder, 'report.html');
  writeFileSync(file, html);
  return file;
}
