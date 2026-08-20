/**
 * PHASE 0 — Cross-madrasa timetable leakage reproduction
 * Tests only. No production behavior changes.
 *
 * Proves / rejects:
 *   FINDING A — EMS_ACTIVE_TENANT_ID vs CURRENT_MADRASA_TENANT_ID divergence
 *   FINDING B — late Attendance_Config snapshot writes into wrong tenant partition
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var PERIODS_KEY = 'ems_att_periods';
var TENANT_A = 'tenant-A';
var TENANT_B = 'tenant-B';

function scopedKey(tenantId) {
    return 'ems_t_' + tenantId + '__' + PERIODS_KEY;
}

function loadTenantStorageSandbox() {
    var physical = Object.create(null);
    function originalGetItem(key) {
        return Object.prototype.hasOwnProperty.call(physical, key) ? physical[key] : null;
    }
    function originalSetItem(key, value) {
        physical[key] = String(value);
    }

    var sandbox = {
        physical: physical,
        console: console,
        Promise: Promise,
        CURRENT_MADRASA_TENANT_ID: null,
        EMS_ACTIVE_TENANT_ID: null,
        EMS_TENANT_STORAGE_READY: false,
        _emsOriginalGetItem: originalGetItem,
        _emsOriginalSetItem: originalSetItem,
        localStorage: {
            getItem: function (key) { return originalGetItem(key); },
            setItem: function (key, value) { originalSetItem(key, value); },
            removeItem: function (key) { delete physical[key]; }
        }
    };
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8'), sandbox);

    // Minimal emsGetTenantId matching tenant-context.js / resolver preference
    sandbox.emsGetTenantId = function () {
        return sandbox.CURRENT_MADRASA_TENANT_ID || sandbox.EMS_ACTIVE_TENANT_ID || null;
    };

    return sandbox;
}

/**
 * Reproduce the live Attendance_Config/periods snapshot write path as in
 * attendance.js emsStartAttendanceSync — without Firebase.
 */
function loadTimetableListenerRaceEnv() {
    var sb = loadTenantStorageSandbox();
    var idb = Object.create(null);
    sb._idb = idb;
    sb.attIndexAddKey = function () {};
    sb.emsCacheInvalidate = function () {};
    sb.emsInvalidateAttDashboardCache = function () {};
    sb.emsIsLargeBlobKey = function () { return false; };
    sb.emsIdbKvSet = function (key, val) {
        idb[key] = typeof val === 'string' ? val : JSON.stringify(val);
        return Promise.resolve(true);
    };
    sb.emsIdbKvGet = function (key) {
        return Promise.resolve(idb[key] != null ? idb[key] : null);
    };
    sb.document = { getElementById: function () { return null; } };

    sb.emsStopAttendanceSync = function () {
        if (typeof sb.stopAttendanceFirestoreSync === 'function') sb.stopAttendanceFirestoreSync();
    };
    sb.emsStopRegistrationLiveSync = function () {};
    sb.emsMigrateLegacyTenantData = function () { return Promise.resolve({ migrated: 0 }); };

    var offlineSrc = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
    var offlineSlice = offlineSrc.slice(
        offlineSrc.indexOf('function resolveOfflinePhysicalKey'),
        offlineSrc.indexOf('global.emsAttCloudDocId = function')
    );
    vm.runInNewContext(offlineSlice + '\nthis.emsOfflineWriteLocalSync = global.emsOfflineWriteLocalSync;', sb);

    var attSrc = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var getTenantBlock = attSrc.slice(
        attSrc.indexOf('function getAttendanceTenantId'),
        attSrc.indexOf('\nfunction attNormalizeStorageScope')
    );
    var cloudHelpersBlock = attSrc.slice(
        attSrc.indexOf('var ATT_SYMBOLS_KEY'),
        attSrc.indexOf('\nfunction attRecoverLegacyTimetablePeriods')
    );
    var syncBlock = attSrc.slice(
        attSrc.indexOf('var attConfigUnsub = null'),
        attSrc.indexOf('window.emsStopAttendanceSync = stopAttendanceFirestoreSync') +
            'window.emsStopAttendanceSync = stopAttendanceFirestoreSync'.length
    );

    // Deterministic Firestore stub: capture onSnapshot callbacks per tenant
    var listenersByTenant = Object.create(null);
    sb._listenersByTenant = listenersByTenant;
    sb.db = {};
    sb.attTenantSubCol = function (db, tenantId, colName) {
        return {
            doc: function (docId) {
                return {
                    onSnapshot: function (cb) {
                        var entry = { cb: cb, tenantId: tenantId, col: colName, docId: docId, alive: true };
                        if (!listenersByTenant[tenantId]) listenersByTenant[tenantId] = [];
                        listenersByTenant[tenantId].push(entry);
                        return function unsubscribe() {
                            entry.alive = false;
                        };
                    }
                };
            }
        };
    };
    sb.attIsOfflineMode = function () { return true; };
    sb.setupLiveAttendanceListener = function () {};
    sb.loadPeriods = function () {};

    vm.runInNewContext(
        getTenantBlock + '\n' + cloudHelpersBlock + '\n' + syncBlock
        + '\nthis.getAttendanceTenantId = getAttendanceTenantId;'
        + '\nthis.emsStartAttendanceSync = emsStartAttendanceSync;'
        + '\nthis.emsStopAttendanceSync = stopAttendanceFirestoreSync;'
        + '\nthis.stopAttendanceFirestoreSync = stopAttendanceFirestoreSync;',
        sb
    );

    /** Deliver a delayed snapshot as if from Firestore for a given source tenant. */
    sb.deliverDelayedSnapshot = function (sourceTenantId, list) {
        var listArr = Array.isArray(list) ? list : [];
        var entries = listenersByTenant[sourceTenantId] || [];
        var delivered = 0;
        entries.forEach(function (entry) {
            if (!entry.alive) return;
            entry.cb({
                exists: true,
                data: function () { return { data: JSON.stringify(listArr), key: PERIODS_KEY, module: 'Attendance' }; }
            });
            delivered++;
        });
        return delivered;
    };

    sb.activateStorageOnly = function (tenantId) {
        // Mimic production: CURRENT already set, then storage activation for another tenant
        sb.emsActivateTenantStorage(tenantId);
    };

    return sb;
}

describe('Phase 0 — FINDING A: tenant identity divergence (updated after Phase 1 fix)', function () {
    var sb;

    beforeEach(function () {
        sb = loadTenantStorageSandbox();
        sb.CURRENT_MADRASA_TENANT_ID = TENANT_A;
        sb.EMS_ACTIVE_TENANT_ID = TENANT_A;
        sb.EMS_TENANT_STORAGE_READY = true;
    });

    it('emsActivateTenantStorage(B) sets BOTH CURRENT and ACTIVE to B (no divergence)', function () {
        sb.emsActivateTenantStorage(TENANT_B);

        expect(sb.EMS_ACTIVE_TENANT_ID).toBe(TENANT_B);
        expect(sb.CURRENT_MADRASA_TENANT_ID).toBe(TENANT_B);
        expect(sb.EMS_ACTIVE_TENANT_ID).toBe(sb.CURRENT_MADRASA_TENANT_ID);
    });

    it('manual mismatch fail-closed: canonical null; physical writes blocked', function () {
        sb.EMS_ACTIVE_TENANT_ID = TENANT_B;
        sb.CURRENT_MADRASA_TENANT_ID = TENANT_A;
        expect(sb.emsGetCanonicalTenantId()).toBeNull();
        expect(sb.emsResolveCacheKey(PERIODS_KEY)).toBeNull();
        expect(sb.emsResolvePhysicalWriteKey(PERIODS_KEY)).toBeNull();
    });

    it('source lock: emsActivateTenantStorage assigns CURRENT = tenantId atomically', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8');
        var block = src.slice(
            src.indexOf('global.emsActivateTenantStorage = function'),
            src.indexOf('global.emsLiteLoginPrepare = function')
        );
        expect(block).toMatch(/EMS_ACTIVE_TENANT_ID\s*=\s*tenantId/);
        expect(block).toMatch(/CURRENT_MADRASA_TENANT_ID\s*=\s*tenantId/);
        expect(block).not.toMatch(/if\s*\(\s*!global\.CURRENT_MADRASA_TENANT_ID\s*\)/);
    });
});

describe('Phase 0 — FINDING B: late snapshot cross-tenant write (partially mitigated by Phase 1 teardown)', function () {
    var env;

    beforeEach(function () {
        env = loadTimetableListenerRaceEnv();
        env.CURRENT_MADRASA_TENANT_ID = TENANT_A;
        env.EMS_ACTIVE_TENANT_ID = TENANT_A;
        env.EMS_TENANT_STORAGE_READY = true;
    });

    it('source lock: periods snapshot writes with explicit tenantId + generation (Phase 2)', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var block = att.slice(
            att.indexOf('window.emsStartAttendanceSync = function'),
            att.indexOf('window.emsStopAttendanceSync = stopAttendanceFirestoreSync')
        );
        expect(block).toContain('attSnapshotMayMutateTenantState');
        expect(block).toMatch(/emsOfflineWriteLocalSync\('ems_att_periods'[\s\S]{0,120}tenantId:\s*listenerTenantId/);
        expect(block).toContain('generation: listenerGeneration');
    });

    it('Phase 1: emsActivateTenantStorage stops attendance sync listeners', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8');
        expect(src).toContain('function stopTenantBoundListenersForTransition');
        expect(src).toContain('emsStopAttendanceSync');
        var block = src.slice(
            src.indexOf('global.emsActivateTenantStorage = function'),
            src.indexOf('global.emsLiteLoginPrepare = function')
        );
        expect(block).toContain('stopTenantBoundListenersForTransition');
    });

    it('Phase 1 mitigates: delayed A snapshot after switch to B does not write (listener torn down)', function () {
        env.emsStartAttendanceSync();
        expect((env._listenersByTenant[TENANT_A] || []).filter(function (e) { return e.alive; }).length).toBe(1);

        env.emsActivateTenantStorage(TENANT_B);
        expect(env.EMS_ACTIVE_TENANT_ID).toBe(TENANT_B);
        expect(env.CURRENT_MADRASA_TENANT_ID).toBe(TENANT_B);
        expect((env._listenersByTenant[TENANT_A] || []).filter(function (e) { return e.alive; }).length).toBe(0);

        var delivered = env.deliverDelayedSnapshot(TENANT_A, [
            { id: 'PRD-A-ONLY', name: 'A-ONLY-TEST', days: [1] }
        ]);
        expect(delivered).toBe(0);
        expect(env.physical[scopedKey(TENANT_B)]).toBeFalsy();
        expect(env.physical[scopedKey(TENANT_A)]).toBeFalsy();
    });

    it('Phase 2: queued A callback after B ready is rejected (generation + source tenant bind)', async function () {
        env.emsStartAttendanceSync();
        var aCb = (env._listenersByTenant[TENANT_A] || [])[0].cb;
        env.emsActivateTenantStorage(TENANT_B);
        await new Promise(function (r) {
            var n = 0;
            (function tick() {
                if (!env.EMS_TENANT_TRANSITION_IN_PROGRESS && env.EMS_TENANT_STORAGE_READY) return r();
                if (++n > 50) return r();
                setTimeout(tick, 5);
            })();
        });
        aCb({
            exists: true,
            data: function () {
                return { list: [{ id: 'PRD-QUEUED', name: 'QUEUED-A', days: [1] }] };
            }
        });
        expect(env.physical[scopedKey(TENANT_B)]).toBeFalsy();
        expect(env.physical[scopedKey(TENANT_A)]).toBeFalsy();
    });

    it('safe contract after Phase 1 teardown: delayed A snapshot must not land on B', function () {
        env.emsStartAttendanceSync();
        env.emsActivateTenantStorage(TENANT_B);
        env.deliverDelayedSnapshot(TENANT_A, [{ id: 'PRD-SHOULD-REJECT', name: 'MUST-NOT-LAND-ON-B', days: [1] }]);
        expect(env.physical[scopedKey(TENANT_B)]).toBeFalsy();
        expect(env.physical[scopedKey(TENANT_A)]).toBeFalsy();
    });
});
