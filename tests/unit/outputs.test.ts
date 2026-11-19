import { describe, expect, it } from 'vitest';
import { safeFilename } from '../../src/entrypoints/panel/outputs';

describe('safeFilename', () => {
  it.each([
    ['post.txt', 'post.txt'],
    ['../../etc/passwd', '_.._etc_passwd'],
    ['a/b\\c:d*e?.csv', 'a_b_c_d_e_.csv'],
    ['...hidden', 'hidden'],
    ['   ', 'alter-output.txt'],
  ])('%s -> %s', (input, expected) => expect(safeFilename(input)).toBe(expected));
});
