import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';
import * as D from '../src/data.js';

function sample() {
  let s = M.emptyState();
  let area;
  let entrance;
  let session;
  ({ state: s, area } = M.addArea(s, { name: 'Nord; "Alt"', targetAmount: 50 }));
  ({ state: s, entrance } = M.addEntrance(s, area.id, { name: 'Haus 1', address: 'Weg 1, Stadt', floors: 2, apartmentsPerFloor: '1,2' }));
  ({ state: s, session } = M.startSession(s, area.id, new Date('2026-11-01T10:00:00Z')));
  s = M.recordVisit(s, session.id, { entranceId: entrance.id, apartmentId: entrance.apartments[0].id, opened: true, moneyReceived: true, amount: 7.5 });
  s = M.recordVisit(s, session.id, { entranceId: entrance.id, apartmentId: entrance.apartments[1].id, opened: true, moneyReceived: false, reason: 'no-will' });
  return { s, area, entrance, session };
}

test('JSON export/import round-trip restores the full state', () => {
  const { s } = sample();
  const restored = D.importJson(D.exportJson(s));
  assert.deepEqual(restored, s);
  assert.deepEqual(D.importJson(JSON.stringify(s)), s, 'raw state is accepted too');
});

test('importJson rejects invalid backups', () => {
  assert.throws(() => D.importJson('{nope'), /kein gültiges JSON/);
  assert.throws(() => D.importJson('{"areas":1,"sessions":[]}'), /areas fehlt/);
  const { s, session } = sample();
  const broken = structuredClone(s);
  broken.sessions[0].visits[0].apartmentId = 'unknown';
  assert.throws(() => D.importJson(JSON.stringify(broken)), /unbekannte Wohnung/);
  const twoOpen = structuredClone(s);
  twoOpen.sessions.push({ ...structuredClone(twoOpen.sessions[0]), id: session.id + 'x' });
  assert.throws(() => D.importJson(JSON.stringify(twoOpen)), /mehrere laufende/);
});

test('apartment notes survive backups, entrance edits and CSV escaping, including unvisited apartments', () => {
  let { s, area, entrance } = sample();
  const note = 'Bitte klingeln; "Hof"\nAbends';
  const aptId = entrance.apartments[0].id;
  const unvisitedId = entrance.apartments[2].id;
  s = M.updateApartmentNote(s, area.id, entrance.id, aptId, note);
  s = M.updateApartmentNote(s, area.id, entrance.id, unvisitedId, 'Noch nicht besucht');
  s = D.importJson(D.exportJson(s));
  assert.equal(M.findEntrance(s, area.id, entrance.id).apartments[0].note, note);
  s = M.updateEntrance(s, area.id, entrance.id, { floors: 3, apartmentsPerFloor: 2 });
  const apartments = M.findEntrance(s, area.id, entrance.id).apartments;
  assert.equal(apartments.find((apt) => apt.id === aptId).note, note);
  assert.equal(apartments.find((apt) => apt.id === unvisitedId).note, 'Noch nicht besucht');
  assert.equal(apartments.find((apt) => apt.floor === 2).note, undefined);
  const visits = D.parseCsv(D.exportVisitsCsv(s));
  assert.equal(visits[1][visits[0].indexOf('Wohnungsnotiz')], note);
  const rows = D.parseCsv(D.exportApartmentsCsv(s));
  assert.equal(rows.length, apartments.length + 1);
  assert.equal(rows[1][5], note);
  assert.ok(rows.some((row) => row[5] === 'Noch nicht besucht'));
  s = M.updateApartmentNote(s, area.id, entrance.id, aptId, '');
  assert.equal(D.importJson(D.exportJson(s)).areas[0].entrances[0].apartments[0].note, '');
  assert.throws(() => M.updateApartmentNote(s, area.id, entrance.id, 'missing', 'x'), /Wohnung nicht gefunden/);
});

test('legacy backups without apartment notes remain unchanged', () => {
  const { s } = sample();
  assert.deepEqual(D.importJson(D.exportJson(s)), s);
  s.areas[0].entrances[0].apartments[0].note = 42;
  assert.throws(() => D.importJson(D.exportJson(s)), /ungültige Notiz/);
});

test('CSV escaping and parsing round-trip', () => {
  const rows = [['a;b', 'say "hi"', 'line\nbreak', ''], ['1', '2,5', 'x', 'y']];
  assert.deepEqual(D.parseCsv(D.toCsv(rows)), rows);
  assert.deepEqual(D.parseCsv('\uFEFFa,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']], 'comma separator detected');
});

test('visits and sessions CSV export', () => {
  const { s } = sample();
  const visits = D.parseCsv(D.exportVisitsCsv(s));
  assert.equal(visits.length, 3);
  assert.equal(visits[0][0], 'Gebiet');
  assert.equal(visits[1][0], 'Nord; "Alt"');
  assert.equal(visits[1][3], 'EG');
  assert.equal(visits[1][10], '7,5');
  assert.equal(visits[2][11], 'Kein Wille');
  const sessions = D.parseCsv(D.exportSessionsCsv(s));
  assert.equal(sessions.length, 2);
  assert.equal(sessions[1][9], '7,5');
});

test('setup CSV export can be re-imported', () => {
  let { s, area } = sample();
  s = M.updateArea(s, area.id, { assignedEmails: 'Team@example.org; zweite@example.org' });
  const csv = D.exportSetupCsv(s);
  const { state, added } = D.importSetupCsv(M.emptyState(), csv);
  assert.equal(added, 1);
  assert.equal(state.areas[0].name, 'Nord; "Alt"');
  assert.deepEqual(state.areas[0].entrances[0].apartmentsPerFloor, [1, 2]);
  assert.equal(state.areas[0].entrances[0].address, 'Weg 1, Stadt');
  assert.deepEqual(state.areas[0].assignedEmails, ['team@example.org', 'zweite@example.org']);

  const merged = D.importSetupCsv(s, csv).state;
  assert.equal(merged.areas.length, 1, 'existing area is matched by name');
  assert.equal(merged.areas[0].entrances.length, 2);
  assert.deepEqual(merged.areas[0].assignedEmails, ['team@example.org', 'zweite@example.org']);
});

test('setup CSV import reports the failing line', () => {
  const csv = 'Gebiet;Eingang;Adresse;Stockwerke;Wohnungen je Stockwerk\nA;H1;;3;2\nA;H2;;0;2\n';
  assert.throws(() => D.importSetupCsv(M.emptyState(), csv), /Zeile 3/);
  assert.throws(() => D.importSetupCsv(M.emptyState(), 'x;y\n1;2'), /Kopfzeile/);
});

test('legacy setup CSV imports remain compatible and malformed assignment emails are rejected', () => {
  const legacyCsv = 'Gebiet;Eingang;Adresse;Stockwerke;Wohnungen je Stockwerk\nAlt;Haus;;1;2\n';
  assert.deepEqual(D.importSetupCsv(M.emptyState(), legacyCsv).state.areas[0].assignedEmails, []);
  const invalidCsv = 'Gebiet;Eingang;Adresse;Stockwerke;Wohnungen je Stockwerk;Zugewiesene E-Mails\nA;Haus;;1;2;kein-email\n';
  assert.throws(() => D.importSetupCsv(M.emptyState(), invalidCsv), /Zeile 2: Ungültige E-Mail-Adresse/);
});

test('setup CSV round-trips areas that do not yet have entrances', () => {
  let state = M.emptyState();
  let area;
  ({ state, area } = M.addArea(state, { name: 'Neues Gebiet', assignedEmails: 'team@example.org' }));
  const restored = D.importSetupCsv(M.emptyState(), D.exportSetupCsv(state));
  assert.equal(restored.added, 0);
  assert.equal(restored.state.areas[0].name, 'Neues Gebiet');
  assert.deepEqual(restored.state.areas[0].assignedEmails, ['team@example.org']);
});
