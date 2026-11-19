import { describe, expect, it } from 'vitest';
import { describeSize, lineCount, plural } from '../../src/lib/format';

describe('format', () => {
  it('pluralizes counts', () => {
    expect(plural(1, 'rule')).toBe('1 rule');
    expect(plural(0, 'rule')).toBe('0 rules');
    expect(plural(3, 'saved change')).toBe('3 saved changes');
  });

  it('describes sizes in characters, then KB', () => {
    expect(describeSize('hello')).toBe('5 characters');
    expect(describeSize('x')).toBe('1 character');
    expect(describeSize('x'.repeat(2048))).toBe('2.0 KB');
    expect(describeSize('x'.repeat(20 * 1024))).toBe('20 KB');
  });

  it('counts lines, ignoring blank lines around the code', () => {
    expect(lineCount('  \n')).toBe(0);
    expect(lineCount('\na {}\nb {}\n\n')).toBe(2);
  });
});
