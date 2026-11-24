// Persistence per device: IndexedDB with localStorage fallback.
import { emptyState } from './model.js';
import { normalizeState } from './data.js';

const DB_NAME = 'sammelgebiet';
const STORE = 'kv';
const KEY = 'state';
const LS_KEY = 'sammelgebiet-state';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB nicht verfügbar'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function createStorage() {
  let db = null;
  try {
    db = await openDb();
  } catch {
    db = null;
  }
  navigator.storage?.persist?.().catch(() => {});

  return {
    kind: db ? 'IndexedDB' : 'Local Storage',
    async load() {
      let raw = null;
      if (db) raw = await tx(db, 'readonly', (s) => s.get(KEY));
      if (!raw) {
        const ls = localStorage.getItem(LS_KEY);
        raw = ls ? JSON.parse(ls) : null;
      }
      if (!raw) return emptyState();
      try {
        return normalizeState(raw);
      } catch (err) {
        console.error('Gespeicherte Daten ungültig', err);
        return { ...emptyState(), ...raw };
      }
    },
    async save(state) {
      if (db) await tx(db, 'readwrite', (s) => s.put(state, KEY));
      else localStorage.setItem(LS_KEY, JSON.stringify(state));
    },
  };
}
