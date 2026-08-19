import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadTenantStorage() {
    var data = Object.create(null);
    var sandbox = {
        Promise: Promise,
        CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
        dispatchEvent: function () {},
        localStorage: {
            getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
            setItem: function (key, value) { data[key] = String(value); },
            removeItem: function (key) { delete data[key]; }
        },
        window: null,
        globalThis: null
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    var src = fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8');
    vm.runInNewContext(src, sandbox);
    return sandbox;
}

describe('Tenant-local storage isolation', function () {
    it('keeps two madrasas data separate through read, write, and return', function () {
        var sb = loadTenantStorage();
        var cacheSrc = fs.readFileSync(path.join(ROOT, 'ems-data-cache.js'), 'utf8');
        vm.runInNewContext(cacheSrc, sb);

        sb.EMS_ACTIVE_TENANT_ID = 'madrasa-A';
        sb.emsCacheSet('ems_full_exams', [{ id: 'A-only' }]);
        sb.emsCacheSet('ems_fee_collections', [{ id: 'A-fee' }]);

        sb.EMS_ACTIVE_TENANT_ID = 'madrasa-B';
        expect(sb.emsCacheGet('ems_full_exams', [])).toEqual([]);
        expect(sb.emsCacheGet('ems_fee_collections', [])).toEqual([]);
        sb.emsCacheSet('ems_full_exams', [{ id: 'B-only' }]);

        sb.EMS_ACTIVE_TENANT_ID = 'madrasa-A';
        expect(sb.emsCacheGet('ems_full_exams', [])).toEqual([{ id: 'A-only' }]);
        expect(sb.emsCacheGet('ems_fee_collections', [])).toEqual([{ id: 'A-fee' }]);
    });

    it('uses distinct physical keys for each madrasa business blob', function () {
        var sb = loadTenantStorage();
        sb.EMS_ACTIVE_TENANT_ID = 'madrasa-A';
        var a = sb.emsResolveCacheKey('ems_full_exams');
        sb.EMS_ACTIVE_TENANT_ID = 'madrasa-B';
        var b = sb.emsResolveCacheKey('ems_full_exams');
        expect(a).toBe('ems_t_madrasa-A__ems_full_exams');
        expect(b).toBe('ems_t_madrasa-B__ems_full_exams');
        expect(a).not.toBe(b);
    });

    it('scopes attendance-related financial and announcement data too', function () {
        var sb = loadTenantStorage();
        sb.EMS_ACTIVE_TENANT_ID = 'madrasa-A';
        [
            'ems_fee_collections',
            'ems_student_fee_setup',
            'ems_full_ledger',
            'ems_payroll_history',
            'ems_full_announcements',
            'ems_curriculum_daily'
        ].forEach(function (key) {
            expect(sb.emsResolveCacheKey(key)).toBe('ems_t_madrasa-A__' + key);
        });
    });

    it('fails closed for business data before a tenant is identified', function () {
        var sb = loadTenantStorage();
        expect(sb.emsResolveCacheKey('ems_full_exams')).toBe(null);
        expect(sb.emsResolveCacheKey('ems_fee_collections')).toBe(null);
        expect(sb.emsResolveCacheKey('ems_full_ledger')).toBe(null);
    });

    it('keeps non-business configuration keys unchanged', function () {
        var sb = loadTenantStorage();
        expect(sb.emsResolveCacheKey('ems_persisted_tenant_id_v1')).toBe('ems_persisted_tenant_id_v1');
        expect(sb.emsResolveCacheKey('ems_sys_theme')).toBe('ems_sys_theme');
    });

    it('has safe migration and does not remove legacy source data', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8');
        expect(src).toContain('emsMigrateLegacyTenantData');
        expect(src).toContain('legacyMigrationSafeFor');
        expect(src).toContain('Copy (never delete) legacy global data');
    });

    it('protects direct browser localStorage calls at the storage boundary', function () {
        var src = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');
        expect(src).toContain('emsResolveBrowserStorageKey');
        expect(src).toContain('Tenant data is scoped at the browser-storage boundary');
        expect(src).toContain('localStorage.getItem = function (key)');
        expect(src).toContain('localStorage.setItem = function (key, value)');
    });

    it('filters attendance key scans to the active madrasa', function () {
        var helper = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        var dashboard = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        expect(helper).toContain('attKeyBelongsToActiveTenant');
        expect(helper).toContain("emsIdbKvKeysByPrefix('att_rec_' + tenantId + '_')");
        expect(dashboard).toContain('_attSheetCache.tenantId === tenantId');
    });

    it('never uses persisted boot tenant as authenticated Firestore authority', function () {
        var resolver = fs.readFileSync(path.join(ROOT, 'ems-tenant-resolver.js'), 'utf8');
        var paths = fs.readFileSync(path.join(ROOT, 'ems-firestore-paths.js'), 'utf8');
        expect(resolver).toContain('if (!authUidVal && typeof global.emsReadPersistedBootTenantId');
        expect(paths).toContain('if (!uid && persisted && !isLocalTenantId(persisted))');
    });

    it('scopes attendance timetable settings independently of madrasa display name', function () {
        var sb = loadTenantStorage();
        sb.CURRENT_MADRASA_TENANT_ID = 'uid-owner-A';
        sb.EMS_ACTIVE_TENANT_ID = 'uid-owner-A';
        var aPeriods = sb.emsResolveCacheKey('ems_att_periods');
        var aExams = sb.emsResolveCacheKey('ems_full_exams');
        sb.EMS_ACTIVE_TENANT_ID = 'uid-owner-B';
        sb.CURRENT_MADRASA_TENANT_ID = 'uid-owner-B';
        var bPeriods = sb.emsResolveCacheKey('ems_att_periods');
        var bExams = sb.emsResolveCacheKey('ems_full_exams');
        expect(aPeriods).toBe('ems_t_uid-owner-A__ems_att_periods');
        expect(bPeriods).toBe('ems_t_uid-owner-B__ems_att_periods');
        expect(aPeriods).not.toBe(bPeriods);
        expect(aExams).not.toBe(bExams);
    });

    it('does not treat a physical key from another tenant as readable', function () {
        var sb = loadTenantStorage();
        sb.EMS_ACTIVE_TENANT_ID = 'uid-owner-B';
        expect(sb.emsPhysicalKeyBelongsToTenant('ems_t_uid-owner-A__ems_full_exams', 'uid-owner-B')).toBe(false);
        expect(sb.emsPhysicalKeyBelongsToTenant('att_rec_uid-owner-A_2026-08_teachers__all', 'uid-owner-B')).toBe(false);
        expect(sb.emsPhysicalKeyBelongsToTenant('ems_t_uid-owner-B__ems_full_exams', 'uid-owner-B')).toBe(true);
        expect(sb.emsPhysicalKeyBelongsToTenant('ems_sys_theme', 'uid-owner-B')).toBe(true);
    });

    it('saves module blobs through tenant-resolved physical keys', function () {
        var core = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');
        expect(core).toContain('emsResolveCacheKey');
        expect(core).toMatch(/emsSaveModuleData[\s\S]*physicalKey/);
        expect(core).toContain('blocked_no_tenant');
    });

    it('refuses to flush another tenant outbox row into the active session', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(src).toContain('function rowBelongsToActiveTenant');
        expect(src).toContain("code: 'TENANT_MISMATCH'");
        expect(src).toContain('attIndexStorageKey');
        expect(src).not.toMatch(/flushAttendanceRow[\s\S]{0,80}row\.tenantId \|\| getTenantId/);
    });

    it('cloud pull uses only the verified session tenant', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-cloud-pull.js'), 'utf8');
        expect(src).toContain('never auth.uid fallback');
        expect(src).toContain("reason: 'tenant_mismatch'");
        expect(src).not.toMatch(/if \(u && u\.uid\) return u\.uid/);
    });

    it('firestore rules keep owner access on madrasaId === auth.uid', function () {
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('function isOwner(uid)');
        expect(rules).toContain('request.auth.uid == uid');
        expect(rules).toContain('function isStaffOf(madrasaId)');
        expect(rules).toContain('function isParentOf(madrasaId)');
        expect(rules).toContain('canReadTenantStaff(madrasaId)');
    });

    it('hydrates durable memory only for the active tenant partition', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-durable-storage.js'), 'utf8');
        expect(src).toContain('emsDurableReleaseInactiveTenants');
        expect(src).toContain('emsPhysicalKeyBelongsToTenant');
    });
});
