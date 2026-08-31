/**
 * PHASE 4 — One canonical cloud source of truth for timetable (ems_att_periods)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var PERIODS_KEY = 'ems_att_periods';
var CANONICAL_DOC = 'Attendance__ems_att_periods';
var TENANT_A = 'tenant-A';
var TENANT_B = 'tenant-B';

function scopedKey(tid) {
    return 'ems_t_' + tid + '__' + PERIODS_KEY;
}

function moduleDataSnapshot(list) {
    return {
        exists: true,
        data: function () {
            return { key: PERIODS_KEY, module: 'Attendance', data: JSON.stringify(list) };
        }
    };
}

function loadEnv() {
    var physical = Object.create(null);
    var idb = Object.create(null);
    var cloudGets = Object.create(null);
    var enqueued = [];

    function og(k) { return Object.prototype.hasOwnProperty.call(physical, k) ? physical[k] : null; }
    function os(k, v) { physical[k] = String(v); }

    var sb = {
        physical: physical,
        _idb: idb,
        _cloudGets: cloudGets,
        _enqueued: enqueued,
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
        emsIsLargeBlobKey: function () { return false; },
        emsIdbKvSet: function (key, val) {
            idb[key] = typeof val === 'string' ? val : JSON.stringify(val);
            return Promise.resolve(true);
        },
        emsOfflineEnqueueSyncModule: function (key, jsonStr, opts) {
            enqueued.push({ key: key, jsonStr: jsonStr, opts: opts || {} });
            return Promise.resolve({ ok: true });
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

    var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var readRawBlock = att.slice(
        att.indexOf('function attReadAllTimetablePeriodsRaw'),
        att.indexOf('\nfunction attSaveTimetablePeriodsSync')
    );
    var attBlocks = readRawBlock + att.slice(
        att.indexOf('function getAttendanceTenantId'),
        att.indexOf('\nfunction attNormalizeStorageScope')
    ) + att.slice(
        att.indexOf('var ATT_SYMBOLS_KEY'),
        att.indexOf('\nfunction attRecoverLegacyTimetablePeriods')
    ) + att.slice(
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
                        var entry = { cb: cb, tenantId: tenantId, col: colName, docId: docId, alive: true };
                        if (!listenersByTenant[tenantId]) listenersByTenant[tenantId] = [];
                        listenersByTenant[tenantId].push(entry);
                        return function () { entry.alive = false; };
                    },
                    get: function () {
                        var pathKey = colName + '/' + docId;
                        var stored = cloudGets[tenantId + '::' + pathKey];
                        return Promise.resolve(stored || { exists: false });
                    }
                };
            }
        };
    };
    sb.attIsOfflineMode = function () { return false; };
    sb.setupLiveAttendanceListener = function () {};
    sb.loadPeriods = function () {};
    sb.attGetUsers = function () { return []; };
    sb.attUserMatchesType = function () { return false; };
    sb.attGetUserId = function (u) { return u && u.id; };
    sb.attGetUserClass = function (u) { return u && (u.class || u.className); };

    vm.runInNewContext(
        attBlocks
        + '\nthis.getAttendanceTenantId = getAttendanceTenantId;'
        + '\nthis.emsStartAttendanceSync = emsStartAttendanceSync;'
        + '\nthis.attMigrateLegacyCloudTimetablePeriods = attMigrateLegacyCloudTimetablePeriods;'
        + '\nthis.emsPullAttendanceTimetableFromCloud = window.emsPullAttendanceTimetableFromCloud;'
        + '\nthis.attTimetableListFromCloudSnapshot = attTimetableListFromCloudSnapshot;'
        + '\nthis.stopAttendanceFirestoreSync = stopAttendanceFirestoreSync;',
        sb
    );

    sb.setBoth = function (tid) {
        if (typeof sb.emsActivateTenantStorage === 'function') {
            sb.emsActivateTenantStorage(tid);
        } else {
            sb.CURRENT_MADRASA_TENANT_ID = tid;
            sb.EMS_ACTIVE_TENANT_ID = tid;
            sb.EMS_TENANT_STORAGE_READY = true;
        }
        sb.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
    };

    sb.deliverCanonicalSnapshot = function (sourceTenantId, list) {
        var delivered = 0;
        (listenersByTenant[sourceTenantId] || []).forEach(function (e) {
            if (!e.alive || e.col !== 'ModuleData' || e.docId !== CANONICAL_DOC) return;
            e.cb(moduleDataSnapshot(list));
            delivered++;
        });
        return delivered;
    };

    sb.setCloudGet = function (tenantId, col, docId, doc) {
        cloudGets[tenantId + '::' + col + '/' + docId] = doc;
    };

    return sb;
}

describe('Phase 4 — TASK 4.1 cloud path audit (source lock)', function () {
    it('canonical live listener uses ModuleData/Attendance__ems_att_periods', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var block = att.slice(
            att.indexOf('window.emsStartAttendanceSync = function'),
            att.indexOf('window.emsStopAttendanceSync = stopAttendanceFirestoreSync')
        );
        expect(block).toContain('attTimetableCanonicalCloudRef');
        expect(block).toContain('attTimetableListFromCloudSnapshot');
        expect(block).not.toMatch(/attTenantSubCol\(db,\s*tenantId,\s*'Attendance_Config'\)/);
        expect(att).toContain("var ATT_PERIODS_CANONICAL_CLOUD_DOC = 'Attendance__ems_att_periods'");
    });

    it('writes still enqueue sync_module for ems_att_periods (ModuleData path)', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var enqueueBlock = att.slice(
            att.indexOf('function attEnqueueSyncModuleBlob'),
            att.indexOf('\nfunction attPersistConfigBlob')
        );
        expect(enqueueBlock).toContain("module: 'Attendance'");
        var sync = fs.readFileSync(path.join(ROOT, 'cloud/sync-engine.js'), 'utf8');
        expect(sync).toContain("'ems_att_periods': 'Attendance'");
        expect(sync).toMatch(/ModuleData.*doc\(module \+ '__' \+ key\)/);
    });

    it('legacy Attendance_Config/periods retained for migration only', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(att).toContain('attTimetableLegacyCloudRef');
        expect(att).toContain('attMigrateLegacyCloudTimetablePeriods');
        expect(att).toContain('ATT_PERIODS_LEGACY_CLOUD_COL');
    });
});

describe('Phase 4 — TASK 4.2 controlled canonicalization', function () {
    var env;

    beforeEach(function () {
        env = loadEnv();
        env.setBoth(TENANT_A);
    });

    function setTeacherRoster() {
        env.attGetUsers = function () {
            var users = [];
            for (var i = 1; i <= 47; i++) {
                users.push({ id: 'TCH-' + i, name: 'Teacher ' + i, type: 'teacher' });
            }
            return users;
        };
        env.attUserMatchesType = function (u, type) { return !!u && u.type === type; };
    }

    it('explicit cloud restore accepts the verified 102-period/47-teacher canonical document despite stale foreign local overlap', async function () {
        setTeacherRoster();
        var periods = [];
        for (var i = 1; i <= 102; i++) {
            periods.push({
                id: 'OWAIS-PRD-' + i,
                name: 'Period ' + i,
                teacherId: 'TCH-' + (((i - 1) % 47) + 1),
                teacherName: 'Teacher ' + (((i - 1) % 47) + 1),
                days: [1]
            });
        }
        env.setCloudGet(TENANT_A, 'ModuleData', CANONICAL_DOC, moduleDataSnapshot(periods));

        // Simulate historical contamination: the same ids also remain in a
        // different tenant's browser partition. Explicit verified restore must
        // not let that stale local cache overrule Tenant A's server document.
        env._emsOriginalSetItem(scopedKey(TENANT_B), JSON.stringify(periods));

        var res = await env.emsPullAttendanceTimetableFromCloud(TENANT_A);
        expect(res.ok).toBe(true);
        expect(res.count).toBe(102);
        expect(res.teacherCount).toBe(47);
        expect(res.source).toBe('manual_verified_canonical');
        expect(res.cloudPath).toBe('All_Madrasas/' + TENANT_A + '/ModuleData/' + CANONICAL_DOC);
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])).toHaveLength(102);
    });

    it('explicit cloud restore fails closed when requested tenant differs from verified tenant', async function () {
        env.setCloudGet(TENANT_B, 'ModuleData', CANONICAL_DOC, moduleDataSnapshot([{ id: 'B1' }]));
        var res = await env.emsPullAttendanceTimetableFromCloud(TENANT_B);
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('tenant_guard');
        expect(env.physical[scopedKey(TENANT_B)]).toBeFalsy();
    });

    it('live listener writes canonical ModuleData snapshot to tenant partition', async function () {
        setTeacherRoster();
        await env.emsStartAttendanceSync();
        expect(env.deliverCanonicalSnapshot(TENANT_A, [{
            id: 'P1', name: 'Period 1', teacherId: 'TCH-1', teacherName: 'Teacher 1', days: [1]
        }])).toBe(1);
        expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id).toBe('P1');
    });

    it('legacy Attendance_Config promotes to canonical when ModuleData empty', async function () {
        env.setCloudGet(TENANT_A, 'ModuleData', CANONICAL_DOC, { exists: false });
        env.setCloudGet(TENANT_A, 'Attendance_Config', 'periods', {
            exists: true,
            data: function () { return { list: [{ id: 'LEG', name: 'Legacy', days: [2] }] }; }
        });

        var res = await env.attMigrateLegacyCloudTimetablePeriods(TENANT_A, TENANT_A, null);
        expect(res.ok).toBe(true);
        expect(res.migrated).toBe(true);
        expect(res.count).toBe(1);
        expect(env._enqueued.length).toBeGreaterThan(0);
        expect(env._enqueued[0].key).toBe(PERIODS_KEY);
        expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();
    });

    it('legacy migration keeps shared-id timetable when roster matches both cloud copies', async function () {
        env.setCloudGet(TENANT_A, 'ModuleData', CANONICAL_DOC, {
            exists: true,
            data: function () {
                return {
                    key: PERIODS_KEY,
                    module: 'Attendance',
                    data: JSON.stringify([{ id: 'SAME', name: 'Canonical', className: 'Class-A', days: [1] }]),
                    updatedAt: { toMillis: function () { return Date.now(); } }
                };
            }
        });
        env.setCloudGet(TENANT_A, 'Attendance_Config', 'periods', {
            exists: true,
            data: function () {
                return {
                    list: [{ id: 'SAME', name: 'Legacy copy', className: 'Class-A', days: [1] }],
                    updatedAt: { toMillis: function () { return Date.now() - 60000; } }
                };
            }
        });
        env.localStorage.setItem('ems_classes', JSON.stringify([{ name: 'Class-A' }]));

        var res = await env.attMigrateLegacyCloudTimetablePeriods(TENANT_A, TENANT_A, null);
        expect(res.ok).toBe(true);
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id).toBe('SAME');
    });

    it('disjoint ModuleData vs Attendance_Config restores Attendance_Config even if migrated flag is set', async function () {
        env.setCloudGet(TENANT_A, 'ModuleData', CANONICAL_DOC, {
            exists: true,
            data: function () {
                return {
                    key: PERIODS_KEY,
                    module: 'Attendance',
                    data: JSON.stringify([{ id: 'FOREIGN-1', name: 'Leaked other madrasa', days: [1] }])
                };
            }
        });
        env.setCloudGet(TENANT_A, 'Attendance_Config', 'periods', {
            exists: true,
            data: function () {
                return { list: [{ id: 'OWN-1', name: 'This madrasa', days: [2] }] };
            }
        });
        env._emsOriginalSetItem.call(env.localStorage,
            'ems_t_' + TENANT_A + '__ems_timetable_cloud_legacy_migrated_v1', '1');

        var res = await env.attMigrateLegacyCloudTimetablePeriods(TENANT_A, TENANT_A, null);
        expect(res.ok).toBe(true);
        expect(res.migrated).toBe(true);
        expect(res.source).toBe('legacy_disjoint');
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id).toBe('OWN-1');
    });

    it('after disjoint restore, live ModuleData leak snapshot does not replace own timetable', async function () {
        env.setCloudGet(TENANT_A, 'ModuleData', CANONICAL_DOC, {
            exists: true,
            data: function () {
                return {
                    key: PERIODS_KEY,
                    module: 'Attendance',
                    data: JSON.stringify([{ id: 'FOREIGN-1', name: 'Leaked other madrasa', days: [1] }])
                };
            }
        });
        env.setCloudGet(TENANT_A, 'Attendance_Config', 'periods', {
            exists: true,
            data: function () {
                return { list: [{ id: 'OWN-1', name: 'This madrasa', days: [2] }] };
            }
        });

        await env.emsStartAttendanceSync();
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id).toBe('OWN-1');
        expect(env.deliverCanonicalSnapshot(TENANT_A, [{ id: 'FOREIGN-1', name: 'Leaked other madrasa', days: [1] }])).toBe(1);
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id).toBe('OWN-1');
    });

    it('attTimetableListFromCloudSnapshot parses ModuleData and legacy shapes', function () {
        var mod = env.attTimetableListFromCloudSnapshot(moduleDataSnapshot([{ id: 'M1' }]));
        expect(mod[0].id).toBe('M1');
        var legacy = env.attTimetableListFromCloudSnapshot({
            exists: true,
            data: function () { return { list: [{ id: 'L1' }] }; }
        });
        expect(legacy[0].id).toBe('L1');
    });
});
