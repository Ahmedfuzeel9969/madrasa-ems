import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var PERIODS_KEY = 'ems_att_periods';
var TENANT_A = 'madrasa-tenant-A';
var TENANT_B = 'madrasa-tenant-B';

function scopedKey(tenantId) {
    return 'ems_t_' + tenantId + '__' + PERIODS_KEY;
}

function parsePeriodList(raw) {
    if (raw == null) return null;
    try {
        var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
        return null;
    }
}

function summarizePeriodList(list) {
    list = list || [];
    var archived = list.filter(function (p) { return p && (p.archived === true || p.deleted === true); });
    return {
        count: list.length,
        active: list.length - archived.length,
        archived: archived.length,
        periodIds: list.map(function (p) { return p && p.id; }).filter(Boolean),
        teacherIds: list.map(function (p) { return p && p.teacherId; }).filter(Boolean),
        classNames: list.map(function (p) { return p && p.className; }).filter(Boolean)
    };
}

/** Read-only forensic map of every timetable copy (no writes, no deletes). */
function auditTimetableCopies(env, tenantId) {
    tenantId = tenantId || env.EMS_ACTIVE_TENANT_ID || env.CURRENT_MADRASA_TENANT_ID;
    var physical = env.physical || {};
    var idb = env._idb || {};
    var cloud = env._cloudModules || {};

    function inspectPhysical(key, label, attributable) {
        var raw = physical[key];
        var list = parsePeriodList(raw);
        return {
            label: label,
            key: key,
            exists: raw != null,
            attributable: attributable,
            summary: list ? summarizePeriodList(list) : null,
            rawLength: raw != null ? String(raw).length : 0
        };
    }

    var scoped = scopedKey(tenantId);
    return {
        tenantId: tenantId,
        scopedLocal: inspectPhysical(scoped, 'scoped localStorage', true),
        legacyGlobalLocal: inspectPhysical(PERIODS_KEY, 'legacy global localStorage', false),
        scopedIdb: {
            label: 'tenant-scoped IDB KV',
            key: scoped,
            exists: idb[scoped] != null,
            attributable: true,
            summary: parsePeriodList(idb[scoped]) ? summarizePeriodList(parsePeriodList(idb[scoped])) : null
        },
        globalIdb: {
            label: 'global IDB KV',
            key: PERIODS_KEY,
            exists: idb[PERIODS_KEY] != null,
            attributable: false,
            summary: parsePeriodList(idb[PERIODS_KEY]) ? summarizePeriodList(parsePeriodList(idb[PERIODS_KEY])) : null
        },
        cloudSyncModule: {
            label: 'cloud sync_module queue snapshot',
            key: PERIODS_KEY,
            exists: cloud[PERIODS_KEY] != null,
            attributable: tenantId != null,
            summary: parsePeriodList(cloud[PERIODS_KEY]) ? summarizePeriodList(parsePeriodList(cloud[PERIODS_KEY])) : null
        },
        cloudAttendanceConfig: {
            label: 'Firestore Attendance_Config/periods (simulated)',
            key: tenantId ? ('Attendance_Config/' + tenantId + '/periods') : null,
            exists: !!(env._cloudAttendanceConfig && env._cloudAttendanceConfig.list),
            attributable: !!tenantId,
            summary: env._cloudAttendanceConfig && env._cloudAttendanceConfig.list
                ? summarizePeriodList(env._cloudAttendanceConfig.list)
                : null
        },
        logicalReadViaWrapper: (function () {
            var raw = env.localStorage.getItem(PERIODS_KEY);
            var list = parsePeriodList(raw);
            return {
                label: 'logical localStorage.getItem(ems_att_periods)',
                exists: raw != null,
                summary: list ? summarizePeriodList(list) : null
            };
        })()
    };
}

/** Browser env with real core.js tenant localStorage wrapping + tenant resolver. */
function createTenantWrappedEnv() {
    var physical = Object.create(null);
    var idb = Object.create(null);
    var cloudModules = Object.create(null);

    function originalGetItem(key) {
        return Object.prototype.hasOwnProperty.call(physical, key) ? physical[key] : null;
    }
    function originalSetItem(key, value) {
        physical[key] = String(value);
    }

    var sandbox = {
        physical: physical,
        _idb: idb,
        _cloudModules: cloudModules,
        _cloudAttendanceConfig: null,
        _emsSuppressSync: false,
        console: console,
        Promise: Promise,
        document: {
            getElementById: function () { return null; },
            querySelectorAll: function () { return []; }
        },
        closeModal: function () {},
        attFillPeriodBookSelect: function () {},
        window: null,
        global: null,
        globalThis: null,
        attIndexAddKey: function () {},
        emsCacheInvalidate: function () {},
        emsInvalidateAttDashboardCache: function () {},
        emsIsLargeBlobKey: function () { return false; },
        emsIdbKvSet: function (key, val) {
            idb[key] = typeof val === 'string' ? val : JSON.stringify(val);
            return Promise.resolve(true);
        },
        emsIdbKvGet: function (key) {
            return Promise.resolve(idb[key] != null ? idb[key] : null);
        },
        emsOfflineEnqueueSyncModule: function (key, jsonStr) {
            cloudModules[key] = jsonStr;
            return Promise.resolve({ ok: true, synced: false, offline: true });
        },
        attEnqueueSyncModuleBlob: function (key, value) {
            var jsonStr = typeof value === 'string' ? value : JSON.stringify(value);
            return sandbox.emsOfflineEnqueueSyncModule(key, jsonStr);
        },
        generateID: function (prefix) { return prefix + '-TEST-1'; },
        showToast: function () {},
        confirm: function () { return true; },
        moveToRecycleBin: function () {},
        logAttAudit: function () {},
        attGetUsers: function () { return [{ id: 'TCH-A1', name: 'استاد A', type: 'teacher' }]; },
        attFilterEligibleUsers: function (list) { return list || []; },
        attUserMatchesType: function (u, t) {
            return String(u && u.type || '').toLowerCase() === String(t || '').toLowerCase();
        },
        attFindRegisterUser: function (id) { return null; },
        attGetUserId: function (u) { return u && (u.id || u.regId) ? String(u.id || u.regId) : ''; },
        attEnsureLibraryBook: function () {},
        attResolvePeriodBookName: function () { return 'کتاب'; },
        attRefreshPeriodUiAfterSave: function () {},
        attUpdatePeriodModalChrome: function () {},
        attResetPeriodForm: function () {},
        openModal: function () {},
        loadPeriodTeachers: function () {},
        setupPrintHeader: function () {},
        ATT_PERIODS_KEY: PERIODS_KEY,
        ATT_BOOK_ADD_NEW: '__ADD_NEW__',
        EMS_TENANT_LEGACY_MIGRATION_ALLOWED: true,
        getAttendanceTenantId: function () {
            return sandbox.EMS_ACTIVE_TENANT_ID || sandbox.CURRENT_MADRASA_TENANT_ID || null;
        }
    };

    sandbox._emsOriginalGetItem = originalGetItem;
    sandbox._emsOriginalSetItem = originalSetItem;
    sandbox._emsOriginalRemoveItem = function (key) { delete physical[key]; };

    sandbox.localStorage = {
        get length() { return Object.keys(physical).length; },
        key: function (i) { return Object.keys(physical)[i] || null; },
        getItem: function (key) {
            var resolved = sandbox.emsResolveCacheKey ? sandbox.emsResolveCacheKey(key) : key;
            return resolved ? originalGetItem(resolved) : null;
        },
        setItem: function (key, value) {
            var resolved = sandbox.emsResolveCacheKey ? sandbox.emsResolveCacheKey(key) : key;
            if (!resolved) return;
            originalSetItem(resolved, value);
        },
        removeItem: function (key) {
            var resolved = sandbox.emsResolveCacheKey ? sandbox.emsResolveCacheKey(key) : key;
            if (resolved) delete physical[resolved];
        }
    };

    sandbox.window = sandbox;
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8'), sandbox);

    vm.runInNewContext(
        fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8').slice(
            fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8').indexOf('function resolveOfflinePhysicalKey'),
            fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8').indexOf('global.emsAttCloudDocId = function')
        ) + '\nthis.emsOfflineWriteLocalSync = global.emsOfflineWriteLocalSync;',
        sandbox
    );

    var attSrc = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var periodStart = attSrc.indexOf('function attReadTimetablePeriods');
    var periodEnd = attSrc.indexOf('\nfunction attIsTeacherRegister');
    var enqueueStart = attSrc.indexOf('function attEnqueueSyncModuleBlob');
    var enqueueEnd = attSrc.indexOf('\n/** Local persist + Firestore outbox');
    var persistStart = attSrc.indexOf('/** Local persist + Firestore outbox');
    var persistEnd = attSrc.indexOf('\nfunction attParseTimetablePeriodList');
    var recoveryStart = attSrc.indexOf('function attParseTimetablePeriodList');
    var recoveryEnd = attSrc.indexOf('\nwindow.attRecoverLegacyTimetablePeriods');
    var saveModalStart = attSrc.indexOf('function attSavePeriodFromModal');
    var saveModalEnd = attSrc.indexOf('\nfunction attRemovePeriodById');
    var removeStart = attSrc.indexOf('function attRemovePeriodById');
    var removeEnd = attSrc.indexOf('\nwindow.attOpenNewPeriodModal');

    vm.runInNewContext(
        'var ATT_PERIODS_KEY = \'ems_att_periods\';'
        + 'function getAttendanceTenantId(){ return EMS_ACTIVE_TENANT_ID || CURRENT_MADRASA_TENANT_ID || null; }'
        + attSrc.slice(periodStart, periodEnd)
        + '\n' + attSrc.slice(enqueueStart, enqueueEnd)
        + '\n' + attSrc.slice(persistStart, persistEnd)
        + '\n' + attSrc.slice(recoveryStart, recoveryEnd)
        + '\n' + attSrc.slice(saveModalStart, saveModalEnd)
        + '\n' + attSrc.slice(removeStart, removeEnd)
        + '\nthis.attReadAllTimetablePeriodsRaw = attReadAllTimetablePeriodsRaw;'
        + '\nthis.attReadTimetablePeriods = attReadTimetablePeriods;'
        + '\nthis.attSaveTimetablePeriodsSync = attSaveTimetablePeriodsSync;'
        + '\nthis.attPersistConfigBlob = attPersistConfigBlob;'
        + '\nthis.attRecoverLegacyTimetablePeriods = attRecoverLegacyTimetablePeriods;'
        + '\nthis.attSavePeriodFromModal = attSavePeriodFromModal;'
        + '\nthis.attRemovePeriodById = attRemovePeriodById;'
        + '\nthis.attActiveTimetablePeriods = attActiveTimetablePeriods;'
        + '\nthis.attHydrateTimetablePeriods = attHydrateTimetablePeriods;'
        + '\nthis.attIsPeriodArchived = attIsPeriodArchived;'
        + '\nthis.attMigrateLegacyPeriodTeacherIds = attMigrateLegacyPeriodTeacherIds;'
        + '\nthis.attCollectRegisteredTeachers = attCollectRegisteredTeachers;'
        + '\nthis.attNormalizeTeacherDisplayName = attNormalizeTeacherDisplayName;'
        + '\nthis.attPeriodTeacherIdMatches = attPeriodTeacherIdMatches;'
        + '\nthis.attFindUniqueTeacherIdByName = attFindUniqueTeacherIdByName;',
        sandbox
    );

    sandbox.setActiveTenant = function (tenantId) {
        sandbox.EMS_ACTIVE_TENANT_ID = tenantId;
        sandbox.CURRENT_MADRASA_TENANT_ID = tenantId;
        sandbox.EMS_TENANT_STORAGE_READY = true;
    };

    sandbox.seedLegacyOnlyPeriod = function (tenantId, period) {
        physical[PERIODS_KEY] = JSON.stringify([period]);
    };

    sandbox.makePeriodFormDom = function (overrides) {
        overrides = overrides || {};
        var values = Object.assign({
            'new-period-name': 'سبق اول',
            'new-period-class': 'درس اول',
            'new-period-location': 'کمرہ 1',
            'new-period-start': '08:00',
            'new-period-end': '09:00',
            'new-period-teacher': 'TCH-A1',
            'new-period-book': 'کتاب'
        }, overrides);
        sandbox.document.getElementById = function (id) {
            if (Object.prototype.hasOwnProperty.call(values, id)) {
                return { value: values[id], selectedIndex: 0, options: [{ text: 'استاد A' }] };
            }
            return null;
        };
        sandbox.document.querySelectorAll = function (sel) {
            if (sel === '#new-period-days input:checked') {
                return [{ value: '1' }];
            }
            return [];
        };
    };

    return sandbox;
}

describe('Phase 1 — timetable forensic audit (TASK 1.1)', function () {
    it('maps scoped, legacy, IDB, and cloud copies without mutating storage', function () {
        var env = createTenantWrappedEnv();
        env.setActiveTenant(TENANT_A);
        env.seedLegacyOnlyPeriod(TENANT_A, {
            id: 'PRD-LEGACY-1',
            name: 'Legacy Period',
            teacherId: 'TCH-A1',
            className: 'درس اول',
            days: [1]
        });
        env._cloudAttendanceConfig = { list: [{ id: 'PRD-CLOUD-1', name: 'Cloud Period', teacherId: 'TCH-A1' }] };

        var audit = auditTimetableCopies(env, TENANT_A);

        expect(audit.scopedLocal.exists).toBe(false);
        expect(audit.legacyGlobalLocal.exists).toBe(true);
        expect(audit.legacyGlobalLocal.summary.count).toBe(1);
        expect(audit.legacyGlobalLocal.summary.periodIds).toContain('PRD-LEGACY-1');
        expect(audit.logicalReadViaWrapper.exists).toBe(false);
        expect(audit.cloudAttendanceConfig.exists).toBe(true);

        expect(audit.scopedLocal.key).toBe(scopedKey(TENANT_A));
        expect(audit.legacyGlobalLocal.attributable).toBe(false);
        expect(audit.scopedLocal.attributable).toBe(true);
    });

    it('source confirms timetable writes use tenant resolver, not raw logical key', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var saveBlock = att.slice(att.indexOf('function attSaveTimetablePeriodsSync'), att.indexOf('\nfunction attNormalizeTeacherDisplayName'));
        expect(saveBlock).not.toContain('_emsOriginalSetItem.call(localStorage, \'ems_att_periods\'');
        expect(saveBlock).toContain('attPersistConfigBlob');

        var offline = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        var syncBlock = offline.slice(offline.indexOf('function resolveOfflinePhysicalKey'), offline.indexOf('global.emsAttCloudDocId = function'));
        expect(syncBlock).toContain('emsResolvePhysicalWriteKey');
        expect(syncBlock).toContain('_emsOriginalSetItem.call(localStorage, physicalKey');
        expect(syncBlock).toContain('emsIdbKvSet(physicalKey, str)');

        var cloudPull = att.slice(att.indexOf('var canonCloudRef = attTimetableCanonicalCloudRef'), att.indexOf('if (window.currentAttState && window.currentAttState.dbKey'));
        expect(cloudPull).not.toContain('_emsOriginalSetItem.call(localStorage, \'ems_att_periods\'');
        expect(cloudPull).toContain('emsOfflineWriteLocalSync');
    });
});

describe('Phase 2 — canonical tenant-scoped timetable writes', function () {
    it('save writes scoped partition; reload returns same period', function () {
        var env = createTenantWrappedEnv();
        env.setActiveTenant(TENANT_A);
        env.makePeriodFormDom();
        env.attSavePeriodFromModal({ closeAfter: true });

        expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();
        expect(env.physical[PERIODS_KEY]).toBeFalsy();
        expect(env._idb[scopedKey(TENANT_A)]).toBeTruthy();
        expect(env._idb[PERIODS_KEY]).toBeFalsy();
        expect(env.attReadTimetablePeriods().length).toBe(1);
    });

    it('no verified tenant fails closed — no global fallback write', function () {
        var env = createTenantWrappedEnv();
        env.EMS_ACTIVE_TENANT_ID = null;
        env.CURRENT_MADRASA_TENANT_ID = null;
        env.EMS_TENANT_STORAGE_READY = false;
        env.makePeriodFormDom();
        env.attSavePeriodFromModal({ closeAfter: true });

        expect(env.physical[PERIODS_KEY]).toBeFalsy();
        expect(env.attReadTimetablePeriods().length).toBe(0);
    });
});

describe('Phase 2 — timetable tenant partition regression', function () {
    var env;

    beforeEach(function () {
        env = createTenantWrappedEnv();
        env.setActiveTenant(TENANT_A);
        env.makePeriodFormDom();
    });

    it('Tenant A save must write ems_t_A__ems_att_periods and reload the same period', function () {
        env.attSavePeriodFromModal({ closeAfter: true });

        var scopedRaw = env.physical[scopedKey(TENANT_A)];
        var legacyRaw = env.physical[PERIODS_KEY];
        expect(scopedRaw).toBeTruthy();
        expect(JSON.parse(scopedRaw)[0].id).toBe('PRD-TEST-1');
        expect(legacyRaw).toBeFalsy();

        var reloaded = env.attReadTimetablePeriods();
        expect(reloaded.length).toBe(1);
        expect(reloaded[0].name).toBe('سبق اول');
    });

    it('Tenant B cannot see Tenant A periods; each tenant gets its own physical key', function () {
        env.attSavePeriodFromModal({ closeAfter: true });
        expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();

        env.setActiveTenant(TENANT_B);
        env.makePeriodFormDom({ 'new-period-name': 'B Period', 'new-period-class': 'B Class' });
        env.attSavePeriodFromModal({ closeAfter: true });

        expect(env.physical[scopedKey(TENANT_B)]).toBeTruthy();
        expect(env.attReadTimetablePeriods().length).toBe(1);
        expect(env.attReadTimetablePeriods()[0].name).toBe('B Period');
        expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();

        env.setActiveTenant(TENANT_A);
        var back = env.attReadTimetablePeriods();
        expect(back.length).toBe(1);
        expect(back[0].name).toBe('سبق اول');
    });

    it('edit and soft archive survive reload simulation', function () {
        env.attSavePeriodFromModal({ closeAfter: true });
        var pid = JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id;

        env._attEditingPeriodId = pid;
        env.makePeriodFormDom({ 'new-period-name': 'Edited Period' });
        env.attSavePeriodFromModal({ closeAfter: true });

        expect(env.attReadTimetablePeriods()[0].name).toBe('Edited Period');

        env.attRemovePeriodById(pid);
        expect(env.attReadTimetablePeriods().length).toBe(0);

        var raw = JSON.parse(env.physical[scopedKey(TENANT_A)]);
        expect(raw.length).toBe(1);
        expect(raw[0].archived).toBe(true);
        expect(env.attHydrateTimetablePeriods().length).toBe(1);
    });

    it('linked madrasa tenant resolves timetable partition, not personal auth uid', function () {
        env.CURRENT_MADRASA_TENANT_ID = TENANT_A;
        env.EMS_ACTIVE_TENANT_ID = null;
        env.firebase = { auth: function () { return { currentUser: { uid: 'personal-auth-uid' } }; } };
        env.getAttendanceTenantId = function () { return env.CURRENT_MADRASA_TENANT_ID; };

        env.attSavePeriodFromModal({ closeAfter: true });
        expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();
        expect(env.physical[scopedKey('personal-auth-uid')]).toBeFalsy();
    });

    it('no verified tenant fails closed — no global fallback write', function () {
        env.EMS_ACTIVE_TENANT_ID = null;
        env.CURRENT_MADRASA_TENANT_ID = null;
        env.EMS_TENANT_STORAGE_READY = false;

        env.attSavePeriodFromModal({ closeAfter: true });
        expect(env.physical[PERIODS_KEY]).toBeFalsy();
        expect(Object.keys(env.physical).some(function (k) { return k.indexOf('ems_t_') === 0 && k.indexOf(PERIODS_KEY) >= 0; })).toBe(false);
        expect(env.attReadTimetablePeriods().length).toBe(0);
    });

    it('legacy global key is not active SSOT when scoped partition is empty', function () {
        env.seedLegacyOnlyPeriod(TENANT_A, {
            id: 'PRD-HIDDEN',
            name: 'Hidden Legacy',
            teacherId: 'TCH-A1',
            className: 'X',
            days: [1]
        });
        expect(env.physical[PERIODS_KEY]).toBeTruthy();
        expect(env.physical[scopedKey(TENANT_A)]).toBeFalsy();
        expect(env.attReadTimetablePeriods().length).toBe(0);
    });

    it('attPersistConfigBlob IDB uses same tenant partition as localStorage read path', function () {
        env.attSavePeriodFromModal({ closeAfter: true });
        expect(env._idb[scopedKey(TENANT_A)]).toBeTruthy();
        expect(env._idb[PERIODS_KEY]).toBeFalsy();
    });

    it('legacy recovery copies provably-owned global periods into scoped partition idempotently', function () {
        env.seedLegacyOnlyPeriod(TENANT_A, {
            id: 'PRD-RECOVER-1',
            name: 'Recovered Period',
            teacherId: 'TCH-A1',
            className: 'درس اول',
            days: [1]
        });
        expect(env.attReadTimetablePeriods().length).toBe(0);

        return env.attRecoverLegacyTimetablePeriods(TENANT_A).then(function (report) {
            expect(report.ok).toBe(true);
            expect(report.copied).toBe(1);
            expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();
            expect(env.physical[PERIODS_KEY]).toBeTruthy();
            expect(env.attReadTimetablePeriods().length).toBe(1);
            expect(env.attReadTimetablePeriods()[0].id).toBe('PRD-RECOVER-1');

            return env.attRecoverLegacyTimetablePeriods(TENANT_A).then(function (again) {
                expect(again.copied).toBe(0);
                expect(env.attReadTimetablePeriods().length).toBe(1);
            });
        });
    });

    it('legacy recovery blocked when tenant ownership not provable', function () {
        env.EMS_TENANT_LEGACY_MIGRATION_ALLOWED = false;
        env.seedLegacyOnlyPeriod(TENANT_A, {
            id: 'PRD-QUARANTINE',
            name: 'Unknown Owner',
            teacherId: 'TCH-A1',
            days: [1]
        });
        return env.attRecoverLegacyTimetablePeriods(TENANT_A).then(function (report) {
            expect(report.ok).toBe(false);
            expect(report.reason).toBe('LEGACY_NOT_ATTRIBUTABLE');
            expect(env.physical[scopedKey(TENANT_A)]).toBeFalsy();
        });
    });
});
