import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';
import {
  createAdminConfig,
  emailHasAreaAccess,
  normalizeEmails,
  resetAdminPassword,
  verifyAdminPassword,
} from '../src/admin.js';

test('local email assignments are normalized, deduplicated and validated', () => {
  assert.deepEqual(normalizeEmails(' A@example.org; b@example.org, a@EXAMPLE.ORG '), ['a@example.org', 'b@example.org']);
  assert.equal(emailHasAreaAccess({ assignedEmails: ['Team@example.org'] }, ' team@EXAMPLE.org '), true);
  assert.equal(emailHasAreaAccess({ assignedEmails: ['team@example.org'] }, 'other@example.org'), false);
  assert.throws(() => normalizeEmails('not-an-email'), /Ungültige E-Mail-Adresse/);
});

test('local admin credentials can be verified and recovered with a one-time replacement code', async () => {
  const config = await createAdminConfig('anfangspasswort', 'CODE-ALT');
  assert.equal(await verifyAdminPassword(config, 'anfangspasswort'), true);
  assert.equal(await verifyAdminPassword(config, 'falsch'), false);

  const result = await resetAdminPassword(config, 'CODE-ALT', 'neuespasswort');
  assert.ok(result);
  assert.notEqual(result.recoveryCode, 'CODE-ALT');
  assert.equal(await verifyAdminPassword(result.config, 'neuespasswort'), true);
  assert.equal(await verifyAdminPassword(result.config, 'anfangspasswort'), false);
  assert.equal(await resetAdminPassword(result.config, 'CODE-ALT', 'anderespasswort'), null);
});

test('area statistics aggregate session amounts and the latest status of distinct apartments', () => {
  let state = M.emptyState();
  let area, otherArea, firstEntrance, secondEntrance, first, second, unrelated;
  ({ state, area } = M.addArea(state, { name: 'Nord' }));
  ({ state, area: otherArea } = M.addArea(state, { name: 'Süd' }));
  ({ state, entrance: firstEntrance } = M.addEntrance(state, area.id, { name: 'A', floors: 1, apartmentsPerFloor: 2 }));
  ({ state, entrance: secondEntrance } = M.addEntrance(state, area.id, { name: 'B', floors: 1, apartmentsPerFloor: 1 }));
  ({ state, session: first } = M.startSession(state, area.id, new Date('2026-11-24T10:00:00Z')));
  state = M.recordVisit(state, first.id, {
    entranceId: firstEntrance.id, apartmentId: firstEntrance.apartments[0].id, opened: true, moneyReceived: true, amount: 10,
  }, new Date('2026-11-24T10:05:00Z'));
  state = M.recordVisit(state, first.id, {
    entranceId: secondEntrance.id, apartmentId: secondEntrance.apartments[0].id, opened: false,
  }, new Date('2026-11-24T10:10:00Z'));
  state = M.setSessionAmount(state, first.id, 30);
  state = M.endSession(state, first.id, new Date('2026-11-24T10:30:00Z'));
  ({ state, session: second } = M.startSession(state, area.id, new Date('2026-11-24T11:00:00Z')));
  state = M.recordVisit(state, second.id, {
    entranceId: firstEntrance.id, apartmentId: firstEntrance.apartments[0].id, opened: false,
  }, new Date('2026-11-24T11:05:00Z'));
  state = M.recordVisit(state, second.id, {
    entranceId: firstEntrance.id, apartmentId: firstEntrance.apartments[1].id, opened: true, moneyReceived: true, amount: 15,
  }, new Date('2026-11-24T11:10:00Z'));
  ({ state, session: unrelated } = M.startSession(state, otherArea.id, new Date('2026-11-24T10:00:00Z')));
  state = M.setSessionAmount(state, unrelated.id, 1000);

  assert.deepEqual(M.areaStatistics(state, area.id, new Date('2026-11-24T11:15:00Z')), {
    durationMinutes: 45,
    opened: 1,
    notOpened: 2,
    visited: 3,
    collected: 45,
    averagePerVisited: 15,
  });
  assert.equal(M.areaStatistics(state, area.id, new Date('2026-11-24T11:20:00Z')).durationMinutes, 50);
  assert.deepEqual(M.areaStatistics(state, otherArea.id, new Date('2026-11-24T09:00:00Z')), {
    durationMinutes: 0,
    opened: 0,
    notOpened: 0,
    visited: 0,
    collected: 1000,
    averagePerVisited: null,
  });
});
