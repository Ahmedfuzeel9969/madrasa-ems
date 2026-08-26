import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var PERIODS_KEY = 'ems_att_periods';
var TENANT_A = 'madrasa-A';
var TENANT_B = 'madrasa-B';

function scopedKey(tid) {
    return 'ems_t_' + tid + '__' + PERIODS_KEY;
}

function loadIntegrationEnv() {
    var physical = Object.create(null);
    var idb = Object.create(null);
    var cloudQueue = [];

    function originalGetItem(key) {
        return Object.prototype.hasOwnProperty.call(physical, key) ? physical[key] : null;
    }
    function originalSetItem(key, value) {
        physical[key] = String(value);
    }

    var sb = {
        physical: physical,
        _idb: idb,
        _cloudQueue: cloudQueue,
        console: console,
        Promise: Promise,
        document: {
            getElementById: function () { return null; },
            querySelectorAll: function () { return [] }
        },
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
        emsOfflineEnqueueSyncModule: function (key, jsonStr, opts) {
            cloudQueue.push({ key: key, value: jsonStr, tenantId: opts && opts.tenantId });
            return Promise.resolve({ ok: true, offline: true });
        },
        generateID: function (p) { return p + '-ID-1'; },
        showToast: function () {},
        confirm: function () { return true; },
        moveToRecycleBin: function () {},
        logAttAudit: function () {},
        attGetUsers: function () { return [{ id: 'T1', name: 'استاد', type: 'teacher' }]; },
        attFilterEligibleUsers: function (l) { return l || []; },
        attUserMatchesType: function (u, t) {
            return String(u && u.type || '').toLowerCase() === String(t || '').toLowerCase();
        },
        attFindRegisterUser: function () { return null; },
        attGetUserId: function (u) { return u && (u.id || u.regId) || ''; },
        attEnsureLibraryBook: function () {},
        attResolvePeriodBookName: function () { return 'کتاب'; },
        attRefreshPeriodUiAfterSave: function () {},
        attResetPeriodForm: function () {},
        attUpdatePeriodModalChrome: function () {},
        closeModal: function () {},
        attFillPeriodBookSelect: function () {},
        EMS_TENANT_LEGACY_MIGRATION_ALLOWED: true,
        currentAttState: { periodRecords: {} }
    };

    sb._emsOriginalGetItem = originalGetItem;
    sb._emsOriginalSetItem = originalSetItem;
    sb.localStorage = {
        getItem: function (key) {
            var resolved = sb.emsResolveCacheKey ? sb.emsResolveCacheKey(key) : key;
            return resolved ? originalGetItem(resolved) : null;
        },
        setItem: function (key, value) {
            var resolved = sb.emsResolveCacheKey ? sb.emsResolveCacheKey(key) : key;
            if (resolved) originalSetItem(resolved, value);
        }
    };
    sb.window = sb;
    sb.global = sb;
    sb.globalThis = sb;
    sb.getAttendanceTenantId = function () {
        return sb.EMS_ACTIVE_TENANT_ID || sb.CURRENT_MADRASA_TENANT_ID || null;
    };

    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8'), sb);
    vm.runInNewContext(
        fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8').slice(
            fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8').indexOf('function resolveOfflinePhysicalKey'),
            fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8').indexOf('global.emsAttCloudDocId = function')
        ) + '\nthis.emsOfflineWriteLocalSync = global.emsOfflineWriteLocalSync;',
        sb
    );

    var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var slice = att.slice(
        att.indexOf('function attReadTimetablePeriods'),
        att.indexOf('\nfunction attIsTeacherRegister')
    )
        + att.slice(att.indexOf('function attTimetableCanonicalCloudRef'), att.indexOf('\nfunction attEnqueueSyncModuleBlob'))
        + att.slice(att.indexOf('function attEnqueueSyncModuleBlob'), att.indexOf('\nfunction attReadHolidaysDb'))
        + att.slice(att.indexOf('function attSavePeriodFromModal'), att.indexOf('\nfunction attRemovePeriodById'))
        + att.slice(att.indexOf('function attRemovePeriodById'), att.indexOf('\nwindow.attOpenNewPeriodModal'));

    vm.runInNewContext(
        'var ATT_PERIODS_KEY = \'ems_att_periods\'; var ATT_SYMBOLS_KEY = \'ems_att_symbols\';'
        + 'var ATT_HOLIDAYS_KEY = \'ems_att_holidays\'; var ATT_SETTINGS_KEY = \'ems_att_settings\';'
        + 'var ATT_BOOK_ADD_NEW = \'__ADD_NEW__\';'
        + 'function getAttendanceTenantId(){ return EMS_ACTIVE_TENANT_ID || CURRENT_MADRASA_TENANT_ID || null; }'
        + slice
        + '\nthis.attReadAllTimetablePeriodsRaw=attReadAllTimetablePeriodsRaw;'
        + '\nthis.attReadTimetablePeriods=attReadTimetablePeriods;'
        + '\nthis.attSaveTimetablePeriodsSync=attSaveTimetablePeriodsSync;'
        + '\nthis.attPersistConfigBlob=attPersistConfigBlob;'
        + '\nthis.attRecoverLegacyTimetablePeriods=attRecoverLegacyTimetablePeriods;'
        + '\nthis.attSavePeriodFromModal=attSavePeriodFromModal;'
        + '\nthis.attRemovePeriodById=attRemovePeriodById;'
        + '\nthis.attHydrateTimetablePeriods=attHydrateTimetablePeriods;'
        + '\nthis.attResolvePeriodById=attResolvePeriodById;'
        + '\nthis.attTeacherPeriodsForRegisterDay=attTeacherPeriodsForRegisterDay;'
        + '\nthis.attIsPeriodArchived=attIsPeriodArchived;',
        sb
    );

    sb.activate = function (tid) {
        sb.EMS_ACTIVE_TENANT_ID = tid;
        sb.CURRENT_MADRASA_TENANT_ID = tid;
        sb.EMS_TENANT_STORAGE_READY = true;
    };
    sb.form = function (overrides) {
        overrides = overrides || {};
        var v = Object.assign({
            'new-period-name': 'Period',
            'new-period-class': 'Class A',
            'new-period-start': '08:00',
            'new-period-end': '09:00',
            'new-period-teacher': 'T1',
            'new-period-book': 'Book'
        }, overrides);
        sb.document.getElementById = function (id) {
            if (v[id] != null) return { value: v[id], selectedIndex: 0, options: [{ text: 'T' }] };
            return null;
        };
        sb.document.querySelectorAll = function (sel) {
            return sel === '#new-period-days input:checked' ? [{ value: '1' }] : [];
        };
    };
    sb.simulateHardReload = function () {
        sb._runtime = Object.create(null);
    };
    return sb;
}

describe('Phase 3 — timetable integration verification (TASK 3.1)', function () {
    var env;

    beforeEach(function () {
        env = loadIntegrationEnv();
        env.activate(TENANT_A);
        env.form();
    });

    it('1-3: add, edit, archive survive reload simulation', function () {
        env.attSavePeriodFromModal({ closeAfter: true });
        expect(env.attReadTimetablePeriods().length).toBe(1);

        env._attEditingPeriodId = 'PRD-ID-1';
        env.form({ 'new-period-name': 'Edited' });
        env.attSavePeriodFromModal({ closeAfter: true });
        expect(env.attReadTimetablePeriods()[0].name).toBe('Edited');

        env.attRemovePeriodById('PRD-ID-1');
        expect(env.attReadTimetablePeriods().length).toBe(0);
        expect(env.attHydrateTimetablePeriods()[0].archived).toBe(true);
    });

    it('4-5: hard refresh / browser restart — scoped physical + IDB remain SSOT', function () {
        env.attSavePeriodFromModal({ closeAfter: true });
        var scoped = scopedKey(TENANT_A);
        expect(env.physical[scoped]).toBeTruthy();
        expect(env._idb[scoped]).toBeTruthy();
        env.simulateHardReload();
        expect(JSON.parse(env.physical[scoped]).length).toBe(1);
        expect(env.attReadTimetablePeriods().length).toBe(1);
    });

    it('6-7: offline write persists locally; cloud queue carries tenantId', function () {
        return env.attPersistConfigBlob(PERIODS_KEY, [{ id: 'P1', name: 'X', days: [1] }]).then(function () {
            expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();
            expect(env._cloudQueue.length).toBe(1);
            expect(env._cloudQueue[0].tenantId).toBe(TENANT_A);
            expect(env._cloudQueue[0].key).toBe(PERIODS_KEY);
        });
    });

    it('8-9: tenant A/B isolation and return to A', function () {
        env.attSavePeriodFromModal({ closeAfter: true });
        env.activate(TENANT_B);
        env.form({ 'new-period-name': 'B only' });
        env.attSavePeriodFromModal({ closeAfter: true });
        expect(env.attReadTimetablePeriods()[0].name).toBe('B only');
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].name).not.toBe('B only');

        env.activate(TENANT_A);
        expect(env.attReadTimetablePeriods()[0].name).toBe('Period');
    });

    it('10-11: linked madrasa tenant partition — not personal auth uid', function () {
        env.EMS_ACTIVE_TENANT_ID = null;
        env.CURRENT_MADRASA_TENANT_ID = TENANT_A;
        env.attSavePeriodFromModal({ closeAfter: true });
        expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();
        expect(env.physical[scopedKey('personal-uid')]).toBeFalsy();
    });

    it('12-13: Smart Register resolves archived period IDs from periodRecords', function () {
        var archived = [{ id: 'PRD-HIST', name: 'Old', teacherId: 'T1', days: [1], archived: true, archivedAt: 1 }];
        env.attSaveTimetablePeriodsSync(archived);
        env.currentAttState.periodRecords = { T1: { '5': { 'PRD-HIST': 'P' } } };
        var boxes = env.attTeacherPeriodsForRegisterDay('T1', '', '5', 1);
        expect(boxes.some(function (p) { return p.id === 'PRD-HIST'; })).toBe(true);
    });

    it('17-18: legacy recovery merges safely; unknown owner quarantined', function () {
        env.physical[PERIODS_KEY] = JSON.stringify([{ id: 'LEG-1', name: 'Legacy', teacherId: 'T1', days: [1] }]);
        return env.attRecoverLegacyTimetablePeriods(TENANT_A).then(function (r) {
            expect(r.copied).toBe(1);
            expect(env.attReadTimetablePeriods().length).toBe(1);
            expect(env.physical[PERIODS_KEY]).toBeTruthy();
        }).then(function () {
            env.EMS_TENANT_LEGACY_MIGRATION_ALLOWED = false;
            env.physical[PERIODS_KEY] = JSON.stringify([{ id: 'UNK-1', name: 'Unknown', days: [1] }]);
            return env.attRecoverLegacyTimetablePeriods(TENANT_A).then(function (q) {
                expect(q.reason).toBe('LEGACY_NOT_ATTRIBUTABLE');
            });
        });
    });
});

describe('Phase 3 — cross-module + config audit (TASK 3.1 items 14-20)', function () {
    it('14-15: dashboard and metrics read timetable via scoped localStorage.getItem', function () {
        var dash = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        var metrics = fs.readFileSync(path.join(ROOT, 'att-metrics.js'), 'utf8');
        expect(dash).toContain('attReadTimetablePeriods');
        expect(dash).toContain("localStorage.getItem('ems_att_periods')");
        expect(metrics).toContain('attReadAllTimetablePeriodsRaw');
        expect(metrics).toContain("localStorage.getItem('ems_att_periods')");
        expect(dash).not.toMatch(/_emsOriginalSetItem[\s\S]{0,80}ems_att_periods/);
    });

    it('16: exams and curriculum linkage reads logical ems_att_periods (tenant-wrapped)', function () {
        var exams = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        var curriculum = fs.readFileSync(path.join(ROOT, 'curriculum.js'), 'utf8');
        expect(exams).toContain("localStorage.getItem('ems_att_periods'");
        expect(curriculum).toContain("localStorage.getItem('ems_att_periods')");
        expect(exams).not.toMatch(/_emsOriginalSetItem[\s\S]{0,120}ems_att_periods/);
    });

    it('19-20: attendance config writes use attPersistConfigBlob; no raw global SSOT writes', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var offline = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');

        expect(att).toMatch(/attPersistConfigBlob\(ATT_SETTINGS_KEY/);
        expect(att).toMatch(/attPersistConfigBlob\('ems_att_symbols'/);
        expect(att).toMatch(/attPersistConfigBlob\(ATT_HOLIDAYS_KEY/);
        expect(att).not.toMatch(/_emsOriginalSetItem\.call\(localStorage, 'ems_att_periods'/);
        expect(att).not.toMatch(/_emsOriginalSetItem\.call\(localStorage, 'ems_att_symbols'/);
        expect(att).not.toMatch(/_emsOriginalSetItem\.call\(localStorage, 'ems_att_settings'/);
        expect(att).not.toMatch(/_emsOriginalSetItem\.call\(localStorage, 'ems_att_holidays'/);

        expect(offline).toContain('emsResolvePhysicalWriteKey');
        expect(offline).toContain('_emsOriginalSetItem.call(localStorage, physicalKey');
    });

    it('config blobs resolve to tenant partition (symbols/holidays/settings)', function () {
        var env = loadIntegrationEnv();
        env.activate(TENANT_A);
        env.emsOfflineWriteLocalSync('ems_att_symbols', { P: 'P', A: 'A', L: 'L' });
        env.emsOfflineWriteLocalSync('ems_att_holidays', [{ date: '2026-01-01' }]);
        env.emsOfflineWriteLocalSync('ems_att_settings', { name: 'Test Madrasa' });
        expect(env.physical['ems_t_' + TENANT_A + '__ems_att_symbols']).toBeTruthy();
        expect(env.physical['ems_t_' + TENANT_A + '__ems_att_holidays']).toBeTruthy();
        expect(env.physical['ems_t_' + TENANT_A + '__ems_att_settings']).toBeTruthy();
        expect(env.physical['ems_att_symbols']).toBeFalsy();
    });
});
