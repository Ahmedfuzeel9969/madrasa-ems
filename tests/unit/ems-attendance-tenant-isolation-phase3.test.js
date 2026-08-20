import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadOfflineAttendanceTenantHelpers() {
    var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
    var start = src.indexOf('function getVerifiedAttendanceTenantId');
    var end = src.indexOf('\n    global.emsGetVerifiedAttendanceTenantId');
    var normStart = src.indexOf('function attOfflineNormalizeScope');
    var normEnd = src.indexOf('\n    global.emsAttCloudDocId');
    var keyStart = src.indexOf('global.emsAttLocalStorageKey = function');
    var keyEnd = src.indexOf('\n    global.emsAttResolveLocalKey');
    var sandbox = {
        global: {},
        firebase: {
            auth: function () {
                return { currentUser: { uid: 'linked-teacher-auth-uid' } };
            }
        }
    };
    sandbox.global = sandbox;
    vm.runInNewContext(
        'function getTenantId(){ return null; }\n'
        + src.slice(start, end + '\n    global.emsGetVerifiedAttendanceTenantId = getVerifiedAttendanceTenantId;'.length)
        + '\n' + src.slice(normStart, normEnd)
        + '\n' + src.slice(keyStart, keyEnd)
        + '\nthis.getVerifiedAttendanceTenantId = getVerifiedAttendanceTenantId;'
        + '\nthis.emsAttLocalStorageKey = global.emsAttLocalStorageKey;'
        + '\nthis.attOfflineNormalizeScope = attOfflineNormalizeScope;',
        sandbox
    );
    return sandbox;
}

describe('Phase 3 — verified madrasa tenant for attendance (TASK 3.1)', function () {
    it('attendance.js getAttendanceTenantId never falls back to auth.uid', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var block = js.slice(js.indexOf('function getAttendanceTenantId'), js.indexOf('\nfunction attNormalizeStorageScope'));
        expect(block).toContain('emsGetTenantId');
        expect(block).toContain('fail closed');
        expect(block).not.toMatch(/currentUser\.uid/);
        expect(block).not.toMatch(/firebase\.auth\(\)/);
    });

    it('ems-offline-write exposes getVerifiedAttendanceTenantId without auth.uid fallback', function () {
        var js = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(js).toContain('function getVerifiedAttendanceTenantId');
        expect(js).toContain('global.emsGetVerifiedAttendanceTenantId');
        var block = js.slice(js.indexOf('function getVerifiedAttendanceTenantId'), js.indexOf('global.emsGetVerifiedAttendanceTenantId'));
        expect(block).not.toMatch(/currentUser\.uid/);
    });

    it('attendance-helper getTenantId never substitutes personal auth uid', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        var block = js.slice(js.indexOf('function getTenantId'), js.indexOf('\n    function getDb'));
        expect(block).toContain('emsGetTenantId');
        expect(block).not.toMatch(/firebase\.auth/);
        expect(block).not.toMatch(/currentUser\.uid/);
    });

    it('emsOfflinePersistAttendance fails closed without verified tenant', function () {
        var js = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        var block = js.slice(js.indexOf('global.emsOfflinePersistAttendance'), js.indexOf('global.emsOfflinePersistRegistration'));
        expect(block).toMatch(/getVerifiedAttendanceTenantId\(\)/);
        expect(block).toMatch(/reason: 'no_tenant'/);
    });

    it('attendance cloud pull helper refuses local key remap without tenant', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        var start = js.indexOf('function attLocalKeyFromCloudDocId');
        var end = js.indexOf('\n    global.emsPullAttendanceFromCloud', start);
        var block = js.slice(start, end);
        expect(block).not.toContain("'local'");
        expect(block).toMatch(/if \(!tid\) return null/);
    });
});

describe('Phase 3 — tenant isolation scenarios (TASK 3.2)', function () {
    it('owner: auth uid may equal madrasa tenant and keys use that tenant', function () {
        var sb = loadOfflineAttendanceTenantHelpers();
        sb.global.emsGetTenantId = function () { return 'owner-madrasa-uid'; };
        sb.global.CURRENT_MADRASA_TENANT_ID = 'owner-madrasa-uid';
        var key = sb.emsAttLocalStorageKey('owner-madrasa-uid', '2026-08', 'teachers', '', 'all');
        expect(key).toBe('att_rec_owner-madrasa-uid_2026-08_teachers__all');
    });

    it('linked teacher: auth uid differs but attendance keys use madrasa tenant', function () {
        var sb = loadOfflineAttendanceTenantHelpers();
        sb.global.emsGetTenantId = function () { return 'madrasa-tenant-abc'; };
        sb.global.CURRENT_MADRASA_TENANT_ID = 'madrasa-tenant-abc';
        expect(sb.getVerifiedAttendanceTenantId()).toBe('madrasa-tenant-abc');
        var key = sb.emsAttLocalStorageKey(null, '2026-08', 'teachers', '', 'all');
        expect(key).toBe('att_rec_madrasa-tenant-abc_2026-08_teachers__all');
        expect(key).not.toContain('linked-teacher-auth-uid');
    });

    it('linked staff: verified tenant wins over absent emsGetTenantId context', function () {
        var sb = loadOfflineAttendanceTenantHelpers();
        sb.global.emsGetTenantId = function () { return null; };
        sb.global.CURRENT_MADRASA_TENANT_ID = 'madrasa-tenant-xyz';
        expect(sb.getVerifiedAttendanceTenantId()).toBe('madrasa-tenant-xyz');
        var key = sb.emsAttLocalStorageKey(null, '2026-08', 'staff', '', 'all');
        expect(key).toBe('att_rec_madrasa-tenant-xyz_2026-08_staff__all');
    });

    it('account switch: no verified tenant yields null attendance local key', function () {
        var sb = loadOfflineAttendanceTenantHelpers();
        sb.global.emsGetTenantId = function () { return null; };
        sb.global.CURRENT_MADRASA_TENANT_ID = null;
        sb.global.EMS_ACTIVE_TENANT_ID = null;
        expect(sb.getVerifiedAttendanceTenantId()).toBe(null);
        expect(sb.emsAttLocalStorageKey(null, '2026-08', 'teachers', '', 'all')).toBe(null);
    });

    it('attendance outbox rows compare against verified tenant only', function () {
        var js = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(js).toMatch(/rowBelongsToActiveTenant[\s\S]{0,220}getVerifiedAttendanceTenantId/);
        expect(js).toMatch(/flushAttendanceRow[\s\S]{0,200}getVerifiedAttendanceTenantId/);
        var emitStart = js.indexOf('function emitCloudMutation');
        var emitBlock = js.slice(emitStart, emitStart + 1200);
        expect(emitBlock).toMatch(/getVerifiedAttendanceTenantId/);
    });

    it('attendance-helper activeTenantId scan filters foreign madrasa keys', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        expect(js).toContain('function attKeyBelongsToActiveTenant');
        var activeStart = js.indexOf('function activeTenantId');
        var activeBlock = js.slice(activeStart, js.indexOf('\n    function attKeyBelongsToActiveTenant', activeStart));
        expect(activeBlock).toMatch(/emsGetTenantId/);
        expect(js).toMatch(/attKeyBelongsToActiveTenant[\s\S]{0,180}activeTenantId/);
    });
});
