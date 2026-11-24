import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';

function setup() {
  let s = M.emptyState();
  let area;
  ({ state: s, area } = M.addArea(s, { name: 'Nord', targetAmount: '200', previousYearAmount: 150 }));
  let entrance;
  ({ state: s, entrance } = M.addEntrance(s, area.id, { name: 'Haus 1', address: 'Weg 1', floors: 3, apartmentsPerFloor: 2 }));
  return { s, area, entrance };
}

test('normalizeApartmentsPerFloor accepts single value, list string and array', () => {
  assert.deepEqual(M.normalizeApartmentsPerFloor(3, 2), [2, 2, 2]);
  assert.deepEqual(M.normalizeApartmentsPerFloor(3, '1, 2;3'), [1, 2, 3]);
  assert.deepEqual(M.normalizeApartmentsPerFloor(2, [0, 4]), [0, 4]);
});

test('normalizeApartmentsPerFloor rejects invalid input', () => {
  assert.throws(() => M.normalizeApartmentsPerFloor(0, 2), /Stockwerkanzahl/);
  assert.throws(() => M.normalizeApartmentsPerFloor(2.5, 2), /Stockwerkanzahl/);
  assert.throws(() => M.normalizeApartmentsPerFloor(3, '1,2'), /3 Werte/);
  assert.throws(() => M.normalizeApartmentsPerFloor(2, 'x'), /ganze Zahlen/);
  assert.throws(() => M.normalizeApartmentsPerFloor(2, -1), /ganze Zahlen/);
});

test('generateApartments creates deterministic apartments per floor', () => {
  const apts = M.generateApartments('e1', 3, '1,2,2');
  assert.equal(apts.length, 5);
  assert.deepEqual(apts[0], { id: 'e1:0:1', floor: 0, index: 1, label: 'EG · Whg. 1' });
  assert.equal(apts[4].id, 'e1:2:2');
  assert.equal(apts[4].label, '2. OG · Whg. 2');
  assert.deepEqual(M.generateApartments('e1', 3, '1,2,2'), apts);
});

test('groupByFloor groups and sorts apartments', () => {
  const groups = M.groupByFloor(M.generateApartments('e', 2, 3).reverse());
  assert.deepEqual(groups.map((g) => g.label), ['EG', '1. OG']);
  assert.deepEqual(groups[0].apartments.map((a) => a.index), [1, 2, 3]);
});

test('area CRUD with validation', () => {
  const { s, area } = setup();
  assert.equal(area.targetAmount, 200);
  assert.throws(() => M.addArea(s, { name: '  ' }), /darf nicht leer/);
  const s2 = M.updateArea(s, area.id, { name: 'Nord-Ost', targetAmount: '250,50' });
  assert.equal(M.findArea(s2, area.id).name, 'Nord-Ost');
  assert.equal(M.findArea(s2, area.id).targetAmount, 250.5);
  const { state: s3 } = M.startSession(s2, area.id);
  const s4 = M.deleteArea(s3, area.id);
  assert.equal(s4.areas.length, 0);
  assert.equal(s4.sessions.length, 0, 'sessions of deleted area are removed');
});

test('entrance creation generates apartment list; editing keeps existing apartment ids and history', () => {
  let { s, area, entrance } = setup();
  assert.equal(entrance.apartments.length, 6);
  let session;
  ({ state: s, session } = M.startSession(s, area.id));
  s = M.recordVisit(s, session.id, { entranceId: entrance.id, apartmentId: `${entrance.id}:0:1`, opened: false });
  s = M.recordVisit(s, session.id, { entranceId: entrance.id, apartmentId: `${entrance.id}:2:2`, opened: false });

  s = M.updateEntrance(s, area.id, entrance.id, { floors: 2, apartmentsPerFloor: '2,3' });
  const updated = M.findEntrance(s, area.id, entrance.id);
  assert.equal(updated.apartments.length, 5);
  assert.equal(updated.name, 'Haus 1');
  const visits = M.findSession(s, session.id).visits;
  assert.deepEqual(visits.map((v) => v.apartmentId), [`${entrance.id}:0:1`], 'visit of removed apartment dropped');

  s = M.deleteEntrance(s, area.id, entrance.id);
  assert.equal(M.findArea(s, area.id).entrances.length, 0);
  assert.equal(M.findSession(s, session.id).visits.length, 0);
});

test('validateVisit enforces the status rules', () => {
  assert.deepEqual(M.validateVisit({ opened: false, moneyReceived: true, amount: 5 }), {
    opened: false, moneyReceived: null, amount: null, reason: null,
  });
  assert.deepEqual(M.validateVisit({ opened: true, moneyReceived: true, amount: '5,5' }), {
    opened: true, moneyReceived: true, amount: 5.5, reason: null,
  });
  assert.equal(M.validateVisit({ opened: true, moneyReceived: true }).amount, null, 'amount optional');
  assert.equal(M.validateVisit({ opened: true, moneyReceived: false, reason: 'no-cash' }).reason, 'no-cash');
  assert.throws(() => M.validateVisit({ opened: true, moneyReceived: false }), /Grund/);
  assert.throws(() => M.validateVisit({ opened: true }), /Geld erhalten/);
  assert.throws(() => M.validateVisit({}), /geöffnet/);
});

test('computeProgress: percent, remaining and success state', () => {
  assert.deepEqual(M.computeProgress(50, 200), {
    collected: 50, goal: 200, percent: 25, barPercent: 25, remaining: 150, surplus: 0, success: false, level: 'progress',
  });
  const over = M.computeProgress(250, 200);
  assert.equal(over.percent, 125);
  assert.equal(over.barPercent, 100);
  assert.equal(over.remaining, 0);
  assert.equal(over.surplus, 50);
  assert.equal(over.success, true);
  assert.equal(over.level, 'success');
  assert.equal(M.computeProgress(10, 0).level, 'no-goal');
  assert.equal(M.computeProgress(10, 0).success, false);
  assert.equal(M.computeProgress(160, 200).level, 'almost');
  assert.equal(M.computeProgress(1, 3).percent, 33.3);
  assert.equal(M.computeProgress(0.1 + 0.2, 1).collected, 0.3);
});

test('areaGoal falls back to previous year amount', () => {
  assert.equal(M.areaGoal({ targetAmount: 0, previousYearAmount: 120 }), 120);
  assert.equal(M.areaGoal({ targetAmount: 90, previousYearAmount: 120 }), 90);
});

test('areaProgress and overallProgress sum session amounts', () => {
  let { s, area, entrance } = setup();
  let session;
  ({ state: s, session } = M.startSession(s, area.id));
  s = M.recordVisit(s, session.id, { entranceId: entrance.id, apartmentId: entrance.apartments[0].id, opened: true, moneyReceived: true, amount: 20 });
  s = M.recordVisit(s, session.id, { entranceId: entrance.id, apartmentId: entrance.apartments[1].id, opened: true, moneyReceived: true, amount: '10,5' });
  assert.equal(M.areaProgress(s, area.id).collected, 30.5);

  s = M.setSessionAmount(s, session.id, '100');
  const p = M.areaProgress(s, area.id);
  assert.equal(p.collected, 100, 'manual Ist-Betrag overrides sum');
  assert.equal(p.percent, 50);
  assert.equal(p.remaining, 100);

  let other;
  ({ state: s, area: other } = M.addArea(s, { name: 'Süd', previousYearAmount: 100 }));
  assert.equal(M.overallProgress(s).goal, 300);
  assert.equal(M.overallProgress(s).collected, 100);
  assert.equal(M.areaProgress(s, other.id).collected, 0);

  s = M.setSessionAmount(s, session.id, '');
  assert.equal(M.areaProgress(s, area.id).collected, 30.5, 'clearing manual amount falls back to sum');
});
