import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

var PERIOD_ONLY_SHEET = {
    locked: false,
    dailyLocks: {},
    remarks: {},
    late: {},
    periodRecords: {
        'teacher-uid-1': {
            '5': { 'period-1': 'P' }
        }
    }
};

var PERIOD_ONLY_WITH_EMPTY_RECORDS = Object.assign({}, PERIOD_ONLY_SHEET, { records: {} });

function loadMeaningfulHelpersFromPhase2() {
    var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var pruneStart = src.indexOf('function attPrunePeriodRecordsMap');
    var pruneEnd = src.indexOf('\nvar ATT_ROLLUP_PARTIAL');
    var emptyStart = src.indexOf('function attEmptyAttendanceRecord');
    var reconcileEnd = src.indexOf('\nfunction attApplyAttendanceState');
    var fnSrc = src.slice(pruneStart, pruneEnd) + '\n' + src.slice(emptyStart, reconcileEnd);
    var sandbox = {};
    vm.runInNewContext(fnSrc + '\nthis.attHasMeaningfulAttendanceData = attHasMeaningfulAttendanceData;', sandbox);
    return sandbox;
}

function loadSheetKeyHelpers() {
    var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var keysStart = src.indexOf('function attSheetKeys');
    var keysEnd = src.indexOf('\nfunction attLastSessionStorageKey');
    var fnSrc = src.slice(keysStart, keysEnd);
    var normStart = src.indexOf('function attNormalizeStorageScope');
    var normEnd = src.indexOf('\nfunction attSheetKeys');
    fnSrc = src.slice(normStart, normEnd) + '\n' + fnSrc;
    var sandbox = {
        window: {},
        localStorage: {
            _data: { ems_att_canonical_unified: '1' },
            getItem: function (k) { return this._data[k] || null; },
            setItem: function (k, v) { this._data[k] = String(v); }
        },
        getAttendanceTenantId: function () { return 'tenant1'; },
        emsAttCloudDocId: function (month, type, classId, period) {
            return 'att_rec_' + month + '_' + type + '_' + classId + '_' + (period || 'all');
        },
        emsAttLocalStorageKey: function (tenantId, month, type, classId, period) {
            var tid = tenantId || 'tenant1';
            return 'att_rec_' + tid + '_' + month + '_' + type + '_' + classId + '_' + (period || 'all');
        }
    };
    sandbox.window = sandbox;
    vm.runInNewContext(
        fnSrc
        + '\nthis.attSheetKeys = attSheetKeys;'
        + '\nthis.attResolveSheetKeys = attResolveSheetKeys;'
        + '\nthis.attNormalizeStorageScope = attNormalizeStorageScope;',
        sandbox
    );
    return sandbox;
}

function loadHelperSheetReader() {
    var src = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
    var sandbox = {
        global: {},
        window: {},
        Promise: Promise,
        firebase: { auth: function () { return { currentUser: null }; } },
        localStorage: { getItem: function () { return null; } },
        CURRENT_MADRASA_TENANT_ID: 'tenant1',
        getDbOrNull: function () { return {}; },
        emsIsNetworkAvailable: function () { return true; },
        navigator: { onLine: true },
        emsCacheGet: function () { return null; },
        emsCacheGetRaw: function () { return null; },
        emsIdbKvGet: function () { return Promise.resolve(null); }
    };
    sandbox.global = sandbox;
    sandbox.window = sandbox;
    vm.runInNewContext(src, sandbox);
    return sandbox.global;
}

describe('Phase 0 — teacher/staff canonical key stability (TASK 0.1)', function () {
    it('teacher: stale Class-A then empty class must resolve to the same cloud doc id', function () {
        var sb = loadSheetKeyHelpers();
        var withClass = sb.attResolveSheetKeys('2026-08', 'teachers', 'Class-A', 'period-1');
        var emptyClass = sb.attResolveSheetKeys('2026-08', 'teachers', '', 'all');
        expect(withClass.cloudDocId).toBe(emptyClass.cloudDocId);
        expect(withClass.localKey).toBe(emptyClass.localKey);
    });

    it('staff: stale Class-A then empty class must resolve to the same cloud doc id', function () {
        var sb = loadSheetKeyHelpers();
        var withClass = sb.attResolveSheetKeys('2026-08', 'staff', 'Class-A', 'period-1');
        var emptyClass = sb.attResolveSheetKeys('2026-08', 'staff', '', 'all');
        expect(withClass.cloudDocId).toBe(emptyClass.cloudDocId);
        expect(withClass.localKey).toBe(emptyClass.localKey);
    });

    it('documents canonical teacher keys are identical regardless of stale classId', function () {
        var sb = loadSheetKeyHelpers();
        var withClass = sb.attResolveSheetKeys('2026-08', 'teachers', 'Class-A', 'period-1');
        var emptyClass = sb.attResolveSheetKeys('2026-08', 'teachers', '', 'all');
        expect(withClass.cloudDocId).toBe('att_rec_2026-08_teachers__all');
        expect(emptyClass.cloudDocId).toBe('att_rec_2026-08_teachers__all');
        expect(withClass.cloudDocId).toBe(emptyClass.cloudDocId);
    });
});

describe('Phase 0 — periodRecords-only meaningful data (TASK 0.2)', function () {
    it('attHasMeaningfulAttendanceData treats periodRecords-only sheet as meaningful', function () {
        var h = loadMeaningfulHelpersFromPhase2();
        expect(h.attHasMeaningfulAttendanceData(PERIOD_ONLY_SHEET)).toBe(true);
    });

    it('attReadSheetByKeyAsync returns periodRecords-only sheet from IDB when records key is absent', function () {
        var helper = loadHelperSheetReader();
        helper.attHasMeaningfulAttendanceData = function (sheet) {
            if (!sheet || typeof sheet !== 'object') return false;
            return Object.keys(sheet.periodRecords || {}).length > 0;
        };
        var key = 'att_rec_tenant1_2026-08_teachers__all';
        helper.emsIdbKvGet = function () {
            return Promise.resolve(JSON.stringify(PERIOD_ONLY_SHEET));
        };
        return helper.emsAttReadSheetByKeyAsync(key).then(function (sheet) {
            expect(sheet).not.toBeNull();
            expect(sheet.periodRecords['teacher-uid-1']['5']['period-1']).toBe('P');
        });
    });

    it('attReadSheetByKeyAsync returns periodRecords-only sheet from emsCacheGet when records is empty object', function () {
        var helper = loadHelperSheetReader();
        helper.attHasMeaningfulAttendanceData = function (sheet) {
            return !!(sheet && Object.keys(sheet.periodRecords || {}).length);
        };
        var key = 'att_rec_tenant1_2026-08_teachers__all';
        helper.emsCacheGet = function () { return PERIOD_ONLY_WITH_EMPTY_RECORDS; };
        return helper.emsAttReadSheetByKeyAsync(key).then(function (sheet) {
            expect(sheet).not.toBeNull();
            expect(Object.keys(sheet.periodRecords || {}).length).toBeGreaterThan(0);
        });
    });

    it('source: attLoadRegisterLocalFirst gate uses attHasMeaningfulAttendanceData', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = js.indexOf('function attLoadRegisterLocalFirst');
        var block = js.slice(start, js.indexOf('\nfunction attCollectTargetsFromRepoRelaxed', start));
        expect(block).toMatch(/attHasMeaningfulAttendanceData\(localRec\)/);
    });

    it('source: attBackgroundReconcile uses attHasMeaningfulAttendanceData for remote', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = js.indexOf('function attBackgroundReconcile');
        var block = js.slice(start, js.indexOf('\nvar ATT_LEGACY_PERIOD_MERGE_KEY', start));
        expect(block).toMatch(/attHasMeaningfulAttendanceData\(remote\)/);
    });

    it('source: attendance-helper attReadSheetByKeyAsync uses meaningful-sheet helper', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        var start = js.indexOf('function attReadSheetByKeyAsync');
        var block = js.slice(start, js.indexOf('\n    global.emsOfflineLoadAttendanceSheetsForMonth', start));
        expect(block).toMatch(/attHelperHasMeaningfulSheet/);
    });
});
