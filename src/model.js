// Pure data model and business logic. No DOM or storage access here so it can be tested in Node.

export const SCHEMA_VERSION = 1;

export const REASONS = Object.freeze({
  NO_CASH: 'no-cash',
  NO_WILL: 'no-will',
});

export const REASON_LABELS = Object.freeze({
  [REASONS.NO_CASH]: 'Kein Bargeld',
  [REASONS.NO_WILL]: 'Kein Wille',
});

export function createId(prefix = 'id') {
  const rnd =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

export function emptyState() {
  return { version: SCHEMA_VERSION, areas: [], sessions: [] };
}

function toNonNegativeNumber(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function parseAmount(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ---------- Floors & apartments ----------

/**
 * Normalises the "apartments per floor" input. Accepts a single number (same count on each
 * floor), an array, or a comma/semicolon separated string ("2,3,3") with one value per floor.
 * Returns an array with exactly `floors` entries.
 */
export function normalizeApartmentsPerFloor(floors, perFloor) {
  const floorCount = Number(floors);
  if (!Number.isInteger(floorCount) || floorCount < 1 || floorCount > 99) {
    throw new Error('Stockwerkanzahl muss zwischen 1 und 99 liegen.');
  }
  let list;
  if (Array.isArray(perFloor)) list = perFloor;
  else if (typeof perFloor === 'string' && /[,;]/.test(perFloor)) list = perFloor.split(/[,;]/);
  else list = [perFloor];

  const values = list
    .map((v) => String(v ?? '').trim())
    .filter((v) => v !== '')
    .map(Number);
  if (values.length === 0 || values.some((v) => !Number.isInteger(v) || v < 0 || v > 99)) {
    throw new Error('Wohnungen je Stockwerk müssen ganze Zahlen zwischen 0 und 99 sein.');
  }
  if (values.length === 1) return Array.from({ length: floorCount }, () => values[0]);
  if (values.length !== floorCount) {
    throw new Error(`Bitte ${floorCount} Werte für Wohnungen je Stockwerk angeben (einen pro Etage).`);
  }
  return values;
}

export function floorLabel(floor) {
  return floor === 0 ? 'EG' : `${floor}. OG`;
}

export function apartmentId(entranceId, floor, index) {
  return `${entranceId}:${floor}:${index}`;
}

/**
 * Generates the apartment list for an entrance. IDs are deterministic (entrance/floor/position),
 * so editing an entrance keeps the history of apartments that still exist.
 */
export function generateApartments(entranceId, floors, perFloor) {
  const counts = normalizeApartmentsPerFloor(floors, perFloor);
  const apartments = [];
  counts.forEach((count, floor) => {
    for (let i = 1; i <= count; i++) {
      apartments.push({
        id: apartmentId(entranceId, floor, i),
        floor,
        index: i,
        label: `${floorLabel(floor)} · Whg. ${i}`,
      });
    }
  });
  return apartments;
}

export function groupByFloor(apartments) {
  const map = new Map();
  for (const apt of apartments) {
    if (!map.has(apt.floor)) map.set(apt.floor, []);
    map.get(apt.floor).push(apt);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([floor, list]) => ({
      floor,
      label: floorLabel(floor),
      apartments: list.sort((a, b) => a.index - b.index),
    }));
}

// ---------- Areas & entrances ----------

export function findArea(state, areaId) {
  return state.areas.find((a) => a.id === areaId) || null;
}

export function findEntrance(state, areaId, entranceId) {
  return findArea(state, areaId)?.entrances.find((e) => e.id === entranceId) || null;
}

export function findSession(state, sessionId) {
  return state.sessions.find((s) => s.id === sessionId) || null;
}

function cleanName(name, what) {
  const n = String(name ?? '').trim();
  if (!n) throw new Error(`${what} darf nicht leer sein.`);
  return n;
}

export function addArea(state, { name, targetAmount, previousYearAmount, note } = {}, now = new Date()) {
  const area = {
    id: createId('area'),
    name: cleanName(name, 'Name des Sammelgebiets'),
    targetAmount: toNonNegativeNumber(targetAmount),
    previousYearAmount: toNonNegativeNumber(previousYearAmount),
    note: String(note ?? '').trim(),
    entrances: [],
    createdAt: now.toISOString(),
  };
  return { state: { ...state, areas: [...state.areas, area] }, area };
}

export function updateArea(state, areaId, patch) {
  if (!findArea(state, areaId)) throw new Error('Sammelgebiet nicht gefunden.');
  return {
    ...state,
    areas: state.areas.map((a) => {
      if (a.id !== areaId) return a;
      const next = { ...a };
      if ('name' in patch) next.name = cleanName(patch.name, 'Name des Sammelgebiets');
      if ('targetAmount' in patch) next.targetAmount = toNonNegativeNumber(patch.targetAmount);
      if ('previousYearAmount' in patch) next.previousYearAmount = toNonNegativeNumber(patch.previousYearAmount);
      if ('note' in patch) next.note = String(patch.note ?? '').trim();
      return next;
    }),
  };
}

/** Deletes an area including all its collection sessions. */
export function deleteArea(state, areaId) {
  return {
    ...state,
    areas: state.areas.filter((a) => a.id !== areaId),
    sessions: state.sessions.filter((s) => s.areaId !== areaId),
  };
}

function buildEntrance(id, { name, address, floors, apartmentsPerFloor }) {
  const counts = normalizeApartmentsPerFloor(floors, apartmentsPerFloor);
  return {
    id,
    name: cleanName(name, 'Name des Eingangs'),
    address: String(address ?? '').trim(),
    floors: counts.length,
    apartmentsPerFloor: counts,
    apartments: generateApartments(id, counts.length, counts),
  };
}

export function addEntrance(state, areaId, input) {
  if (!findArea(state, areaId)) throw new Error('Sammelgebiet nicht gefunden.');
  const entrance = buildEntrance(createId('ent'), input);
  return {
    state: {
      ...state,
      areas: state.areas.map((a) => (a.id === areaId ? { ...a, entrances: [...a.entrances, entrance] } : a)),
    },
    entrance,
  };
}

/**
 * Updates an entrance and regenerates its apartments. Visits of apartments that no longer exist
 * (e.g. floors removed) are dropped so sessions stay consistent.
 */
export function updateEntrance(state, areaId, entranceId, input) {
  const existing = findEntrance(state, areaId, entranceId);
  if (!existing) throw new Error('Eingang nicht gefunden.');
  const entrance = buildEntrance(entranceId, { ...existing, ...input });
  const previousApartments = new Map(existing.apartments.map((apt) => [apt.id, apt]));
  entrance.apartments = entrance.apartments.map((apt) => {
    const previous = previousApartments.get(apt.id);
    return previous && 'note' in previous ? { ...apt, note: previous.note } : apt;
  });
  const validIds = new Set(entrance.apartments.map((a) => a.id));
  return {
    ...state,
    areas: state.areas.map((a) =>
      a.id === areaId ? { ...a, entrances: a.entrances.map((e) => (e.id === entranceId ? entrance : e)) } : a,
    ),
    sessions: state.sessions.map((s) =>
      s.areaId === areaId
        ? { ...s, visits: s.visits.filter((v) => v.entranceId !== entranceId || validIds.has(v.apartmentId)) }
        : s,
    ),
  };
}

/** Deletes an entrance and removes its visits from all sessions. */
export function deleteEntrance(state, areaId, entranceId) {
  return {
    ...state,
    areas: state.areas.map((a) =>
      a.id === areaId ? { ...a, entrances: a.entrances.filter((e) => e.id !== entranceId) } : a,
    ),
    sessions: state.sessions.map((s) =>
      s.areaId === areaId ? { ...s, visits: s.visits.filter((v) => v.entranceId !== entranceId) } : s,
    ),
  };
}

export function updateApartmentNote(state, areaId, entranceId, aptId, note) {
  const entrance = findEntrance(state, areaId, entranceId);
  if (!entrance?.apartments.some((apt) => apt.id === aptId)) throw new Error('Wohnung nicht gefunden.');
  return {
    ...state,
    areas: state.areas.map((area) => area.id !== areaId ? area : {
      ...area,
      entrances: area.entrances.map((e) => e.id !== entranceId ? e : {
        ...e,
        apartments: e.apartments.map((apt) => apt.id === aptId ? { ...apt, note: String(note ?? '').trim() } : apt),
      }),
    }),
  };
}

// ---------- Collection sessions (Sammelgänge) ----------

export function activeSession(state, areaId) {
  return state.sessions.find((s) => s.areaId === areaId && !s.endedAt) || null;
}

/** Starts a collection session; the start time is captured automatically. */
export function startSession(state, areaId, now = new Date()) {
  if (!findArea(state, areaId)) throw new Error('Sammelgebiet nicht gefunden.');
  if (activeSession(state, areaId)) throw new Error('Für dieses Gebiet läuft bereits ein Sammelgang.');
  const session = {
    id: createId('ses'),
    areaId,
    startedAt: now.toISOString(),
    endedAt: null,
    manualAmount: null,
    note: '',
    visits: [],
  };
  return { state: { ...state, sessions: [...state.sessions, session] }, session };
}

export function validateVisit({ opened, moneyReceived, amount, reason }) {
  if (typeof opened !== 'boolean') throw new Error('Bitte angeben, ob geöffnet wurde.');
  if (!opened) return { opened: false, moneyReceived: null, amount: null, reason: null };
  if (typeof moneyReceived !== 'boolean') throw new Error('Bitte angeben, ob Geld erhalten wurde.');
  if (moneyReceived) {
    return { opened: true, moneyReceived: true, amount: parseAmount(amount), reason: null };
  }
  if (reason !== REASONS.NO_CASH && reason !== REASONS.NO_WILL) {
    throw new Error('Bitte einen Grund wählen: kein Bargeld oder kein Wille.');
  }
  return { opened: true, moneyReceived: false, amount: null, reason };
}

/** Records (or replaces) the result for one apartment within a running session. */
export function recordVisit(state, sessionId, { entranceId, apartmentId: aptId, ...result }, now = new Date()) {
  const session = findSession(state, sessionId);
  if (!session) throw new Error('Sammelgang nicht gefunden.');
  if (session.endedAt) throw new Error('Der Sammelgang ist bereits beendet.');
  const entrance = findEntrance(state, session.areaId, entranceId);
  if (!entrance || !entrance.apartments.some((a) => a.id === aptId)) throw new Error('Wohnung nicht gefunden.');
  const visit = { entranceId, apartmentId: aptId, ...validateVisit(result), at: now.toISOString() };
  return replaceSession(state, sessionId, {
    visits: [...session.visits.filter((v) => v.apartmentId !== aptId), visit],
  });
}

export function clearVisit(state, sessionId, aptId) {
  const session = findSession(state, sessionId);
  if (!session) throw new Error('Sammelgang nicht gefunden.');
  if (session.endedAt) throw new Error('Der Sammelgang ist bereits beendet.');
  return replaceSession(state, sessionId, { visits: session.visits.filter((v) => v.apartmentId !== aptId) });
}

/** Sets the manually counted Ist-Betrag. Empty input resets to the sum of recorded amounts. */
export function setSessionAmount(state, sessionId, amount) {
  if (!findSession(state, sessionId)) throw new Error('Sammelgang nicht gefunden.');
  return replaceSession(state, sessionId, { manualAmount: parseAmount(amount) });
}

export function updateSessionNote(state, sessionId, note) {
  if (!findSession(state, sessionId)) throw new Error('Sammelgang nicht gefunden.');
  return replaceSession(state, sessionId, { note: String(note ?? '').trim() });
}

/**
 * Ends a session. The end time is confirmed by the user and must not lie before the start.
 * End times come from minute-precision inputs, so an end within the start minute is clamped to the start.
 */
export function endSession(state, sessionId, endedAt) {
  const session = findSession(state, sessionId);
  if (!session) throw new Error('Sammelgang nicht gefunden.');
  if (session.endedAt) throw new Error('Der Sammelgang ist bereits beendet.');
  let end = endedAt instanceof Date ? endedAt : new Date(endedAt);
  if (Number.isNaN(end.getTime())) throw new Error('Ungültige Endzeit.');
  const start = new Date(session.startedAt);
  if (end < start) {
    const startMinute = new Date(start);
    startMinute.setSeconds(0, 0);
    if (end < startMinute) throw new Error('Die Endzeit liegt vor der Startzeit.');
    end = start;
  }
  return replaceSession(state, sessionId, { endedAt: end.toISOString() });
}

export function reopenSession(state, sessionId) {
  const session = findSession(state, sessionId);
  if (!session) throw new Error('Sammelgang nicht gefunden.');
  if (!session.endedAt) return state;
  if (activeSession(state, session.areaId)) throw new Error('Für dieses Gebiet läuft bereits ein Sammelgang.');
  return replaceSession(state, sessionId, { endedAt: null });
}

export function deleteSession(state, sessionId) {
  return { ...state, sessions: state.sessions.filter((s) => s.id !== sessionId) };
}

function replaceSession(state, sessionId, patch) {
  return { ...state, sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)) };
}

// ---------- Apartment status across sessions ----------

/**
 * An apartment counts as "abgearbeitet" (done) once someone opened.
 * It remains accessible for another visit with the show-done toggle.
 */
export function isVisitFinal(visit) {
  return Boolean(visit?.opened);
}

export function sessionsOfArea(state, areaId) {
  return state.sessions
    .filter((s) => s.areaId === areaId)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** All visits of an apartment over all sessions, oldest first. */
export function apartmentHistory(state, areaId, aptId) {
  const result = [];
  for (const s of sessionsOfArea(state, areaId)) {
    for (const v of s.visits) {
      if (v.apartmentId === aptId) result.push({ ...v, sessionId: s.id, sessionStartedAt: s.startedAt });
    }
  }
  return result;
}

/**
 * Status of an apartment from the perspective of `sessionId` (or overall when omitted):
 * - current: visit recorded in this session (if any)
 * - doneBefore: a final visit exists in another session
 * - lastVisit: most recent visit in any other session
 * - done: a final visit exists in any session
 */
export function apartmentStatus(state, areaId, aptId, sessionId = null) {
  const history = apartmentHistory(state, areaId, aptId);
  const current = sessionId ? history.find((v) => v.sessionId === sessionId) || null : null;
  const others = history.filter((v) => v.sessionId !== sessionId);
  return {
    current,
    doneBefore: others.some(isVisitFinal),
    lastVisit: others[others.length - 1] || null,
    visits: history.length,
    done: history.some(isVisitFinal),
  };
}

/** Apartments of an entrance for a session, hiding all completed apartments unless `showDone`. */
export function apartmentsForSession(state, sessionId, entranceId, { showDone = false } = {}) {
  const session = findSession(state, sessionId);
  if (!session) throw new Error('Sammelgang nicht gefunden.');
  const entrance = findEntrance(state, session.areaId, entranceId);
  if (!entrance) throw new Error('Eingang nicht gefunden.');
  return entrance.apartments
    .map((apt) => ({ ...apt, status: apartmentStatus(state, session.areaId, apt.id, sessionId) }))
    .filter((apt) => showDone || !apt.status.done);
}

export function entranceStats(state, areaId, entranceId) {
  const entrance = findEntrance(state, areaId, entranceId);
  if (!entrance) return { total: 0, done: 0, open: 0, visited: 0 };
  let done = 0;
  let visited = 0;
  for (const apt of entrance.apartments) {
    const st = apartmentStatus(state, areaId, apt.id);
    if (st.done) done++;
    if (st.visits > 0) visited++;
  }
  return { total: entrance.apartments.length, done, open: entrance.apartments.length - done, visited };
}

// ---------- Amounts & gamification ----------

export function visitsTotal(session) {
  return roundMoney(session.visits.reduce((sum, v) => sum + (v.moneyReceived && v.amount ? v.amount : 0), 0));
}

/** Ist-Betrag of a session: manual amount if entered, otherwise sum of recorded visit amounts. */
export function sessionAmount(session) {
  return session.manualAmount !== null && session.manualAmount !== undefined
    ? roundMoney(session.manualAmount)
    : visitsTotal(session);
}

export function sessionStats(session) {
  const v = session.visits;
  return {
    visited: v.length,
    opened: v.filter((x) => x.opened).length,
    notOpened: v.filter((x) => !x.opened).length,
    donations: v.filter((x) => x.moneyReceived).length,
    noCash: v.filter((x) => x.reason === REASONS.NO_CASH).length,
    noWill: v.filter((x) => x.reason === REASONS.NO_WILL).length,
    amount: sessionAmount(session),
    durationMinutes: session.endedAt
      ? Math.max(0, Math.round((new Date(session.endedAt) - new Date(session.startedAt)) / 60000))
      : null,
  };
}

/** Goal is the explicit target amount, or the previous year's amount as fallback. */
export function areaGoal(area) {
  return area.targetAmount > 0 ? area.targetAmount : area.previousYearAmount || 0;
}

export function computeProgress(collected, goal) {
  const c = roundMoney(collected);
  const g = roundMoney(goal);
  const percent = g > 0 ? Math.round((c / g) * 1000) / 10 : 0;
  let level;
  if (g <= 0) level = 'no-goal';
  else if (c >= g) level = 'success';
  else if (percent >= 75) level = 'almost';
  else if (percent >= 25) level = 'progress';
  else level = 'start';
  return {
    collected: c,
    goal: g,
    percent,
    barPercent: Math.min(100, percent),
    remaining: roundMoney(Math.max(0, g - c)),
    surplus: roundMoney(Math.max(0, c - g)),
    success: g > 0 && c >= g,
    level,
  };
}

export function areaProgress(state, areaId) {
  const area = findArea(state, areaId);
  if (!area) throw new Error('Sammelgebiet nicht gefunden.');
  const collected = state.sessions
    .filter((s) => s.areaId === areaId)
    .reduce((sum, s) => sum + sessionAmount(s), 0);
  return computeProgress(collected, areaGoal(area));
}

export function overallProgress(state) {
  const collected = state.sessions.reduce((sum, s) => sum + sessionAmount(s), 0);
  const goal = state.areas.reduce((sum, a) => sum + areaGoal(a), 0);
  return computeProgress(collected, goal);
}

export const LEVEL_MESSAGES = Object.freeze({
  'no-goal': 'Noch kein Ziel festgelegt.',
  start: 'Los geht’s – jeder Euro zählt!',
  progress: 'Gut unterwegs!',
  almost: 'Fast geschafft – Endspurt!',
  success: 'Ziel erreicht! 🎉',
});
