import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const init = html.match(/<script id="theme-init">([\s\S]*?)<\/script>/)[1];

test('saved light and dark modes are restored before the page is displayed', () => {
  for (const theme of ['light', 'dark']) {
    const document = { documentElement: { dataset: {} } };
    runInNewContext(init, { document, localStorage: { getItem: () => theme } });
    assert.equal(document.documentElement.dataset.theme, theme);
  }
});

test('without a valid saved choice the system preference remains in control', () => {
  for (const theme of [null, 'system', 'invalid']) {
    const document = { documentElement: { dataset: {} } };
    runInNewContext(init, { document, localStorage: { getItem: () => theme } });
    assert.equal(document.documentElement.dataset.theme, undefined);
  }
});
