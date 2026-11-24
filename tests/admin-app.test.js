import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as M from '../src/model.js';
import * as D from '../src/data.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('admin setup, assignments and user entrance management remain local and hide collection sessions', async (t) => {
  let state = M.emptyState();
  let area;
  let entrance;
  let session;
  ({ state, area } = M.addArea(state, { name: 'Teamgebiet' }));
  ({ state, entrance } = M.addEntrance(state, area.id, { name: 'Haus 1', floors: 1, apartmentsPerFloor: 2 }));
  ({ state, session } = M.startSession(state, area.id, new Date('2026-11-24T10:00:00Z')));
  state = M.recordVisit(state, session.id, {
    entranceId: entrance.id,
    apartmentId: entrance.apartments[0].id,
    opened: true,
    moneyReceived: true,
    amount: 12.5,
  });
  state = M.updateApartmentNote(state, area.id, entrance.id, entrance.apartments[0].id, 'Notiz bleibt lokal');

  const saved = new Map([['sammelgebiet-state', JSON.stringify(state)]]);
  const listeners = new Map();
  const windowListeners = new Map();
  const main = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const nav = { innerHTML: '', hidden: false };
  const toast = { textContent: '', className: '' };
  const elements = { main, nav, toast };
  let confirmed = true;
  const globals = {
    document: {
      documentElement: { dataset: {} },
      getElementById: (id) => elements[id],
      addEventListener: (event, fn) => listeners.set(event, fn),
    },
    window: { addEventListener: (event, fn) => windowListeners.set(event, fn), scrollTo() {} },
    location: { hash: '#/', protocol: 'http:' },
    localStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    },
    navigator: {},
    setInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    confirm: () => confirmed,
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

  const click = async (dataset) => {
    const element = { dataset, matches: () => false };
    await listeners.get('click')({ target: { closest: () => element } });
    await settle();
  };
  const submit = async (dataset, values) => {
    const form = { dataset, values };
    await listeners.get('submit')({ target: { closest: () => form }, preventDefault() {} });
    await settle();
  };
  const navigate = (hash) => {
    location.hash = hash;
    windowListeners.get('hashchange')();
  };

  await import('../src/app.js?admin-test');
  await settle();
  assert.match(main.innerHTML, /class="card form access-form"/);
  assert.match(main.innerHTML, /Admin Access/);
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.access-form\s*\{\s*display:\s*grid;\s*gap:\s*10px;\s*\}/);

  await click({ action: 'open-admin' });
  assert.match(main.innerHTML, /data-form="admin-setup"/);
  await click({ action: 'back-access' });
  assert.match(main.innerHTML, /data-form="access"/);
  await click({ action: 'open-admin' });
  await submit({ form: 'admin-setup' }, { code: 'falsch', password: 'anfangspasswort', confirmPassword: 'anfangspasswort' });
  assert.match(toast.textContent, /Zugangscode.*stimmt nicht/);
  assert.equal(saved.has('sammelgebiet-admin'), false);
  await submit({ form: 'admin-setup' }, { code: '04122026', password: 'anfangspasswort', confirmPassword: 'anfangspasswort' });
  assert.match(main.innerHTML, /Wiederherstellungscode/);
  const recoveryCode = main.innerHTML.match(/aria-label="Wiederherstellungscode">([^<]+)</)?.[1];
  assert.match(recoveryCode, /^[0-9A-F]{4}(?:-[0-9A-F]{4}){3}$/);
  const adminConfig = JSON.parse(saved.get('sammelgebiet-admin'));
  assert.equal(JSON.stringify(adminConfig).includes(recoveryCode), false);
  assert.equal(JSON.stringify(adminConfig).includes('anfangspasswort'), false);
  await click({ action: 'finish-admin-setup' });
  assert.match(main.innerHTML, /Admin-Verwaltung/);
  assert.doesNotMatch(main.innerHTML, /Sammelgang starten|Historie|Betrag speichern/);
  assert.doesNotMatch(nav.innerHTML, /Gang|Historie|Daten/);
  navigate(`#/area/${area.id}`);
  assert.match(main.innerHTML, /<h2>Statistik<\/h2>/);
  assert.match(main.innerHTML, /Geöffnet \/ nicht geöffnet<\/span><strong>1 \/ 0<\/strong>/);
  assert.match(main.innerHTML, /Gesamtsammelsumme<\/span><strong>12,50/);
  assert.match(main.innerHTML, /Durchschnitt je besuchter Wohnung<\/span><strong>12,50/);
  assert.doesNotMatch(main.innerHTML, /href="#\/session\/|Notiz bleibt lokal|Sammelgang starten/);
  navigate(`#/area/${area.id}/entrance/${entrance.id}`);
  assert.match(main.innerHTML, /Whg. 1/);
  navigate(`#/area/${area.id}/entrance/${entrance.id}/apt/${encodeURIComponent(entrance.apartments[0].id)}`);
  assert.match(main.innerHTML, /Immer überspringen/);
  assert.doesNotMatch(main.innerHTML, /Historie|Notiz bleibt lokal|Sammelgang/);
  await submit({ form: 'apartment-skip', area: area.id, entrance: entrance.id, apt: entrance.apartments[0].id }, { alwaysSkip: 'on', skipReason: 'Kein Interesse' });
  assert.match(main.innerHTML, /checked/);
  navigate(`#/area/${area.id}/entrance/${entrance.id}`);
  assert.match(main.innerHTML, /Wird übersprungen/);

  await import('../src/app.js?admin-reload');
  await settle();
  await click({ action: 'open-admin' });
  assert.match(main.innerHTML, /data-form="admin-login"/);
  assert.doesNotMatch(main.innerHTML, /data-form="admin-setup"/);
  await submit({ form: 'admin-login' }, { password: 'anfangspasswort' });
  assert.match(main.innerHTML, /Admin-Verwaltung/);

  navigate(`#/area/${area.id}/edit`);
  assert.match(main.innerHTML, /Zugewiesene E-Mail-Adressen/);
  await submit({ form: 'area', id: area.id }, {
    name: 'Teamgebiet',
    targetAmount: '',
    previousYearAmount: '',
    note: '',
    assignedEmails: 'Team@example.org; zweites@example.org',
  });
  assert.match(main.innerHTML, /team@example.org, zweites@example.org/);
  await click({ action: 'logout' });
  await click({ action: 'open-admin' });
  assert.match(main.innerHTML, /data-form="admin-recovery"/);
  await submit({ form: 'admin-recovery' }, { recoveryCode, password: 'neuesadminpasswort' });
  const replacementCode = main.innerHTML.match(/aria-label="Wiederherstellungscode">([^<]+)</)?.[1];
  assert.match(replacementCode, /^[0-9A-F]{4}(?:-[0-9A-F]{4}){3}$/);
  assert.notEqual(replacementCode, recoveryCode);
  await click({ action: 'finish-admin-setup' });
  assert.match(main.innerHTML, /Admin-Verwaltung/);

  navigate('#/area/new');
  await submit({ form: 'area', id: '' }, {
    name: 'Anderes Gebiet',
    targetAmount: '',
    previousYearAmount: '',
    note: '',
    assignedEmails: '',
  });
  const unassignedArea = D.importJson(saved.get('sammelgebiet-state')).areas.find((item) => item.name === 'Anderes Gebiet');
  navigate(`#/area/${unassignedArea.id}`);
  assert.match(main.innerHTML, /Geöffnet \/ nicht geöffnet<\/span><strong>0 \/ 0<\/strong>/);
  assert.match(main.innerHTML, /Durchschnitt je besuchter Wohnung<\/span><strong>–<\/strong>/);

  await click({ action: 'logout' });
  await click({ action: 'open-user' });
  await submit({ form: 'user-login' }, { email: 'TEAM@EXAMPLE.ORG' });
  assert.match(main.innerHTML, /Teamgebiet/);
  assert.match(nav.innerHTML, /data-action="open-admin"[^>]*><span>⚙<\/span>Admin Access<\/button>/);
  assert.doesNotMatch(main.innerHTML, /Anderes Gebiet|Sammelgang|Betrag|Notiz bleibt lokal/);
  navigate(`#/area/${unassignedArea.id}`);
  assert.match(main.innerHTML, /Nicht gefunden/);
  navigate(`#/area/${area.id}`);
  assert.match(main.innerHTML, /Eingänge/);
  assert.doesNotMatch(main.innerHTML, /Sammelgänge|Notiz bleibt lokal|12,50/);
  navigate(`#/area/${area.id}/entrance/${entrance.id}`);
  assert.match(main.innerHTML, /Eingang bearbeiten/);
  assert.doesNotMatch(main.innerHTML, /Sammelgang|Notiz bleibt lokal|12,50/);
  navigate(`#/area/${area.id}/entrance/${entrance.id}/apt/${encodeURIComponent(entrance.apartments[0].id)}`);
  assert.match(main.innerHTML, /Kein Interesse/);
  await submit({ form: 'apartment-skip', area: area.id, entrance: entrance.id, apt: entrance.apartments[0].id }, { skipReason: 'Kein Interesse' });
  assert.doesNotMatch(main.innerHTML, /name="alwaysSkip"[^>]*checked/);
  navigate('#/history');
  assert.match(main.innerHTML, /Nicht gefunden/);

  navigate(`#/area/${area.id}/entrance/${entrance.id}/edit`);
  await submit({ form: 'entrance', area: area.id, id: entrance.id }, {
    name: 'Haus 1 geändert',
    address: '',
    floors: '1',
    apartmentsPerFloor: '2',
  });
  assert.match(main.innerHTML, /Haus 1 geändert/);
  const persisted = D.importJson(saved.get('sammelgebiet-state'));
  assert.equal(persisted.sessions.length, 1);
  assert.equal(persisted.sessions[0].visits[0].amount, 12.5);
  assert.equal(persisted.areas[0].entrances[0].apartments[0].note, 'Notiz bleibt lokal');
  assert.deepEqual(persisted.areas[0].assignedEmails, ['team@example.org', 'zweites@example.org']);

  await click({ action: 'open-admin' });
  assert.equal(nav.hidden, true);
  assert.match(main.innerHTML, /nicht den Zugangscode der Startseite/);
  assert.match(main.innerHTML, /data-form="admin-reinitialize"/);
  const previousConfig = saved.get('sammelgebiet-admin');
  const previousState = saved.get('sammelgebiet-state');
  const newPassword = { password: 'wiedergefundenespasswort', confirmPassword: 'wiedergefundenespasswort' };
  await submit({ form: 'admin-reinitialize' }, { ...newPassword, code: 'falsch' });
  assert.match(toast.textContent, /Zugangscode.*stimmt nicht/);
  assert.equal(saved.get('sammelgebiet-admin'), previousConfig);
  await submit({ form: 'admin-reinitialize' }, { ...newPassword, confirmPassword: 'falsch', code: '04122026' });
  assert.match(toast.textContent, /Passwörter stimmen nicht/);
  assert.equal(saved.get('sammelgebiet-admin'), previousConfig);
  confirmed = false;
  await submit({ form: 'admin-reinitialize' }, { ...newPassword, code: '04122026' });
  assert.equal(saved.get('sammelgebiet-admin'), previousConfig);
  confirmed = true;
  await submit({ form: 'admin-reinitialize' }, { ...newPassword, code: '04122026' });
  assert.match(main.innerHTML, /aria-label="Wiederherstellungscode"/);
  assert.notEqual(saved.get('sammelgebiet-admin'), previousConfig);
  assert.equal(saved.get('sammelgebiet-state'), previousState, 'reinitializing keeps all app data unchanged');
  await click({ action: 'finish-admin-setup' });
  await click({ action: 'logout' });
  await click({ action: 'open-admin' });
  await submit({ form: 'admin-login' }, { password: 'wiedergefundenespasswort' });
  assert.match(main.innerHTML, /Admin-Verwaltung/);
  assert.equal(saved.get('sammelgebiet-state'), previousState);

  saved.set('sammelgebiet-admin', '{invalid');
  const consoleError = console.error;
  console.error = () => {};
  try {
    await import('../src/app.js?admin-corrupt');
    await settle();
  } finally {
    console.error = consoleError;
  }
  await click({ action: 'open-admin' });
  assert.match(main.innerHTML, /Admin-Konfiguration ist beschädigt/);
  assert.match(main.innerHTML, /data-form="admin-reinitialize"/);
  assert.doesNotMatch(main.innerHTML, /data-form="admin-setup"/);
  await submit({ form: 'admin-reinitialize' }, { ...newPassword, code: '04122026' });
  assert.match(main.innerHTML, /aria-label="Wiederherstellungscode"/);
  assert.equal(saved.get('sammelgebiet-state'), previousState);
});
