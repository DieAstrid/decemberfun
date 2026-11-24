import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';
import { createStorage } from '../src/storage.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('optical code gate, persisted status and apartment note interactions', async (t) => {
  let state = M.emptyState();
  let area, entrance, session;
  ({ state, area } = M.addArea(state, { name: 'Testgebiet' }));
  ({ state, entrance } = M.addEntrance(state, area.id, { name: 'Testhaus', floors: 1, apartmentsPerFloor: 2 }));
  ({ state, session } = M.startSession(state, area.id, new Date(2026, 10, 24, 10, 52)));
  const aptId = entrance.apartments[0].id;
  const saved = new Map([['sammelgebiet-state', JSON.stringify(state)]]);
  const listeners = new Map();
  const windowListeners = new Map();
  const main = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const nav = { innerHTML: '', hidden: false };
  const toast = { textContent: '', className: '' };
  const elements = { main, nav, toast };
  const globals = {
    document: {
      documentElement: { dataset: {} },
      getElementById: (id) => elements[id],
      addEventListener: (event, fn) => listeners.set(event, fn),
    },
    window: { addEventListener: (event, fn) => windowListeners.set(event, fn), scrollTo() {} },
    location: { hash: `#/session/${session.id}/entrance/${entrance.id}`, protocol: 'http:' },
    localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) },
    navigator: {},
    setInterval() {},
    setTimeout() {},
    clearTimeout() {},
    FormData: class {
      constructor(form) { this.values = form.values; }
      [Symbol.iterator]() { return Object.entries(this.values)[Symbol.iterator](); }
    },
  };
  const original = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const submit = async (dataset, values) => {
    const form = { dataset, values };
    listeners.get('submit')({ target: { closest: () => form }, preventDefault() {} });
    await settle();
  };
  const click = async (dataset) => {
    const el = { dataset, matches: () => false };
    listeners.get('click')({ target: { closest: () => el } });
    await settle();
  };
  const navigate = (hash) => {
    location.hash = hash;
    windowListeners.get('hashchange')();
  };
  await import('../src/app.js');
  await settle();
  assert.match(main.innerHTML, /<h1>Zugangscode eingeben<\/h1>/);
  assert.doesNotMatch(main.innerHTML, /<p class="hint">|<label>/);
  assert.match(main.innerHTML, /aria-label="Zugangscode"/);
  assert.match(main.innerHTML, /type="text" inputmode="numeric"/);
  assert.equal(nav.hidden, true);
  assert.match(main.innerHTML, /aria-label="Darstellung"/);
  const changeTheme = async (value) => {
    await click({ action: 'theme', value });
  };
  const beforeThemeChange = main.innerHTML;
  await changeTheme('dark');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(saved.get('sammelgebiet-theme'), 'dark');
  assert.equal(main.innerHTML, beforeThemeChange, 'switching does not replace forms or discard entered values');
  await changeTheme('light');
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(saved.get('sammelgebiet-theme'), 'light');
  await changeTheme('system');
  assert.equal(document.documentElement.dataset.theme, undefined);
  assert.equal(saved.has('sammelgebiet-theme'), false);
  const setItem = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('Speicher voll'); };
  await changeTheme('dark');
  localStorage.setItem = setItem;
  assert.equal(document.documentElement.dataset.theme, undefined);
  assert.match(toast.textContent, /Darstellung konnte nicht gespeichert werden: Speicher voll/);
  await submit({ form: 'access' }, { code: '4122026' });
  assert.equal(nav.hidden, true, 'leading zero is required');
  assert.match(toast.textContent, /stimmt nicht/);
  await submit({ form: 'access' }, { code: '04122026' });
  assert.equal(nav.hidden, false);
  assert.match(main.innerHTML, /Testhaus/);
  await click({ action: 'opened', apt: aptId, value: '0' });
  assert.match(main.innerHTML, /class="btn small not-opened" aria-pressed="true"/);
  navigate(`#/session/${session.id}`);
  navigate(`#/session/${session.id}/entrance/${entrance.id}`);
  assert.match(main.innerHTML, /class="btn small not-opened" aria-pressed="true"/);
  const persisted = await (await createStorage()).load();
  assert.equal(M.apartmentStatus(persisted, area.id, aptId, session.id).current.opened, false);
  await submit({ form: 'apartment-note', area: area.id, entrance: entrance.id, apt: aptId }, { note: 'Hof; <Tür>\nAbends' });
  assert.match(main.innerHTML, /Hof; &lt;Tür&gt;\nAbends/);
  assert.equal((await (await createStorage()).load()).areas[0].entrances[0].apartments[0].note, 'Hof; <Tür>\nAbends');
  await click({ action: 'clear-visit', apt: aptId });
  assert.doesNotMatch(main.innerHTML, /class="btn small not-opened"/);
  await click({ action: 'opened', apt: aptId, value: '1' });
  await click({ action: 'money', apt: aptId, value: '0' });
  await click({ action: 'reason', apt: aptId, value: M.REASONS.NO_CASH });
  assert.doesNotMatch(main.innerHTML, /class="btn small not-opened"/);
  assert.doesNotMatch(main.innerHTML, new RegExp(`id="apt-${aptId}"`), 'opened apartment is hidden in the current session');
  navigate(`#/session/${session.id}`);
  navigate(`#/session/${session.id}/entrance/${entrance.id}`);
  assert.doesNotMatch(main.innerHTML, new RegExp(`id="apt-${aptId}"`), 'still hidden after re-entering the entrance');
  listeners.get('change')({ target: { matches: (selector) => selector === '[data-action="toggle-done"]', checked: true } });
  assert.match(main.innerHTML, new RegExp(`id="apt-${aptId}"`));
  assert.match(main.innerHTML, /Kein Bargeld/);
  await click({ action: 'opened', apt: aptId, value: '0' });
  assert.match(main.innerHTML, /class="btn small not-opened" aria-pressed="true"/);
  listeners.get('change')({ target: { matches: (selector) => selector === '[data-action="toggle-done"]', checked: false } });
  assert.match(main.innerHTML, new RegExp(`id="apt-${aptId}"`), 'revisiting without an answer leaves it open again');
  await import('../src/app.js?reload');
  await settle();
  assert.equal(nav.hidden, true, 'loading the page again asks for the code again');
  await submit({ form: 'access' }, { code: '04122026' });
  assert.match(main.innerHTML, /class="btn small not-opened" aria-pressed="true"/);
  assert.match(main.innerHTML, /Hof; &lt;Tür&gt;\nAbends/);
  await click({ action: 'opened', apt: entrance.apartments[1].id, value: '1' });
  await click({ action: 'money', apt: entrance.apartments[1].id, value: '1' });
  await submit({ form: 'amount', apt: entrance.apartments[1].id }, { amount: '12,50' });
  navigate('#/history');
  assert.match(main.innerHTML, /1 Sammelgang<\/span>/);
  assert.match(main.innerHTML, /Testgebiet · 24\.11\.2026, 10:52–…/);
  assert.match(main.innerHTML, /<span class="badge running-badge">läuft<\/span>/);
  await submit({ form: 'end-session', id: session.id }, { endedAt: new Date(new Date(session.startedAt).getTime() + 18 * 60000).toISOString() });
  assert.match(main.innerHTML, /Testgebiet · 24\.11\.2026, 10:52–11:10/);
  assert.match(main.innerHTML, /18 Minuten · 2 besucht · 1 Spende/);
  assert.match(main.innerHTML, /12,50/);
  assert.match(main.innerHTML, /<span class="badge success">abgeschlossen<\/span>/);
  assert.doesNotMatch(main.innerHTML, /<span class="badge running-badge">läuft<\/span>/);
  await click({ action: 'reopen-session', id: session.id });
  await submit({ form: 'end-session', id: session.id }, { endedAt: new Date(new Date(session.startedAt).getTime() + 60000).toISOString() });
  assert.match(main.innerHTML, /1 Minute · 2 besucht · 1 Spende/);
});
