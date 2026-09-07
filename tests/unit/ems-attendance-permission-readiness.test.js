import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const audit = require('../../scripts/audit-attendance-permission-readiness');

function fakeSnap(rows) {
  return {
    docs: rows.map(function (row) {
      return { id: row.id, data: function () { return row.data; } };
    }),
    forEach: function (handler) { this.docs.forEach(handler); }
  };
}

describe('Attendance strict-RBAC pre-deploy readiness', function () {
  it('flags legacy module permission without explicit view', function () {
    var links = fakeSnap([{ id: 'auth-1', data: { status: 'active', staffId: 'TCH-1' } }]);
    var permissions = fakeSnap([{
      id: 'TCH-1',
      data: { status: 'active', modules: { attendance: true }, actions: { attendance: {} }, temporary: {} }
    }]);
    var result = audit.summarizePermissionReadiness(links, permissions);
    expect(result.activeStaffLinks).toBe(1);
    expect(result.legacyModuleWithoutView).toBe(1);
    expect(result.wouldLoseAttendanceRead).toBe(1);
  });

  it('accepts explicit or active temporary view grants', function () {
    var links = fakeSnap([
      { id: 'auth-1', data: { status: 'active', staffId: 'TCH-1' } },
      { id: 'auth-2', data: { status: 'active', staffId: 'TCH-2' } }
    ]);
    var permissions = fakeSnap([
      {
        id: 'TCH-1',
        data: { status: 'active', modules: { attendance: true }, actions: { attendance: { view: true } }, temporary: {} }
      },
      {
        id: 'TCH-2',
        data: {
          status: 'active', modules: {}, actions: {},
          temporary: { 'attendance.view': { expiryAt: Date.now() + 60000 } }
        }
      }
    ]);
    var result = audit.summarizePermissionReadiness(links, permissions);
    expect(result.explicitAttendanceView).toBe(2);
    expect(result.wouldLoseAttendanceRead).toBe(0);
  });

  it('ignores inactive staff links and reports missing active permissions', function () {
    var links = fakeSnap([
      { id: 'inactive', data: { status: 'inactive', staffId: 'TCH-1' } },
      { id: 'active', data: { status: 'active', staffId: 'TCH-2' } }
    ]);
    var result = audit.summarizePermissionReadiness(links, fakeSnap([]));
    expect(result.activeStaffLinks).toBe(1);
    expect(result.missingPermissionRecord).toBe(1);
    expect(result.wouldLoseAttendanceRead).toBe(1);
  });
});
