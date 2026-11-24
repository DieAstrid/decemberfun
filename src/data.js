// Import/export helpers (JSON backup + CSV). Pure functions, testable in Node.
import {
  SCHEMA_VERSION,
  REASON_LABELS,
  addArea,
  addEntrance,
  emptyState,
  findArea,
  floorLabel,
  generateApartments,
  normalizeApartmentsPerFloor,
  parseAmount,
  sessionAmount,
  sessionStats,
} from './model.js';

export const BACKUP_FORMAT = 'sammelgebiet-backup';

export function exportJson(state, now = new Date()) {
  return JSON.stringify({ format: BACKUP_FORMAT, exportedAt: now.toISOString(), data: state }, null, 2);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`Ungültige Sicherung: ${msg}`);
}

const isStr = (v) => typeof v === 'string';
const isIso = (v) => isStr(v) && !Number.isNaN(new Date(v).getTime());

/** Validates and normalises a state object (e.g. from a backup). Throws on invalid data. */
export function normalizeState(raw) {
  assert(raw && typeof raw === 'object', 'kein Objekt');
  assert(Array.isArray(raw.areas), 'areas fehlt');
  assert(Array.isArray(raw.sessions), 'sessions fehlt');
  assert(!raw.version || raw.version <= SCHEMA_VERSION, `Version ${raw.version} wird nicht unterstützt`);

  const areaIds = new Set();
  const aptIndex = new Map(); // apartmentId -> { areaId, entranceId }
  const areas = raw.areas.map((a) => {
    assert(isStr(a.id) && a.id && !areaIds.has(a.id), 'Gebiet ohne eindeutige ID');
    assert(isStr(a.name) && a.name.trim(), 'Gebiet ohne Namen');
    areaIds.add(a.id);
    assert(Array.isArray(a.entrances), `Gebiet ${a.name}: entrances fehlt`);
    const entrances = a.entrances.map((e) => {
      assert(isStr(e.id) && e.id, 'Eingang ohne ID');
      assert(isStr(e.name) && e.name.trim(), 'Eingang ohne Namen');
      const counts = normalizeApartmentsPerFloor(e.floors, e.apartmentsPerFloor);
      const apartments = generateApartments(e.id, counts.length, counts);
      for (const apt of apartments) {
        assert(!aptIndex.has(apt.id), `doppelte Wohnung ${apt.id}`);
        aptIndex.set(apt.id, { areaId: a.id, entranceId: e.id });
      }
      return { id: e.id, name: e.name.trim(), address: isStr(e.address) ? e.address : '', floors: counts.length, apartmentsPerFloor: counts, apartments };
    });
    return {
      id: a.id,
      name: a.name.trim(),
      targetAmount: parseAmount(a.targetAmount) ?? 0,
      previousYearAmount: parseAmount(a.previousYearAmount) ?? 0,
      note: isStr(a.note) ? a.note : '',
      entrances,
      createdAt: isIso(a.createdAt) ? a.createdAt : new Date(0).toISOString(),
    };
  });

  const sessionIds = new Set();
  const sessions = raw.sessions.map((s) => {
    assert(isStr(s.id) && s.id && !sessionIds.has(s.id), 'Sammelgang ohne eindeutige ID');
    sessionIds.add(s.id);
    assert(areaIds.has(s.areaId), `Sammelgang ${s.id} verweist auf unbekanntes Gebiet`);
    assert(isIso(s.startedAt), `Sammelgang ${s.id} ohne gültige Startzeit`);
    assert(s.endedAt === null || s.endedAt === undefined || isIso(s.endedAt), `Sammelgang ${s.id}: ungültige Endzeit`);
    assert(Array.isArray(s.visits), `Sammelgang ${s.id}: visits fehlt`);
    const visits = s.visits.map((v) => {
      const ref = aptIndex.get(v.apartmentId);
      assert(ref && ref.areaId === s.areaId && ref.entranceId === v.entranceId, `unbekannte Wohnung ${v.apartmentId}`);
      assert(typeof v.opened === 'boolean', 'Besuch ohne Status');
      return {
        entranceId: v.entranceId,
        apartmentId: v.apartmentId,
        opened: v.opened,
        moneyReceived: v.opened ? Boolean(v.moneyReceived) : null,
        amount: v.opened && v.moneyReceived ? parseAmount(v.amount) : null,
        reason: v.opened && !v.moneyReceived ? (REASON_LABELS[v.reason] ? v.reason : null) : null,
        at: isIso(v.at) ? v.at : s.startedAt,
      };
    });
    return {
      id: s.id,
      areaId: s.areaId,
      startedAt: s.startedAt,
      endedAt: s.endedAt ?? null,
      manualAmount: parseAmount(s.manualAmount),
      note: isStr(s.note) ? s.note : '',
      visits,
    };
  });
  const open = new Set();
  for (const s of sessions) {
    if (s.endedAt) continue;
    assert(!open.has(s.areaId), 'mehrere laufende Sammelgänge für ein Gebiet');
    open.add(s.areaId);
  }
  return { version: SCHEMA_VERSION, areas, sessions };
}

/** Parses a JSON backup (wrapped export or raw state). */
export function importJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }
  const data = parsed && parsed.format === BACKUP_FORMAT ? parsed.data : parsed;
  return normalizeState(data);
}

// ---------- CSV ----------

const SEP = ';';

export function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(SEP)).join('\r\n') + '\r\n';
}

/** Minimal RFC-4180 style parser. Detects ";" or "," as separator from the header line. */
export function parseCsv(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const fmtNum = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
const yesNo = (b) => (b === null || b === undefined ? '' : b ? 'ja' : 'nein');

/** One row per recorded apartment visit. */
export function exportVisitsCsv(state) {
  const rows = [
    ['Gebiet', 'Eingang', 'Adresse', 'Etage', 'Wohnung', 'Sammelgang Start', 'Sammelgang Ende', 'Zeitpunkt', 'Geöffnet', 'Geld erhalten', 'Betrag', 'Grund'],
  ];
  for (const s of state.sessions) {
    const area = findArea(state, s.areaId);
    for (const v of s.visits) {
      const ent = area?.entrances.find((e) => e.id === v.entranceId);
      const apt = ent?.apartments.find((a) => a.id === v.apartmentId);
      rows.push([
        area?.name ?? '',
        ent?.name ?? '',
        ent?.address ?? '',
        apt ? floorLabel(apt.floor) : '',
        apt ? apt.index : '',
        s.startedAt,
        s.endedAt ?? '',
        v.at,
        yesNo(v.opened),
        yesNo(v.moneyReceived),
        fmtNum(v.amount),
        v.reason ? REASON_LABELS[v.reason] : '',
      ]);
    }
  }
  return toCsv(rows);
}

/** One row per collection session. */
export function exportSessionsCsv(state) {
  const rows = [['Gebiet', 'Start', 'Ende', 'Dauer (min)', 'Besucht', 'Geöffnet', 'Spenden', 'Kein Bargeld', 'Kein Wille', 'Ist-Betrag', 'Notiz']];
  for (const s of state.sessions) {
    const st = sessionStats(s);
    rows.push([
      findArea(state, s.areaId)?.name ?? '',
      s.startedAt,
      s.endedAt ?? '',
      st.durationMinutes ?? '',
      st.visited,
      st.opened,
      st.donations,
      st.noCash,
      st.noWill,
      fmtNum(sessionAmount(s)),
      s.note,
    ]);
  }
  return toCsv(rows);
}

export const SETUP_CSV_HEADER = ['Gebiet', 'Eingang', 'Adresse', 'Stockwerke', 'Wohnungen je Stockwerk'];

/** Exports the setup (areas + entrances) in the same format accepted by importSetupCsv. */
export function exportSetupCsv(state) {
  const rows = [SETUP_CSV_HEADER];
  for (const a of state.areas) {
    for (const e of a.entrances) rows.push([a.name, e.name, e.address, e.floors, e.apartmentsPerFloor.join(',')]);
  }
  return toCsv(rows);
}

/**
 * Imports areas/entrances from CSV (columns: Gebiet; Eingang; Adresse; Stockwerke; Wohnungen je Stockwerk).
 * Areas are matched by name and created if missing. Returns the new state and the number of entrances added.
 */
export function importSetupCsv(state, text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV enthält keine Datenzeilen.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name.toLowerCase());
  const idx = SETUP_CSV_HEADER.map(col);
  if (idx[0] < 0 || idx[1] < 0 || idx[3] < 0 || idx[4] < 0) {
    throw new Error(`CSV-Kopfzeile muss enthalten: ${SETUP_CSV_HEADER.join('; ')}`);
  }
  let next = state;
  let added = 0;
  rows.slice(1).forEach((r, i) => {
    const get = (k) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
    try {
      const areaName = get(0);
      let area = next.areas.find((a) => a.name.toLowerCase() === areaName.toLowerCase());
      if (!area) ({ state: next, area } = addArea(next, { name: areaName }));
      ({ state: next } = addEntrance(next, area.id, {
        name: get(1),
        address: get(2),
        floors: Number(get(3)),
        apartmentsPerFloor: get(4),
      }));
      added++;
    } catch (err) {
      throw new Error(`Zeile ${i + 2}: ${err.message}`);
    }
  });
  return { state: next, added };
}

export { emptyState };
