import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';

function setup() {
  let s = M.emptyState();
  let area;
  let entrance;
  ({ state: s, area } = M.addArea(s, { name: 'Gebiet', targetAmount: 100 }));
  ({ state: s, entrance } = M.addEntrance(s, area.id, { name: 'Haus A', floors: 2, apartmentsPerFloor: 2 }));
  return { s, area, entrance, apt: (floor, i) => `${entrance.id}:${floor}:${i}` };
}

test('starting a session records the start time automatically and blocks parallel sessions', () => {
  const { s, area } = setup();
  const now = new Date('2026-11-20T10:00:00Z');
  const { state, session } = M.startSession(s, area.id, now);
  assert.equal(session.startedAt, now.toISOString());
  assert.equal(session.endedAt, null);
  assert.equal(M.activeSession(state, area.id).id, session.id);
  assert.throws(() => M.startSession(state, area.id), /läuft bereits/);
});

test('ending a session requires a confirmed end time not before start', () => {
  let { s, area } = setup();
  let session;
  ({ state: s, session } = M.startSession(s, area.id, new Date('2026-11-20T10:00:00Z')));
  assert.throws(() => M.endSession(s, session.id, '2026-11-20T09:00:00Z'), /vor der Startzeit/);
  assert.throws(() => M.endSession(s, session.id, 'kaputt'), /Ungültige Endzeit/);
  s = M.endSession(s, session.id, new Date('2026-11-20T11:30:00Z'));
  const ended = M.findSession(s, session.id);
  assert.equal(ended.endedAt, '2026-11-20T11:30:00.000Z');
  assert.equal(M.sessionStats(ended).durationMinutes, 90);
  assert.equal(M.activeSession(s, area.id), null);
  assert.throws(() => M.endSession(s, session.id, new Date()), /bereits beendet/);
  assert.throws(
    () => M.recordVisit(s, session.id, { entranceId: 'x', apartmentId: 'y', opened: false }),
    /bereits beendet/,
  );
  s = M.reopenSession(s, session.id);
  assert.equal(M.findSession(s, session.id).endedAt, null);
});

test('an end time within the start minute (minute-precision input) is clamped to the start', () => {
  let { s, area } = setup();
  let session;
  ({ state: s, session } = M.startSession(s, area.id, new Date('2026-11-20T10:00:42Z')));
  s = M.endSession(s, session.id, new Date('2026-11-20T10:00:00Z'));
  assert.equal(M.findSession(s, session.id).endedAt, '2026-11-20T10:00:42.000Z');
});

test('recording a visit replaces an earlier result of the same apartment in the same session', () => {
  let { s, area, entrance, apt } = setup();
  let session;
  ({ state: s, session } = M.startSession(s, area.id));
  s = M.recordVisit(s, session.id, { entranceId: entrance.id, apartmentId: apt(0, 1), opened: false });
  s = M.recordVisit(s, session.id, { entranceId: entrance.id, apartmentId: apt(0, 1), opened: true, moneyReceived: true, amount: 5 });
  const visits = M.findSession(s, session.id).visits;
  assert.equal(visits.length, 1);
  assert.equal(visits[0].amount, 5);
  assert.throws(
    () => M.recordVisit(s, session.id, { entranceId: entrance.id, apartmentId: 'nope', opened: false }),
    /Wohnung nicht gefunden/,
  );
  s = M.clearVisit(s, session.id, apt(0, 1));
  assert.equal(M.findSession(s, session.id).visits.length, 0);
});

test('session stats count statuses and reasons', () => {
  let { s, area, entrance, apt } = setup();
  let session;
  ({ state: s, session } = M.startSession(s, area.id));
  const rec = (a, r) => (s = M.recordVisit(s, session.id, { entranceId: entrance.id, apartmentId: a, ...r }));
  rec(apt(0, 1), { opened: false });
  rec(apt(0, 2), { opened: true, moneyReceived: true, amount: 12 });
  rec(apt(1, 1), { opened: true, moneyReceived: false, reason: M.REASONS.NO_CASH });
  rec(apt(1, 2), { opened: true, moneyReceived: false, reason: M.REASONS.NO_WILL });
  const st = M.sessionStats(M.findSession(s, session.id));
  assert.deepEqual(
    { ...st, durationMinutes: undefined },
    { visited: 4, opened: 3, notOpened: 1, donations: 1, noCash: 1, noWill: 1, comeBack: 0, amount: 12, durationMinutes: undefined },
  );
});

test('repeated visits: done apartments are hidden in later sessions and can be shown on demand', () => {
  let { s, area, entrance, apt } = setup();
  let first;
  ({ state: s, session: first } = M.startSession(s, area.id, new Date('2026-11-01T10:00:00Z')));
  const rec = (sid, a, r) => (s = M.recordVisit(s, sid, { entranceId: entrance.id, apartmentId: a, ...r }));
  rec(first.id, apt(0, 1), { opened: true, moneyReceived: true, amount: 10 }); // final
  rec(first.id, apt(0, 2), { opened: true, moneyReceived: false, reason: M.REASONS.NO_WILL }); // final
  rec(first.id, apt(1, 1), { opened: true, moneyReceived: false, reason: M.REASONS.NO_CASH }); // opened
  rec(first.id, apt(1, 2), { opened: false }); // revisit

  assert.deepEqual(M.apartmentsForSession(s, first.id, entrance.id).map((a) => a.id), [apt(1, 2)]);
  assert.equal(M.apartmentsForSession(s, first.id, entrance.id, { showDone: true }).length, 4);
  s = M.endSession(s, first.id, new Date('2026-11-01T12:00:00Z'));

  let second;
  ({ state: s, session: second } = M.startSession(s, area.id, new Date('2026-11-08T10:00:00Z')));
  const pending = M.apartmentsForSession(s, second.id, entrance.id);
  assert.deepEqual(pending.map((a) => a.id), [apt(1, 2)]);
  assert.equal(pending[0].status.lastVisit.opened, false, 'previous result is shown as hint');

  const all = M.apartmentsForSession(s, second.id, entrance.id, { showDone: true });
  assert.equal(all.length, 4);
  assert.equal(all.filter((a) => a.status.doneBefore).length, 3);
  assert.equal(all.find((a) => a.id === apt(1, 1)).status.lastVisit.reason, M.REASONS.NO_CASH);

  rec(second.id, apt(1, 1), { opened: true, moneyReceived: true, amount: 5 });
  assert.equal(M.apartmentStatus(s, area.id, apt(1, 1), second.id).current.amount, 5);
  assert.deepEqual(M.entranceStats(s, area.id, entrance.id), { total: 4, done: 3, open: 1, visited: 4 });
  assert.equal(M.apartmentHistory(s, area.id, apt(1, 1)).length, 2);
  assert.equal(M.areaProgress(s, area.id).collected, 15);
});

test('permanently skipped apartments stay out of new sessions without changing historical visits', () => {
  let { s, area, entrance, apt } = setup();
  let first;
  ({ state: s, session: first } = M.startSession(s, area.id, new Date('2026-11-01T10:00:00Z')));
  s = M.recordVisit(s, first.id, { entranceId: entrance.id, apartmentId: apt(0, 1), opened: false });
  s = M.endSession(s, first.id, new Date('2026-11-01T11:00:00Z'));
  s = M.updateApartmentSkip(s, area.id, entrance.id, apt(0, 1), true, ' Kein Interesse ');
  assert.equal(M.apartmentHistory(s, area.id, apt(0, 1)).length, 1);
  assert.equal(M.apartmentsForSession(s, first.id, entrance.id, { showDone: true }).some((a) => a.id === apt(0, 1)), true);
  let second;
  ({ state: s, session: second } = M.startSession(s, area.id, new Date('2026-11-08T10:00:00Z')));
  assert.equal(M.apartmentsForSession(s, second.id, entrance.id, { showDone: true }).some((a) => a.id === apt(0, 1)), false);
  assert.equal(M.sessionStats(M.findSession(s, second.id)).visited, 0);
  assert.throws(() => M.recordVisit(s, second.id, { entranceId: entrance.id, apartmentId: apt(0, 1), opened: false }), /übersprungen/);
  s = M.updateApartmentSkip(s, area.id, entrance.id, apt(0, 1), false, 'Kein Interesse');
  assert.equal(M.apartmentsForSession(s, second.id, entrance.id).some((a) => a.id === apt(0, 1)), true);
  s = M.recordVisit(s, second.id, { entranceId: entrance.id, apartmentId: apt(0, 1), opened: false });
  assert.equal(M.sessionStats(M.findSession(s, second.id)).notOpened, 1);
  assert.equal(M.apartmentHistory(s, area.id, apt(0, 1)).length, 2);
});

test('come-back reopens an apartment until a later final visit, including across sessions', () => {
  let { s, area, entrance, apt } = setup();
  const aptId = apt(0, 1);
  const recordSession = (day, result) => {
    let session;
    ({ state: s, session } = M.startSession(s, area.id, new Date(`2026-11-${day}T10:00:00Z`)));
    s = M.recordVisit(s, session.id, { entranceId: entrance.id, apartmentId: aptId, ...result }, new Date(`2026-11-${day}T10:10:00Z`));
    s = M.endSession(s, session.id, new Date(`2026-11-${day}T11:00:00Z`));
    return session;
  };
  recordSession('01', { opened: true, moneyReceived: true, amount: 5 });
  assert.equal(M.apartmentStatus(s, area.id, aptId).done, true);
  recordSession('02', { opened: true, moneyReceived: false, reason: M.REASONS.COME_BACK });
  assert.equal(M.apartmentStatus(s, area.id, aptId).done, false);
  assert.deepEqual(M.entranceCollectionStats(s, area.id, entrance.id), { total: 4, done: 0, skipped: 0, open: 4 });
  assert.deepEqual(M.overallApartmentStats(s), { total: 4, open: 3, revisit: 1, done: 0, skipped: 0 });
  let third;
  ({ state: s, session: third } = M.startSession(s, area.id, new Date('2026-11-03T10:00:00Z')));
  assert.ok(M.apartmentsForSession(s, third.id, entrance.id, { showDone: false }).some((item) => item.id === aptId));
  s = M.recordVisit(s, third.id, { entranceId: entrance.id, apartmentId: aptId, opened: false }, new Date('2026-11-03T10:10:00Z'));
  s = M.endSession(s, third.id, new Date('2026-11-03T11:00:00Z'));
  assert.equal(M.apartmentStatus(s, area.id, aptId).done, false);
  s = M.updateApartmentSkip(s, area.id, entrance.id, aptId, true, '');
  assert.deepEqual(M.overallApartmentStats(s), { total: 4, open: 3, revisit: 0, done: 0, skipped: 1 });
  s = M.updateApartmentSkip(s, area.id, entrance.id, aptId, false, '');
  recordSession('04', { opened: true, moneyReceived: false, reason: M.REASONS.NO_CASH });
  assert.equal(M.apartmentStatus(s, area.id, aptId).done, true);
  assert.deepEqual(M.overallApartmentStats(s), { total: 4, open: 3, revisit: 0, done: 1, skipped: 0 });
  assert.equal(M.apartmentHistory(s, area.id, aptId).length, 4);
  const withOffsets = structuredClone(s);
  withOffsets.sessions[1].visits[0].at = '2026-11-04T11:30:00+02:00';
  assert.equal(M.apartmentStatus(withOffsets, area.id, aptId).done, true, 'timestamps with offsets are ordered by actual time');
});

test('isVisitFinal rules', () => {
  assert.equal(M.isVisitFinal({ opened: false }), false);
  assert.equal(M.isVisitFinal({ opened: true, moneyReceived: true }), true);
  assert.equal(M.isVisitFinal({ opened: true, moneyReceived: false, reason: M.REASONS.NO_CASH }), true);
  assert.equal(M.isVisitFinal({ opened: true, moneyReceived: false, reason: M.REASONS.NO_WILL }), true);
  assert.equal(M.isVisitFinal({ opened: true, moneyReceived: false, reason: M.REASONS.COME_BACK }), false);
});
