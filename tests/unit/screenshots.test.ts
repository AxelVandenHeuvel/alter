import { describe, expect, it } from 'vitest';
import { formatScreenshots } from '../../src/agent/prompt';

const image = { mediaType: 'image/png' as const, data: 'AAAA' };

describe('formatScreenshots', () => {
  it('describes a selected area with the elements inside it, as page data', () => {
    const text = formatScreenshots([
      {
        image,
        selection: {
          rect: { x: 100, y: 200, width: 300, height: 40 },
          devicePixelRatio: 2,
          container: { selectorHint: 'form#signup', tag: 'form', text: '', attributes: { id: 'signup' }, rect: { x: 90, y: 150, width: 400, height: 200 } },
          elements: [
            { selectorHint: 'form#signup > input', tag: 'input', text: '', attributes: { name: 'email', size: '8' }, rect: { x: 100, y: 205, width: 64, height: 28 } },
          ],
        },
      },
      { image, selection: null },
    ]);
    expect(text).toBe(
      [
        '<page_data>',
        'Screenshot 1: an area the user selected on the page (300×40 at 100,200 in the viewport).',
        'Smallest element containing it: form#signup [id="signup"] (400×200 at 90,150)',
        'Elements inside it:',
        '- form#signup > input [name="email" size="8"] (64×28 at 100,205)',
        '',
        'Screenshot 2: pasted by the user; find what it shows on the page with your tools.',
        '</page_data>',
      ].join('\n'),
    );
  });
});
