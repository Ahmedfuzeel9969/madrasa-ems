/**
 * PHASE 1 — Canonical tenant authority + atomic activation
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var TENANT_A = 'tenant-A';
var TENANT_B = 'tenant-B';

function loadEnv() {
    var physical = Object.create(null);
    var attendanceStops = 0;
    var sandbox = {
        physical: physical,
        console: console,
        Promise: Promise,
        CustomEvent: function (name, init) {
            this.type = name;
            this.detail = init && init.detail;
        },
        dispatchEvent: function () {},
        CURRENT_MADRASA_TENANT_ID: null,
        EMS_ACTIVE_TENANT_ID: null,
        EMS_TENANT_STORAGE_READY: false,
        _attendanceStops: function () { return attendanceStops; },
        emsStopAttendanceSync: function () { attendanceStops++; },
        emsStopRegistrationLiveSync: function () {},
        localStorage: {
            getItem: function (k) { return physical[k] != null ? physical[k] : null; },
            setItem: function (k, v) { physical[k] = String(v); },
            removeItem: function (k) { delete physical[k]; }
        }
    };
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8'), sandbox);

    // tenant-context clear (excerpt)
    sandbox.emsClearTenantContext = function (options) {
        options = options || {};
        sandbox.EMS_TENANT_TRANSITION_IN_PROGRESS = true;
        sandbox.EMS_TENANT_GENERATION = (Number(sandbox.EMS_TENANT_GENERATION) || 0) + 1;
        sandbox.EMS_TENANT_STORAGE_READY = false;
        if (typeof sandbox.emsStopAttendanceSync === 'function') sandbox.emsStopAttendanceSync();
        sandbox.CURRENT_MADRASA_TENANT_ID = null;
        sandbox.EMS_ACTIVE_TENANT_ID = null;
        sandbox.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
        if (options.preserveOfflineCache === true) return;
    };

    sandbox.awaitReady = function () {
        return new Promise(function (resolve) {
            var n = 0;
            function tick() {
                if (sandbox.EMS_TENANT_STORAGE_READY && !sandbox.EMS_TENANT_TRANSITION_IN_PROGRESS) {
                    resolve();
                    return;
                }
                if (++n > 50) {
                    resolve();
                    return;
                }
                setTimeout(tick, 5);
            }
            tick();
        });
    };

    return sandbox;
}

describe('Phase 1 — TASK 1.1 canonical tenant authority', function () {
    var env;

    beforeEach(function () {
        env = loadEnv();
    });

    it('returns single tenant when ACTIVE and CURRENT agree', function () {
        env.EMS_ACTIVE_TENANT_ID = TENANT_A;
        env.CURRENT_MADRASA_TENANT_ID = TENANT_A;
        expect(env.emsGetCanonicalTenantId()).toBe(TENANT_A);
        expect(env.emsVerifiedTenantId()).toBe(TENANT_A);
        expect(env.emsResolveCacheKey('ems_att_periods')).toBe('ems_t_tenant-A__ems_att_periods');
    });

    it('fail closed when ACTIVE and CURRENT disagree — no silent pick', function () {
        env.EMS_ACTIVE_TENANT_ID = TENANT_B;
        env.CURRENT_MADRASA_TENANT_ID = TENANT_A;
        expect(env.emsGetCanonicalTenantId()).toBeNull();
        expect(env.emsVerifiedTenantId()).toBeNull();
        expect(env.emsResolveCacheKey('ems_att_periods')).toBeNull();
        expect(env.emsResolvePhysicalWriteKey('ems_att_periods')).toBeNull();
    });

    it('fail closed during tenant transition', function () {
        env.EMS_ACTIVE_TENANT_ID = TENANT_A;
        env.CURRENT_MADRASA_TENANT_ID = TENANT_A;
        env.EMS_TENANT_TRANSITION_IN_PROGRESS = true;
        expect(env.emsGetCanonicalTenantId()).toBeNull();
        expect(env.emsTenantStorageReady()).toBe(false);
    });

    it('getAttendanceTenantId uses canonical resolver', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var block = att.slice(
            att.indexOf('function getAttendanceTenantId'),
            att.indexOf('\nfunction attNormalizeStorageScope')
        );
        expect(block).toContain('emsGetCanonicalTenantId');
    });
});

describe('Phase 1 — TASK 1.2 atomic tenant activation', function () {
    var env;

    beforeEach(function () {
        env = loadEnv();
    });

    it('A → B sets ACTIVE and CURRENT both to B (no divergence)', async function () {
        env.EMS_ACTIVE_TENANT_ID = TENANT_A;
        env.CURRENT_MADRASA_TENANT_ID = TENANT_A;
        env.emsActivateTenantStorage(TENANT_B);
        expect(env.EMS_ACTIVE_TENANT_ID).toBe(TENANT_B);
        expect(env.CURRENT_MADRASA_TENANT_ID).toBe(TENANT_B);
        expect(env.EMS_ACTIVE_TENANT_ID).toBe(env.CURRENT_MADRASA_TENANT_ID);
        await env.awaitReady();
        expect(env.emsGetCanonicalTenantId()).toBe(TENANT_B);
        expect(env.EMS_TENANT_TRANSITION_IN_PROGRESS).toBe(false);
        expect(env.EMS_TENANT_STORAGE_READY).toBe(true);
    });

    it('B → A restores A consistently', async function () {
        env.emsActivateTenantStorage(TENANT_B);
        await env.awaitReady();
        env.emsActivateTenantStorage(TENANT_A);
        expect(env.EMS_ACTIVE_TENANT_ID).toBe(TENANT_A);
        expect(env.CURRENT_MADRASA_TENANT_ID).toBe(TENANT_A);
        await env.awaitReady();
        expect(env.emsGetCanonicalTenantId()).toBe(TENANT_A);
    });

    it('logout clears both identities and bumps generation', function () {
        env.emsActivateTenantStorage(TENANT_A);
        var genBefore = env.emsGetTenantGeneration();
        env.emsClearTenantContext();
        expect(env.EMS_ACTIVE_TENANT_ID).toBeNull();
        expect(env.CURRENT_MADRASA_TENANT_ID).toBeNull();
        expect(env.emsGetCanonicalTenantId()).toBeNull();
        expect(env.emsGetTenantGeneration()).toBeGreaterThan(genBefore);
    });

    it('stops attendance sync before identity flip on switch', function () {
        env.EMS_ACTIVE_TENANT_ID = TENANT_A;
        env.CURRENT_MADRASA_TENANT_ID = TENANT_A;
        var before = env._attendanceStops();
        env.emsActivateTenantStorage(TENANT_B);
        expect(env._attendanceStops()).toBeGreaterThan(before);
    });

    it('rapid A → B → A ends on A with matching identities', async function () {
        env.emsActivateTenantStorage(TENANT_A);
        env.emsActivateTenantStorage(TENANT_B);
        env.emsActivateTenantStorage(TENANT_A);
        expect(env.EMS_ACTIVE_TENANT_ID).toBe(TENANT_A);
        expect(env.CURRENT_MADRASA_TENANT_ID).toBe(TENANT_A);
        await env.awaitReady();
        expect(env.emsGetCanonicalTenantId()).toBe(TENANT_A);
    });

    it('linked staff: madrasa tenantId is activated, not personal auth uid', async function () {
        var madrasaId = 'madrasa-owner-xyz';
        var personalUid = 'personal-auth-uid';
        env.CURRENT_USER_TENANT_ROLE = 'staff';
        env.emsActivateTenantStorage(madrasaId);
        expect(env.EMS_ACTIVE_TENANT_ID).toBe(madrasaId);
        expect(env.CURRENT_MADRASA_TENANT_ID).toBe(madrasaId);
        expect(env.EMS_ACTIVE_TENANT_ID).not.toBe(personalUid);
        await env.awaitReady();
        expect(env.emsGetCanonicalTenantId()).toBe(madrasaId);
        expect(env.emsResolveCacheKey('ems_att_periods')).toBe('ems_t_' + madrasaId + '__ems_att_periods');
    });

    it('owner activation uses owner tenant consistently', async function () {
        var ownerUid = 'owner-uid-1';
        env.CURRENT_USER_TENANT_ROLE = 'owner';
        env.emsActivateTenantStorage(ownerUid);
        await env.awaitReady();
        expect(env.emsGetCanonicalTenantId()).toBe(ownerUid);
        expect(env.EMS_ACTIVE_TENANT_ID).toBe(env.CURRENT_MADRASA_TENANT_ID);
    });

    it('source: activation always assigns CURRENT = tenantId', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8');
        var block = src.slice(
            src.indexOf('global.emsActivateTenantStorage = function'),
            src.indexOf('global.emsLiteLoginPrepare = function')
        );
        expect(block).toContain('EMS_ACTIVE_TENANT_ID = tenantId');
        expect(block).toContain('CURRENT_MADRASA_TENANT_ID = tenantId');
        expect(block).toContain('stopTenantBoundListenersForTransition');
        expect(block).toContain('EMS_TENANT_TRANSITION_IN_PROGRESS');
        expect(block).not.toMatch(/if\s*\(\s*!global\.CURRENT_MADRASA_TENANT_ID\s*\)/);
        expect(src).toContain('emsStopAttendanceSync');
    });
});
