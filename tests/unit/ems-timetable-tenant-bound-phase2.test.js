/**
 * PHASE 2 — Source-tenant-bound timetable listener + explicit tenantId writes
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

function scopedKey(tid) {
    return 'ems_t_' + tid + '__' + PERIODS_KEY;
}

function loadRaceEnv() {
    var physical = Object.create(null);
    var idb = Object.create(null);
    function og(k) { return Object.prototype.hasOwnProperty.call(physical, k) ? physical[k] : null; }
    function os(k, v) { physical[k] = String(v); }

    var sb = {
        physical: physical,
        _idb: idb,
        console: console,
        Promise: Promise,
        document: { getElementById: function () { return null; } },
        CURRENT_MADRASA_TENANT_ID: null,
        EMS_ACTIVE_TENANT_ID: null,
        EMS_TENANT_STORAGE_READY: false,
        EMS_TENANT_TRANSITION_IN_PROGRESS: false,
        EMS_TENANT_GENERATION: 0,
        _emsOriginalGetItem: og,
        _emsOriginalSetItem: os,
        localStorage: {
            getItem: function (key) {
                var r = sb.emsResolveCacheKey ? sb.emsResolveCacheKey(key) : key;
                return r ? og(r) : null;
            },
            setItem: function (key, value) {
                var r = sb.emsResolveCacheKey ? sb.emsResolveCacheKey(key) : key;
                if (r) os(r, value);
            }
        },
        attIndexAddKey: function () {},
        emsCacheInvalidate: function () {},
        emsInvalidateAttDashboardCache: function () {},
        emsIsLargeBlobKey: function () { return false; },
        emsIdbKvSet: function (key, val) {
            idb[key] = typeof val === 'string' ? val : JSON.stringify(val);
            return Promise.resolve(true);
        },
        emsStopAttendanceSync: function () {
            if (typeof sb.stopAttendanceFirestoreSync === 'function') sb.stopAttendanceFirestoreSync();
        },
        emsStopRegistrationLiveSync: function () {},
        emsMigrateLegacyTenantData: function () { return Promise.resolve({ migrated: 0 }); }
    };
    sb.window = sb;
    sb.global = sb;
    sb.globalThis = sb;

    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8'), sb);

    var offlineSrc = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
    vm.runInNewContext(
        offlineSrc.slice(
            offlineSrc.indexOf('function resolveOfflinePhysicalKey'),
            offlineSrc.indexOf('global.emsAttCloudDocId = function')
        ) + '\nthis.emsOfflineWriteLocalSync = global.emsOfflineWriteLocalSync;',
        sb
    );

    sb.attGetUsers = function () {
        return [{ id: 'TCH-OWN', name: 'اپنا استاد', type: 'teacher' }];
    };
    sb.attUserMatchesType = function (u, type) { return !!u && u.type === type; };
    sb.attGetUserId = function (u) { return u && u.id; };

    var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var getTenantBlock = att.slice(
        att.indexOf('function getAttendanceTenantId'),
        att.indexOf('\nfunction attNormalizeStorageScope')
    );
    var cloudHelpersBlock = att.slice(
        att.indexOf('var ATT_SYMBOLS_KEY'),
        att.indexOf('\nfunction attRecoverLegacyTimetablePeriods')
    );
    var syncBlock = att.slice(
        att.indexOf('var attConfigUnsub = null'),
        att.indexOf('window.emsStopAttendanceSync = stopAttendanceFirestoreSync') +
            'window.emsStopAttendanceSync = stopAttendanceFirestoreSync'.length
    );

    var listenersByTenant = Object.create(null);
    sb._listenersByTenant = listenersByTenant;
    sb.db = {};
    sb.attTenantSubCol = function (db, tenantId, colName) {
        return {
            doc: function (docId) {
                return {
                    onSnapshot: function (cb) {
                        var entry = { cb: cb, tenantId: tenantId, alive: true };
                        if (!listenersByTenant[tenantId]) listenersByTenant[tenantId] = [];
                        listenersByTenant[tenantId].push(entry);
                        return function () { entry.alive = false; };
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
        + '\nthis.attSnapshotMayMutateTenantState = attSnapshotMayMutateTenantState;'
        + '\nthis.stopAttendanceFirestoreSync = stopAttendanceFirestoreSync;',
        sb
    );

    sb.setBoth = function (tid) {
        sb.CURRENT_MADRASA_TENANT_ID = tid;
        sb.EMS_ACTIVE_TENANT_ID = tid;
        sb.EMS_TENANT_STORAGE_READY = true;
        sb.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
    };

    sb.deliverSnapshot = function (sourceTenantId, list) {
        var delivered = 0;
        (listenersByTenant[sourceTenantId] || []).forEach(function (e) {
            if (!e.alive) return;
            e.cb({ exists: true, data: function () { return { data: JSON.stringify(list), key: PERIODS_KEY, module: 'Attendance' }; } });
            delivered++;
        });
        return delivered;
    };

    sb.awaitReady = function () {
        return new Promise(function (resolve) {
            var n = 0;
            (function tick() {
                if (!sb.EMS_TENANT_TRANSITION_IN_PROGRESS && sb.EMS_TENANT_STORAGE_READY) return resolve();
                if (++n > 50) return resolve();
                setTimeout(tick, 5);
            })();
        });
    };

    return sb;
}

describe('Phase 2 — TASK 2.1 listener source-tenant binding', function () {
    var env;

    beforeEach(function () {
        env = loadRaceEnv();
        env.setBoth(TENANT_A);
    });

    it('A listener writes to ems_t_tenant-A__ems_att_periods', function () {
        env.emsStartAttendanceSync();
        env.deliverSnapshot(TENANT_A, [{
            id: 'P-A', name: 'A Period', teacherId: 'TCH-OWN', teacherName: 'اپنا استاد', days: [1]
        }]);
        expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id).toBe('P-A');
        expect(env.physical[scopedKey(TENANT_B)]).toBeFalsy();
    });

    it('B listener writes to B partition only', function () {
        env.setBoth(TENANT_B);
        env.emsStartAttendanceSync();
        env.deliverSnapshot(TENANT_B, [{
            id: 'P-B', name: 'B Period', teacherId: 'TCH-OWN', teacherName: 'اپنا استاد', days: [1]
        }]);
        expect(env.physical[scopedKey(TENANT_B)]).toBeTruthy();
        expect(env.physical[scopedKey(TENANT_A)]).toBeFalsy();
    });

    it('delayed A snapshot after switch to B is rejected (unsubscribe + generation)', async function () {
        var listenGen = env.emsGetTenantGeneration();
        env.emsStartAttendanceSync();

        env.emsActivateTenantStorage(TENANT_B);
        await env.awaitReady();
        expect(env.emsGetTenantGeneration()).toBeGreaterThan(listenGen);

        expect(env.deliverSnapshot(TENANT_A, [{ id: 'LEAK', days: [1] }])).toBe(0);
        expect(env.physical[scopedKey(TENANT_B)]).toBeFalsy();
        expect(env.physical[scopedKey(TENANT_A)]).toBeFalsy();
    });

    it('queued A callback after B ready is rejected by generation guard', async function () {
        env.emsStartAttendanceSync();
        var aCb = (env._listenersByTenant[TENANT_A] || [])[0].cb;
        var listenGen = env.emsGetTenantGeneration();
        env.emsActivateTenantStorage(TENANT_B);
        await env.awaitReady();
        expect(env.emsGetTenantGeneration()).toBeGreaterThan(listenGen);

        aCb({ exists: true, data: function () { return { data: JSON.stringify([{ id: 'QUEUED', days: [1] }]), key: PERIODS_KEY, module: 'Attendance' }; } });
        expect(env.physical[scopedKey(TENANT_B)]).toBeFalsy();
        expect(env.physical[scopedKey(TENANT_A)]).toBeFalsy();
    });

    it('delayed B snapshot after logout is rejected', function () {
        env.setBoth(TENANT_B);
        env.emsStartAttendanceSync();
        env.EMS_ACTIVE_TENANT_ID = null;
        env.CURRENT_MADRASA_TENANT_ID = null;
        env.EMS_TENANT_STORAGE_READY = false;
        env.EMS_TENANT_GENERATION = (env.EMS_TENANT_GENERATION || 0) + 1;

        env.deliverSnapshot(TENANT_B, [{ id: 'POST-LOGOUT', days: [1] }]);
        expect(env.physical[scopedKey(TENANT_B)]).toBeFalsy();
    });

    it('rapid A→B→A: only matching-generation listener writes', async function () {
        env.emsStartAttendanceSync();
        env.emsActivateTenantStorage(TENANT_B);
        await env.awaitReady();
        env.emsActivateTenantStorage(TENANT_A);
        await env.awaitReady();
        env.emsStartAttendanceSync();
        env.deliverSnapshot(TENANT_A, [{
            id: 'BACK-A', teacherId: 'TCH-OWN', teacherName: 'اپنا استاد', days: [1]
        }]);
        expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id).toBe('BACK-A');
    });
});

describe('Phase 2 — TASK 2.2 explicit tenantId on local writes', function () {
    var env;

    beforeEach(function () {
        env = loadRaceEnv();
        env.setBoth(TENANT_A);
    });

    it('emsOfflineWriteLocalSync with explicit tenantId writes scoped localStorage + IDB', function () {
        env.emsOfflineWriteLocalSync(PERIODS_KEY, [{ id: 'X1', days: [1] }], { tenantId: TENANT_A });
        expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();
        expect(env._idb[scopedKey(TENANT_A)]).toBeTruthy();
        expect(env.physical[PERIODS_KEY]).toBeFalsy();
    });

    it('write with wrong explicit tenantId is rejected when active is A', function () {
        var ok = env.emsOfflineWriteLocalSync(PERIODS_KEY, [{ id: 'BAD', days: [1] }], { tenantId: TENANT_B });
        expect(ok).toBe(false);
        expect(env.physical[scopedKey(TENANT_B)]).toBeFalsy();
    });

    it('source lock: snapshot uses tenantId + generation opts', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var block = att.slice(
            att.indexOf('window.emsStartAttendanceSync = function'),
            att.indexOf('window.emsStopAttendanceSync = stopAttendanceFirestoreSync')
        );
        expect(block).toContain('listenerTenantId');
        expect(block).toContain('listenerGeneration');
        expect(block).toContain('attSnapshotMayMutateTenantState');
        expect(block).toMatch(/emsOfflineWriteLocalSync\('ems_att_periods'[\s\S]{0,120}tenantId:\s*listenerTenantId/);
    });
});
