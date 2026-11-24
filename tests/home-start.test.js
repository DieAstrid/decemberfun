import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('home starts or resumes a session for the selected area', async (t) => {
  const saved = new Map();
  const listeners = new Map();
  const windowListeners = new Map();
  const main = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const elements = { main, nav: { innerHTML: '', hidden: false }, toast: { textContent: '', className: '' } };
  const globals = {
    document: {
      documentElement: { dataset: {} },
      getElementById: (id) => elements[id],
      addEventListener: (event, fn) => listeners.set(event, fn),
    },
    window: { addEventListener: (event, fn) => windowListeners.set(event, fn), scrollTo() {} },
    location: { hash: '#/', protocol: 'http:' },
    localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) },
    navigator: {},
    setInterval() {}, setTimeout() {}, clearTimeout() {},
    FormData: class {
      constructor(form) { this.values = form.values; }
      [Symbol.iterator]() { return Object.entries(this.values)[Symbol.iterator](); }
    },
  };
  const original = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const navigate = (hash) => {
    location.hash = hash;
    windowListeners.get('hashchange')();
  };
  const load = async (state, tag) => {
    saved.set('sammelgebiet-state', JSON.stringify(state));
    location.hash = '#/';
    await import(`../src/app.js?home-start-${tag}`);
    await settle();
    const form = { dataset: { form: 'access' }, values: { code: '04122026' } };
    await listeners.get('submit')({ target: { closest: () => form }, preventDefault() {} });
    await settle();
  };
  const clickStart = async (id) => {
    const el = { dataset: { action: 'start-session', id }, matches: () => false };
    listeners.get('click')({ target: { closest: () => el } });
    await settle();
  };

  let state = M.emptyState();
  await load(state, 'empty');
  assert.match(main.innerHTML, /Noch keine Sammelgebiete/);
  assert.match(main.innerHTML, /<button class="btn primary block" disabled>▶ Sammelgang starten<\/button>[\s\S]*Neues Sammelgebiet/);

  let first, second;
  ({ state, area: first } = M.addArea(state, { name: 'Nord' }));
  await load(state, 'no-entrance');
  assert.match(main.innerHTML, /data-action="start-session"[^>]*disabled/);
  assert.match(main.innerHTML, /Lege zuerst einen Eingang/);
  ({ state } = M.addEntrance(state, first.id, { name: 'Haus', floors: 1, apartmentsPerFloor: 1 }));
  await load(state, 'single');
  assert.match(main.innerHTML, new RegExp(`data-action="start-session" data-id="${first.id}"[^>]*>▶ Sammelgang starten`));
  await clickStart(first.id);
  state = JSON.parse(saved.get('sammelgebiet-state'));
  const running = M.activeSession(state, first.id);
  assert.ok(running);
  assert.equal(location.hash, `#/session/${running.id}`);
  navigate('#/');
  assert.match(main.innerHTML, new RegExp(`href="#/session/${running.id}">▶ Sammelgang fortsetzen`));
  await clickStart(first.id);
  assert.match(elements.toast.textContent, /läuft bereits ein Sammelgang/);
  assert.equal(JSON.parse(saved.get('sammelgebiet-state')).sessions.length, 1);

  ({ state, area: second } = M.addArea(state, { name: 'Süd <West>' }));
  ({ state } = M.addEntrance(state, second.id, { name: 'Haus 2', floors: 1, apartmentsPerFloor: 1 }));
  await load(state, 'multiple');
  assert.match(main.innerHTML, /href="#\/start-session">▶ Sammelgang starten/);
  navigate('#/start-session');
  assert.match(main.innerHTML, /Sammelgebiet auswählen/);
  assert.match(main.innerHTML, /Süd &lt;West&gt;/);
  assert.match(main.innerHTML, new RegExp(`href="#/session/${running.id}">▶ Sammelgang fortsetzen`));
  assert.match(main.innerHTML, new RegExp(`data-action="start-session" data-id="${second.id}"`));
  await clickStart(second.id);
  state = JSON.parse(saved.get('sammelgebiet-state'));
  assert.ok(M.activeSession(state, second.id));
  assert.equal(state.sessions.length, 2);
});
