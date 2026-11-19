import { describe, expect, it } from 'vitest';
import { focusTermsFor, SYSTEM_PROMPT } from '../../src/agent/prompt';

describe('focusTermsFor', () => {
  it('keeps the meaningful words of a request', () => {
    expect(focusTermsFor('remove shorts')).toEqual(['shorts', 'short']);
    expect(focusTermsFor('Hide the trending sidebar please')).toEqual(['trending', 'sidebar']);
    expect(focusTermsFor('create a dark mode')).toEqual(['dark']);
  });
});

describe('SYSTEM_PROMPT', () => {
  it('asks for changes that start from the site\'s design and meet basic quality rules', () => {
    expect(SYSTEM_PROMPT).toContain('# Making changes look good');
    expect(SYSTEM_PROMPT).toContain('Start from the site\'s own design.');
    expect(SYSTEM_PROMPT).toContain('at least 4.5:1');
    expect(SYSTEM_PROMPT).toContain('prefers-reduced-motion');
    expect(SYSTEM_PROMPT).toContain('For light mode on a dark site');
    expect(SYSTEM_PROMPT).toContain('When it lists problems, fix them');
  });
});
