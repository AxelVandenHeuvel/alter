import { describe, expect, it } from 'vitest';
import type { Proposal } from '../../src/agent/agent';
import { actionReport, describePageData, pageDataReport, previewReport } from '../../src/agent/reports';
import type { PageSummary } from '../../src/lib/messages';
import { DARK_MODE_OFF, FOCUS_OFF } from '../../src/lib/patches';
import { emptyReport } from '../../src/lib/userscripts';

const proposal: Proposal = { title: 'Hide ads', summary: '', css: '.ad{display:none}', js: '', darkMode: DARK_MODE_OFF, focus: FOCUS_OFF, revises: null };

const summary = {
  colors: { rootBackground: '', bodyBackground: '', bodyText: '', visibleBackground: 'rgb(255, 255, 255)', visibleBackgroundLuminance: 1 },
  alter: { savedPatchIds: [], previewActive: true, darkModeActive: false, paused: false, focus: { state: 'off' } },
} as unknown as PageSummary;

describe('previewReport', () => {
  it('reports the measured page and flags selectors that match nothing', () => {
    const text = previewReport(proposal, {
      status: 'applied',
      proposalId: 'p1',
      summary,
      css: { selectors: 2, matching: 1, unmatched: ['.ghost'] },
      script: { ...emptyReport(), watching: [{ selector: '.later', matched: 0 }] },
      visual: null,
    }, { canFix: true });
    expect(text).toMatch(/^Preview applied and visible to the user\./);
    expect(text).toContain('"visibleBackground":"rgb(255, 255, 255)"');
    expect(text).toContain('Nothing on the page matches: .ghost | .later.');
  });

  it('asks for a fix when the script reported errors, and nothing more when all is well', () => {
    const errors = previewReport(proposal, { status: 'applied', proposalId: 'p1', summary, css: null, script: { ...emptyReport(), errors: ['boom'] }, visual: null }, { canFix: true });
    expect(errors).toContain('The script reported errors');
    const clean = previewReport(proposal, { status: 'applied', proposalId: 'p1', summary, css: null, script: null, visual: null }, { canFix: true });
    expect(clean.split('\n')).toHaveLength(2);
  });

  it('says which day’s exchange rates a converting script got, or that it got none', () => {
    const converting = { ...proposal, css: '', js: "alter.onElement('.price', (el) => { el.textContent = alter.convert(alter.text(el), 'JPY').text; });" };
    const applied = (rates: { date: string; source: string } | null) =>
      previewReport(converting, { status: 'applied', proposalId: 'p1', summary, css: null, script: { ...emptyReport(), rates }, visual: null }, { canFix: true });
    expect(applied({ date: '2026-11-06', source: 'European Central Bank reference rates' })).toContain(
      'Exchange rates: European Central Bank reference rates for 2026-11-06.',
    );
    expect(applied(null)).toContain("Alter couldn't download exchange rates");
    // Scripts that don't convert prices hear nothing about rates.
    const other = previewReport({ ...proposal, js: 'alter.log(1);' }, { status: 'applied', proposalId: 'p1', summary, css: null, script: emptyReport(), visual: null }, { canFix: true });
    expect(other).not.toContain('xchange rates');
  });
});

describe('actionReport', () => {
  it('says what was delivered to the user', () => {
    const text = actionReport({
      ...emptyReport(),
      outputs: { downloads: [{ filename: 'post.txt', text: 'hello', type: 'text/plain' }], clipboard: 'hi' },
    });
    expect(text).toMatch(/^The action ran\. Alter downloaded post\.txt \(5 characters\) and copied 2 characters to the clipboard for the user\./);
  });

  it('nudges a retry when nothing came out', () => {
    expect(actionReport(emptyReport())).toContain('If the user expected a file or copied text');
  });
});

describe('pageDataReport', () => {
  const summary = { responses: 2, sources: [{ name: 'x.test/api/timeline', responses: 2, chars: 4096 }] };

  it('shows where matches are, with an example and their surroundings', () => {
    const text = pageDataReport('followers', {
      summary,
      total: 40,
      matches: [
        {
          pattern: 'data.entries[].user.legacy.followers_count',
          count: 40,
          sources: ['x.test/api/timeline'],
          example: { path: 'data.entries[0].user.legacy.followers_count', value: '1520' },
          context: '{"core": {"screen_name": "ana"}}',
        },
      ],
    });
    expect(text.split('\n')).toEqual([
      'Data the site loaded: 2 responses: x.test/api/timeline (4 KB). Search it with find_page_data.',
      'Matches for "followers" (40 in all), grouped by path ([] stands for any array position):',
      '- data.entries[].user.legacy.followers_count (40 matches, from x.test/api/timeline)',
      '  e.g. data.entries[0].user.legacy.followers_count = 1520',
      '  in: {"core": {"screen_name": "ana"}}',
      expect.stringContaining('Scripts read this data with alter.data.each'),
    ]);
  });

  it('explains an empty result', () => {
    expect(pageDataReport('followers', { summary, total: 0, matches: [] })).toContain('Nothing matches "followers"');
    expect(pageDataReport('followers', { summary: { responses: 0, sources: [] }, total: 0, matches: [] })).toMatch(
      /^No data captured on this page yet\. .*Ask the user to scroll/,
    );
  });

  it('summarizes in one line for the page summary', () => {
    expect(describePageData(null)).toBe('not available on this page');
    expect(describePageData({ responses: 0, sources: [] })).toBe('nothing captured yet (find_page_data explains why)');
  });
});
