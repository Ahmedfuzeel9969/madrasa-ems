import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PROJECT_ID = 'demo-shared-portal-rules';
const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeEmulator('Shared portal Firestore session boundary', { timeout: 30000 }, function () {
  let testEnv;

  beforeAll(async function () {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }
    });
  }, 60000);

  afterAll(async function () {
    if (testEnv) await testEnv.cleanup();
  }, 30000);

  beforeEach(async function () {
    await testEnv.clearFirestore();
  });

  function sharedDb(overrides = {}) {
    return testEnv.authenticatedContext(overrides.uid || 'spg_teacher_1', {
      roles: [],
      sharedPortal: true,
      emsSharedPortalPrincipal: true,
      tenantId: overrides.tenantId || 'tenant-a',
      portal: overrides.portal || 'teacher',
      portalRole: overrides.portal || 'teacher',
      principalId: overrides.personId || 'TCH-1',
      personId: overrides.personId || 'TCH-1',
      sessionId: overrides.sessionId || 'session-1',
      portalSessionId: overrides.sessionId || 'session-1',
      sessionVersion: overrides.revision ?? 3,
      gatewayConfigRevision: overrides.revision ?? 3,
      sessionExpiresAtMs: overrides.tokenExpiresAtMs || Date.now() + 600000
    }).firestore();
  }

  async function seedTeacher(options = {}) {
    const tenantId = options.tenantId || 'tenant-a';
    const uid = options.uid || 'spg_teacher_1';
    const personId = options.personId || 'TCH-1';
    const sessionId = options.sessionId || 'session-1';
    const revision = options.revision ?? 3;
    const expiresAtMs = options.expiresAtMs || Date.now() + 600000;
    await testEnv.withSecurityRulesDisabled(async function (context) {
      const db = context.firestore();
      await setDoc(doc(db, 'All_Madrasas', tenantId), {
        madrasaName: tenantId,
        email: tenantId + '@rules.test',
        ownerUid: tenantId,
        subStatus: 'active'
      });
      await setDoc(doc(db, 'All_Madrasas', tenantId, 'TenantSettings', 'sharedPortalGateway'), {
        enabled: true,
        revision: revision,
        portals: { teacher: { enabled: true }, parent: { enabled: true }, student: { enabled: false } }
      });
      await setDoc(doc(db, 'All_Madrasas', tenantId, 'SharedPortalSessions', sessionId), {
        status: options.status || 'active',
        syntheticUid: uid,
        portal: 'teacher',
        personId: personId,
        gatewayConfigRevision: revision,
        expiresAtMs: expiresAtMs
      });
      await setDoc(doc(db, 'All_Madrasas', tenantId, 'Staff_Links', uid), {
        authUid: uid,
        status: 'active',
        identityMode: 'shared_gateway',
        portalRole: 'teacher',
        staffId: personId,
        personId: personId,
        sessionId: sessionId,
        gatewayConfigRevision: revision,
        sessionExpiresAtMs: expiresAtMs
      });
      await setDoc(doc(db, 'All_Madrasas', tenantId, 'StaffPermissions', personId), {
        status: 'active',
        modules: { attendance: true },
        actions: { attendance: {
          view: options.view !== false,
          create: options.create === true,
          edit: options.edit === true,
          delete: options.delete === true
        } },
        temporary: {}
      });
      await setDoc(doc(db, 'All_Madrasas', tenantId, 'Attendance', 'att_rec_2026-09_teachers_all_all'), {
        locked: false,
        records: {}, dailyLocks: {}, remarks: {}, late: {}, periodRecords: {},
        clearedCells: { days: {}, periods: {} }, canonicalComplete: false,
        timestamp: Date.now(), clientUpdatedAt: Date.now(), _version: 1
      });
      await setDoc(doc(db, 'SharedPortalGatewayDirectory', 'hidden-email-hash'), {
        tenantId: tenantId, status: 'active', roles: ['teacher']
      });
    });
    return { tenantId, uid, personId, sessionId, revision };
  }

  it('allows only a fully matching, active, unexpired teacher session', async function () {
    const seeded = await seedTeacher();
    await assertSucceeds(getDoc(doc(
      sharedDb(seeded), 'All_Madrasas', seeded.tenantId,
      'Attendance', 'att_rec_2026-09_teachers_all_all'
    )));
  });

  it('denies a teacher permission explicitly marked disabled', async function () {
    const seeded = await seedTeacher();
    await testEnv.withSecurityRulesDisabled(async function (context) {
      await updateDoc(doc(
        context.firestore(), 'All_Madrasas', seeded.tenantId,
        'StaffPermissions', seeded.personId
      ), { status: 'disabled' });
    });
    await assertFails(getDoc(doc(
      sharedDb(seeded), 'All_Madrasas', seeded.tenantId,
      'Attendance', 'att_rec_2026-09_teachers_all_all'
    )));
  });

  it('denies wrong person, wrong tenant, revoked, expired, and revision-mismatched sessions', async function () {
    const seeded = await seedTeacher();
    const refParts = ['All_Madrasas', seeded.tenantId, 'Attendance', 'att_rec_2026-09_teachers_all_all'];
    await assertFails(getDoc(doc(sharedDb({ ...seeded, personId: 'TCH-2' }), ...refParts)));
    await assertFails(getDoc(doc(sharedDb({ ...seeded, tenantId: 'tenant-b' }), ...refParts)));
    await assertFails(getDoc(doc(sharedDb({ ...seeded, revision: 4 }), ...refParts)));
    await assertFails(getDoc(doc(sharedDb({ ...seeded, tokenExpiresAtMs: Date.now() - 1000 }), ...refParts)));

    await testEnv.withSecurityRulesDisabled(async function (context) {
      const db = context.firestore();
      const permissionRef = doc(
        db, 'All_Madrasas', seeded.tenantId, 'StaffPermissions', seeded.personId
      );
      await updateDoc(permissionRef, { status: 'suspended' });
    });
    await assertFails(getDoc(doc(sharedDb(seeded), ...refParts)));
    await testEnv.withSecurityRulesDisabled(async function (context) {
      const db = context.firestore();
      await updateDoc(doc(
        db, 'All_Madrasas', seeded.tenantId, 'StaffPermissions', seeded.personId
      ), { status: 'active' });
      await setDoc(doc(
        db, 'All_Madrasas', seeded.tenantId, 'SecuritySettings', 'mfa'
      ), { requireMfaForStaff: true });
    });
    await assertFails(getDoc(doc(sharedDb(seeded), ...refParts)));
    await testEnv.withSecurityRulesDisabled(async function (context) {
      const db = context.firestore();
      await setDoc(doc(
        db, 'All_Madrasas', seeded.tenantId, 'SecuritySettings', 'mfa'
      ), { requireMfaForStaff: false });
      await updateDoc(doc(
        db, 'All_Madrasas', seeded.tenantId,
        'SharedPortalSessions', seeded.sessionId
      ), { status: 'revoked' });
    });
    await assertFails(getDoc(doc(sharedDb(seeded), ...refParts)));
  });

  it('keeps gateway directory and owner-only configuration hidden from the principal', async function () {
    const seeded = await seedTeacher();
    const db = sharedDb(seeded);
    await assertFails(getDoc(doc(db, 'SharedPortalGatewayDirectory', 'hidden-email-hash')));
    await assertFails(getDoc(doc(
      db, 'All_Madrasas', seeded.tenantId, 'TenantSettings', 'sharedPortalGateway'
    )));
    await assertSucceeds(getDoc(doc(
      testEnv.authenticatedContext(seeded.tenantId, { roles: [] }).firestore(),
      'All_Madrasas', seeded.tenantId, 'TenantSettings', 'sharedPortalGateway'
    )));
  });

  it('does not let an attendance-only teacher read dashboard, exams, module blobs, or wildcard data', async function () {
    const seeded = await seedTeacher();
    await testEnv.withSecurityRulesDisabled(async function (context) {
      const db = context.firestore();
      await setDoc(doc(db, 'All_Madrasas', seeded.tenantId, 'DashboardStats', 'main'), { total: 10 });
      await setDoc(doc(db, 'All_Madrasas', seeded.tenantId, 'ExamResults', 'EX-1'), { marks: 90 });
      await setDoc(doc(db, 'All_Madrasas', seeded.tenantId, 'ModuleData', 'Exams__ems_exam_types'), { data: [] });
      await setDoc(doc(db, 'All_Madrasas', seeded.tenantId, 'UnknownPrivate', 'doc-1'), { secret: true });
    });
    const db = sharedDb(seeded);
    const tenant = ['All_Madrasas', seeded.tenantId];
    await assertFails(getDoc(doc(db, ...tenant, 'DashboardStats', 'main')));
    await assertFails(getDoc(doc(db, ...tenant, 'ExamResults', 'EX-1')));
    await assertFails(getDoc(doc(db, ...tenant, 'ModuleData', 'Exams__ems_exam_types')));
    await assertFails(getDoc(doc(db, ...tenant, 'UnknownPrivate', 'doc-1')));

    await testEnv.withSecurityRulesDisabled(async function (context) {
      await updateDoc(doc(
        context.firestore(), 'All_Madrasas', seeded.tenantId,
        'StaffPermissions', seeded.personId
      ), {
        modules: { attendance: true, dashboard: true, exams: true },
        actions: {
          attendance: { view: true, create: false, edit: false, delete: false },
          dashboard: { view: true },
          exams: { view: true }
        }
      });
    });
    await assertSucceeds(getDoc(doc(db, ...tenant, 'DashboardStats', 'main')));
    await assertSucceeds(getDoc(doc(db, ...tenant, 'ExamResults', 'EX-1')));
    await assertSucceeds(getDoc(doc(db, ...tenant, 'ModuleData', 'Exams__ems_exam_types')));
    await assertFails(getDoc(doc(db, ...tenant, 'UnknownPrivate', 'doc-1')));
  });

  it('allows attendance writes only when the exact teacher action is granted', async function () {
    const seeded = await seedTeacher({ create: true, edit: true, delete: true });
    const db = sharedDb(seeded);
    const newRef = doc(
      db, 'All_Madrasas', seeded.tenantId,
      'Attendance', 'att_rec_2026-10_students_all_all'
    );
    await assertSucceeds(setDoc(newRef, {
      locked: false,
      records: { 'STD-1': { '1': 'P' } },
      dailyLocks: {}, remarks: {}, late: {}, periodRecords: {},
      clearedCells: { days: {}, periods: {} }, canonicalComplete: false,
      timestamp: Date.now(), clientUpdatedAt: Date.now(), _version: 1
    }));

    const existingRef = doc(
      db, 'All_Madrasas', seeded.tenantId,
      'Attendance', 'att_rec_2026-09_teachers_all_all'
    );
    await assertSucceeds(updateDoc(existingRef, {
      records: { 'TCH-2': { '1': 'P' } },
      clientUpdatedAt: Date.now()
    }));
    await assertSucceeds(deleteDoc(existingRef));

    await testEnv.clearFirestore();
    const denied = await seedTeacher();
    const deniedDb = sharedDb(denied);
    await assertFails(setDoc(doc(
      deniedDb, 'All_Madrasas', denied.tenantId,
      'Attendance', 'att_rec_2026-10_students_all_all'
    ), {
      locked: false,
      records: { 'STD-1': { '1': 'P' } },
      dailyLocks: {}, remarks: {}, late: {}, periodRecords: {},
      clearedCells: { days: {}, periods: {} }, canonicalComplete: false,
      timestamp: Date.now(), clientUpdatedAt: Date.now(), _version: 1
    }));
    const deniedExistingRef = doc(
      deniedDb, 'All_Madrasas', denied.tenantId,
      'Attendance', 'att_rec_2026-09_teachers_all_all'
    );
    await assertFails(updateDoc(deniedExistingRef, { clientUpdatedAt: Date.now() }));
    await assertFails(deleteDoc(deniedExistingRef));
  });
});
