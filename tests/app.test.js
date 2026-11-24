import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';
import { createStorage } from '../src/storage.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('optical code gate, persisted status and apartment note interactions', async (t) => {
  let state = M.emptyState();
  let area, entrance, session;
  ({ state, area } = M.addArea(state, { name: 'Testgebiet' }));
  ({ state, entrance } = M.addEntrance(state, area.id, { name: 'Testhaus', floors: 4, apartmentsPerFloor: 2 }));
  ({ state, session } = M.startSession(state, area.id, new Date(2026, 10, 24, 10, 52)));
  let sortArea, sortSession;
  ({ state, area: sortArea } = M.addArea(state, { name: 'Sortiergebiet' }));
  const sortEntrances = {};
  for (const [name, count] of [['Alpha', 1], ['Beta', 2], ['Delta', 1], ['Zulu', 2]]) {
    let item;
    ({ state, entrance: item } = M.addEntrance(state, sortArea.id, { name, address: name === 'Beta' ? 'Weg <1>' : '', floors: 1, apartmentsPerFloor: count }));
    sortEntrances[name] = item;
  }
  ({ state, session: sortSession } = M.startSession(state, sortArea.id, new Date(2026, 10, 24, 9, 0)));
  state = M.recordVisit(state, sortSession.id, { entranceId: sortEntrances.Beta.id, apartmentId: sortEntrances.Beta.apartments[0].id, opened: true, moneyReceived: true, amount: 5 });
  for (const apt of sortEntrances.Beta.apartments) state = M.updateApartmentSkip(state, sortArea.id, sortEntrances.Beta.id, apt.id, true, '');
  state = M.updateApartmentSkip(state, sortArea.id, sortEntrances.Delta.id, sortEntrances.Delta.apartments[0].id, true, '');
  state = M.endSession(state, sortSession.id, new Date(2026, 10, 24, 10, 0));
  let numericArea;
  ({ state, area: numericArea } = M.addArea(state, { name: 'Nummern' }));
  for (const name of ['17b', '19', '15b', '100', '17', '2', '15a', '17c', '15', '17a']) {
    ({ state } = M.addEntrance(state, numericArea.id, { name, floors: 1, apartmentsPerFloor: 1 }));
  }
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
  assert.match(nav.innerHTML, /data-action="open-admin"[^>]*><span>⚙<\/span>Admin Access<\/button>/);
  await click({ action: 'open-admin' });
  assert.equal(nav.hidden, true);
  assert.match(main.innerHTML, /data-form="admin-setup"/);
  await click({ action: 'back-access' });
  await submit({ form: 'access' }, { code: '04122026' });
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
  const exactNote = 'x'.repeat(49) + '😀';
  await submit({ form: 'apartment-note', area: area.id, entrance: entrance.id, apt: aptId }, { note: exactNote });
  navigate(`#/area/${area.id}/entrance/${entrance.id}`);
  assert.match(main.innerHTML, /<p class="hint">Sammelgebiet: Testgebiet<\/p>/);
  assert.match(main.innerHTML, /<h3>EG<\/h3>[\s\S]*<h3>1\. OG<\/h3>[\s\S]*<h3>2\. OG<\/h3>[\s\S]*<h3>3\. OG<\/h3>/);
  assert.ok(main.innerHTML.includes(`<small class="apt-note" title="${exactNote}">${exactNote}</small>`));
  const longNote = '<' + 'x'.repeat(49) + '😀';
  await submit({ form: 'apartment-note', area: area.id, entrance: entrance.id, apt: aptId }, { note: longNote });
  assert.ok(main.innerHTML.includes(`<small class="apt-note" title="&lt;${'x'.repeat(49)}😀">&lt;${'x'.repeat(46)}...</small>`));
  assert.equal((await (await createStorage()).load()).areas[0].entrances[0].apartments[0].note, longNote);
  navigate(`#/session/${session.id}/entrance/${entrance.id}`);
  await submit({ form: 'apartment-note', area: area.id, entrance: entrance.id, apt: aptId }, { note: 'Hof; <Tür>\nAbends' });
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
  assert.match(main.innerHTML, /2 Sammelgänge<\/span>/);
  assert.match(main.innerHTML, /<span class="history-amount">12,50/);
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
  navigate(`#/area/${area.id}/entrance/${entrance.id}/apt/${encodeURIComponent(aptId)}`);
  assert.match(main.innerHTML, /Immer überspringen/);
  await submit({ form: 'apartment-skip', area: area.id, entrance: entrance.id, apt: aptId }, { alwaysSkip: 'on', skipReason: 'Kein Interesse' });
  assert.match(main.innerHTML, /Diese Wohnung wird in Sammelgängen übersprungen/);
  assert.match(main.innerHTML, /Kein Interesse/);
  assert.equal((await (await createStorage()).load()).sessions[0].visits.length, 2);
  await submit({ form: 'apartment-skip', area: area.id, entrance: entrance.id, apt: aptId }, { skipReason: 'Kein Interesse' });
  assert.doesNotMatch(main.innerHTML, /Diese Wohnung wird in Sammelgängen übersprungen/);

  navigate(`#/area/${sortArea.id}`);
  const order = () => [...main.innerHTML.matchAll(/<strong>(Alpha|Beta|Delta|Zulu)<\/strong>/g)].map((match) => match[1]);
  const change = async (action, properties) => {
    await listeners.get('change')({ target: { ...properties, matches: (selector) => selector === `[data-action="${action}"]` } });
    await settle();
  };
  assert.deepEqual(order(), ['Zulu', 'Alpha', 'Beta', 'Delta']);
  assert.match(main.innerHTML, /Weg &lt;1&gt;<br>2 Whg\. · 0 offen<br>1 erledigt · 2 übersprungen/);
  assert.match(main.innerHTML, /1 Whg\. · 0 offen<br>0 erledigt · 1 übersprungen/);
  assert.doesNotMatch(main.innerHTML, /1 Etagen ·/);
  await change('entrance-sort', { value: 'name-asc' });
  assert.deepEqual(order(), ['Alpha', 'Beta', 'Delta', 'Zulu']);
  await change('hide-completed-entrances', { checked: true });
  assert.deepEqual(order(), ['Alpha', 'Zulu']);
  navigate(`#/area/${numericArea.id}`);
  assert.match(main.innerHTML, /Eingangsname \(A–Z\)/);
  const numericOrder = [...main.innerHTML.matchAll(/<strong>(2|15|15a|15b|17|17a|17b|17c|19|100)<\/strong>/g)].map((match) => match[1]);
  assert.deepEqual(numericOrder, ['2', '15', '15a', '15b', '17', '17a', '17b', '17c', '19', '100']);
  navigate(`#/area/${sortArea.id}`);
  await change('entrance-sort', { value: 'open' });
  assert.deepEqual(order(), ['Zulu', 'Alpha']);
  await change('hide-completed-entrances', { checked: false });
  assert.deepEqual(order(), ['Zulu', 'Alpha', 'Beta', 'Delta']);
  assert.equal(saved.get('entranceSort'), 'open');
  assert.equal(saved.get('hideCompletedEntrances'), '0');
  saved.set('entranceSort', 'name-desc');
  await import('../src/app.js?old-sort-preference');
  await settle();
  await submit({ form: 'access' }, { code: '04122026' });
  assert.match(main.innerHTML, /value="name-asc" selected>Eingangsname \(A–Z\)/);
  assert.deepEqual(order(), ['Alpha', 'Beta', 'Delta', 'Zulu']);
});
