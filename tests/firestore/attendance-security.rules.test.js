import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, runTransaction, setDoc, updateDoc } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PROJECT_ID = 'attendance-rules-audit';
const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

function attendancePayload(extra = {}) {
  return {
    locked: false,
    records: {},
    dailyLocks: {},
    remarks: {},
    late: {},
    periodRecords: {},
    clearedCells: { days: {}, periods: {} },
    canonicalComplete: false,
    timestamp: 1788237000000,
    clientUpdatedAt: 1788237000000,
    _version: 1,
    ...extra
  };
}

describeEmulator('Attendance Firestore rules — real emulator boundary', function () {
  let testEnv;

  beforeAll(async function () {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8')
      }
    });
  }, 60000);

  afterAll(async function () {
    if (testEnv) await testEnv.cleanup();
  }, 30000);

  beforeEach(async function () {
    await testEnv.clearFirestore();
  });

  function userDb(uid) {
    return testEnv.authenticatedContext(uid, {
      email: uid + '@rules.test',
      roles: []
    }).firestore();
  }

  async function seedTenant(options = {}) {
    const tenantId = options.tenantId || 'tenant-a';
    const staffUid = options.staffUid || 'staff-a';
    const staffId = options.staffId || 'TCH-1';
    const actions = {
      view: options.view !== false,
      create: options.create === true,
      edit: options.edit === true,
      delete: options.delete === true
    };
    await testEnv.withSecurityRulesDisabled(async function (context) {
      const db = context.firestore();
      await setDoc(doc(db, 'All_Madrasas', tenantId), {
        madrasaName: tenantId,
        email: tenantId + '@rules.test',
        subStatus: options.suspended ? 'suspended' : 'active'
      });
      await setDoc(doc(db, 'All_Madrasas', tenantId, 'Staff_Links', staffUid), {
        status: 'active',
        staffId: staffId
      });
      await setDoc(doc(db, 'All_Madrasas', tenantId, 'StaffPermissions', staffId), {
        status: 'active',
        modules: { attendance: true },
        actions: { attendance: actions },
        temporary: {}
      });
      await setDoc(
        doc(db, 'All_Madrasas', tenantId, 'Attendance', 'att_rec_2026-09_students_Class-A_all'),
        attendancePayload({ locked: options.locked === true, departmentId: 'boys_dars' })
      );
    });
    return { tenantId, staffUid, staffId };
  }

  it('allows the owner and attendance-view staff to read their tenant register', async function () {
    const seeded = await seedTenant({ view: true });
    const pathParts = ['All_Madrasas', seeded.tenantId, 'Attendance', 'att_rec_2026-09_students_Class-A_all'];
    await assertSucceeds(getDoc(doc(userDb(seeded.tenantId), ...pathParts)));
    await assertSucceeds(getDoc(doc(userDb(seeded.staffUid), ...pathParts)));
  });

  it('denies same-tenant staff without attendance.view', async function () {
    const seeded = await seedTenant({ view: false });
    await assertFails(getDoc(doc(
      userDb(seeded.staffUid),
      'All_Madrasas', seeded.tenantId, 'Attendance', 'att_rec_2026-09_students_Class-A_all'
    )));
  });

  it('denies ordinary staff after its permission is marked disabled', async function () {
    const seeded = await seedTenant({ view: true });
    await testEnv.withSecurityRulesDisabled(async function (context) {
      await updateDoc(doc(
        context.firestore(), 'All_Madrasas', seeded.tenantId,
        'StaffPermissions', seeded.staffId
      ), { status: 'disabled' });
    });
    await assertFails(getDoc(doc(
      userDb(seeded.staffUid),
      'All_Madrasas', seeded.tenantId, 'Attendance', 'att_rec_2026-09_students_Class-A_all'
    )));
  });

  it('denies a valid staff user from a different tenant', async function () {
    await seedTenant({ tenantId: 'tenant-a', staffUid: 'staff-a', view: true });
    await seedTenant({ tenantId: 'tenant-b', staffUid: 'staff-b', view: true });
    await assertFails(getDoc(doc(
      userDb('staff-b'),
      'All_Madrasas', 'tenant-a', 'Attendance', 'att_rec_2026-09_students_Class-A_all'
    )));
  });

  it('denies attendance reads after the tenant is suspended', async function () {
    const seeded = await seedTenant({ view: true, suspended: true });
    await assertFails(getDoc(doc(
      userDb(seeded.staffUid),
      'All_Madrasas', seeded.tenantId, 'Attendance', 'att_rec_2026-09_students_Class-A_all'
    )));
  });

  it('enforces create, edit, and delete as separate permissions', async function () {
    const viewer = await seedTenant({ tenantId: 'tenant-view', staffUid: 'staff-view', view: true });
    const creator = await seedTenant({ tenantId: 'tenant-create', staffUid: 'staff-create', view: true, create: true });
    const editor = await seedTenant({ tenantId: 'tenant-edit', staffUid: 'staff-edit', view: true, edit: true });
    const deleter = await seedTenant({ tenantId: 'tenant-delete', staffUid: 'staff-delete', view: true, delete: true });

    await assertFails(setDoc(doc(
      userDb(viewer.staffUid), 'All_Madrasas', viewer.tenantId, 'Attendance',
      'att_rec_2026-10_students_Class-A_all'
    ), attendancePayload()));
    await assertSucceeds(setDoc(doc(
      userDb(creator.staffUid), 'All_Madrasas', creator.tenantId, 'Attendance',
      'att_rec_2026-10_students_Class-A_all'
    ), attendancePayload()));
    await assertSucceeds(updateDoc(doc(
      userDb(editor.staffUid), 'All_Madrasas', editor.tenantId, 'Attendance',
      'att_rec_2026-09_students_Class-A_all'
    ), { 'records.S1.1': 'P', clientUpdatedAt: 1788237000001 }));
    await assertSucceeds(deleteDoc(doc(
      userDb(deleter.staffUid), 'All_Madrasas', deleter.tenantId, 'Attendance',
      'att_rec_2026-09_students_Class-A_all'
    )));
  });

  it('preserves two concurrent granular attendance updates in one register', async function () {
    const seeded = await seedTenant({ view: true, edit: true });
    const dbA = userDb(seeded.staffUid);
    const dbB = userDb(seeded.staffUid);
    const refA = doc(
      dbA, 'All_Madrasas', seeded.tenantId, 'Attendance',
      'att_rec_2026-09_students_Class-A_all'
    );
    const refB = doc(
      dbB, 'All_Madrasas', seeded.tenantId, 'Attendance',
      'att_rec_2026-09_students_Class-A_all'
    );

    function patchCell(db, ref, fieldPath, mark) {
      return runTransaction(db, async function (tx) {
        const snap = await tx.get(ref);
        const version = Number((snap.data() || {})._version || 0) + 1;
        tx.update(ref, {
          [fieldPath]: mark,
          _version: version,
          clientUpdatedAt: 1788237000100
        });
      });
    }

    await Promise.all([
      patchCell(dbA, refA, 'records.S1.1', 'P'),
      patchCell(dbB, refB, 'records.S2.1', 'A')
    ]);

    const saved = await getDoc(doc(
      userDb(seeded.tenantId), 'All_Madrasas', seeded.tenantId, 'Attendance',
      'att_rec_2026-09_students_Class-A_all'
    ));
    expect(saved.data().records.S1['1']).toBe('P');
    expect(saved.data().records.S2['1']).toBe('A');
    expect(saved.data()._version).toBe(3);
  });

  it('blocks ordinary staff edits and deletes while a register is locked', async function () {
    const seeded = await seedTenant({ view: true, edit: true, delete: true, locked: true });
    const ref = doc(
      userDb(seeded.staffUid),
      'All_Madrasas', seeded.tenantId, 'Attendance', 'att_rec_2026-09_students_Class-A_all'
    );
    await assertFails(updateDoc(ref, { 'records.S1.1': 'P', clientUpdatedAt: 1788237000001 }));
    await assertFails(deleteDoc(ref));
    await assertSucceeds(updateDoc(doc(
      userDb(seeded.tenantId),
      'All_Madrasas', seeded.tenantId, 'Attendance', 'att_rec_2026-09_students_Class-A_all'
    ), { locked: false, clientUpdatedAt: 1788237000002 }));
  });

  it('permits Attendance ModuleData only through attendance permissions', async function () {
    const allowed = await seedTenant({ tenantId: 'tenant-allowed', staffUid: 'staff-allowed', view: true, create: true });
    const denied = await seedTenant({ tenantId: 'tenant-denied', staffUid: 'staff-denied', view: false, create: true });
    await testEnv.withSecurityRulesDisabled(async function (context) {
      await setDoc(doc(
        context.firestore(), 'All_Madrasas', allowed.tenantId, 'ModuleData', 'Attendance__ems_att_periods'
      ), { module: 'Attendance', key: 'ems_att_periods', data: '[]' });
      await setDoc(doc(
        context.firestore(), 'All_Madrasas', denied.tenantId, 'ModuleData', 'Attendance__ems_att_periods'
      ), { module: 'Attendance', key: 'ems_att_periods', data: '[]' });
    });
    await assertSucceeds(getDoc(doc(
      userDb(allowed.staffUid), 'All_Madrasas', allowed.tenantId, 'ModuleData', 'Attendance__ems_att_periods'
    )));
    await assertFails(getDoc(doc(
      userDb(denied.staffUid), 'All_Madrasas', denied.tenantId, 'ModuleData', 'Attendance__ems_att_periods'
    )));
    await assertSucceeds(setDoc(doc(
      userDb(allowed.staffUid), 'All_Madrasas', allowed.tenantId, 'ModuleData', 'Attendance__ems_att_symbols'
    ), { module: 'Attendance', key: 'ems_att_symbols', data: '{}' }));
  });

  it('rejects malformed register IDs and unexpected top-level fields', async function () {
    const seeded = await seedTenant({ create: true, view: true });
    const db = userDb(seeded.staffUid);
    await assertFails(setDoc(doc(
      db, 'All_Madrasas', seeded.tenantId, 'Attendance', 'wrong-document-id'
    ), attendancePayload()));
    await assertFails(setDoc(doc(
      db, 'All_Madrasas', seeded.tenantId, 'Attendance', 'att_rec_2026-10_students_Class-A_all'
    ), attendancePayload({ injected: true })));
  });

  it('keeps tenant data unchanged throughout the rules test fixture', async function () {
    const seeded = await seedTenant({ view: true });
    const snap = await assertSucceeds(getDoc(doc(
      userDb(seeded.tenantId),
      'All_Madrasas', seeded.tenantId, 'Attendance', 'att_rec_2026-09_students_Class-A_all'
    )));
    expect(snap.data().records).toEqual({});
  });
});
