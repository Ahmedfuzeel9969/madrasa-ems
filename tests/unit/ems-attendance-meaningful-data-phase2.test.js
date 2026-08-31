import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

var PERIOD_ONLY_SHEET = {
    locked: false,
    dailyLocks: {},
    periodRecords: {
        'teacher-uid-1': { '5': { 'period-1': 'P' } }
    }
};

var COMBINED_SHEET = {
    timestamp: 1700000001000,
    records: { 'teacher-uid-1': { '5': 'P' } },
    periodRecords: { 'teacher-uid-1': { '5': { 'period-1': 'P' } } }
};

var CLEARED_SHEET = {
    timestamp: 1700000002000,
    records: {},
    periodRecords: {}
};

var EMPTY_SHEET = {
    locked: false,
    records: {},
    dailyLocks: {},
    periodRecords: {}
};

function loadMeaningfulHelpers() {
    var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var pruneStart = src.indexOf('function attPrunePeriodRecordsMap');
    var pruneEnd = src.indexOf('\nvar ATT_ROLLUP_PARTIAL');
    var emptyStart = src.indexOf('function attEmptyAttendanceRecord');
    var reconcileEnd = src.indexOf('\nfunction attApplyAttendanceState');
    var fnSrc = src.slice(pruneStart, pruneEnd)
        + '\n' + src.slice(emptyStart, reconcileEnd);
    var sandbox = {};
    vm.runInNewContext(
        fnSrc
        + '\nthis.attHasMeaningfulAttendanceData = attHasMeaningfulAttendanceData;'
        + '\nthis.attNormalizeRecord = attNormalizeRecord;'
        + '\nthis.attReconcileAttendanceRecord = attReconcileAttendanceRecord;'
        + '\nthis.attRecordTimestamp = attRecordTimestamp;',
        sandbox
    );
    return sandbox;
}

function loadHelperReader() {
    var meaningful = loadMeaningfulHelpers();
    var src = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
    var sandbox = {
        global: {},
        window: {},
        Promise: Promise,
        firebase: { auth: function () { return { currentUser: null }; } },
        localStorage: { getItem: function () { return null; } },
        CURRENT_MADRASA_TENANT_ID: 'tenant1',
        attHasMeaningfulAttendanceData: meaningful.attHasMeaningfulAttendanceData,
        emsCacheGet: function () { return null; },
        emsIdbKvGet: function () { return Promise.resolve(null); }
    };
    sandbox.global = sandbox;
    sandbox.window = sandbox;
    vm.runInNewContext(src, sandbox);
    return sandbox.global;
}

describe('Phase 2 — attHasMeaningfulAttendanceData (TASK 2.1)', function () {
    it('recognizes periodRecords-only sheets', function () {
        var h = loadMeaningfulHelpers();
        expect(h.attHasMeaningfulAttendanceData(PERIOD_ONLY_SHEET)).toBe(true);
    });

    it('recognizes combined daily records + periodRecords', function () {
        var h = loadMeaningfulHelpers();
        expect(h.attHasMeaningfulAttendanceData(COMBINED_SHEET)).toBe(true);
    });

    it('recognizes timestamp-only cleared sheets as meaningful', function () {
        var h = loadMeaningfulHelpers();
        expect(h.attHasMeaningfulAttendanceData(CLEARED_SHEET)).toBe(true);
    });

    it('rejects empty scaffold sheets', function () {
        var h = loadMeaningfulHelpers();
        expect(h.attHasMeaningfulAttendanceData(EMPTY_SHEET)).toBe(false);
        expect(h.attHasMeaningfulAttendanceData(null)).toBe(false);
    });
});

describe('Phase 2 — load/reconcile paths (TASK 2.2)', function () {
    it('Smart Register local-first gate uses attHasMeaningfulAttendanceData', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = js.indexOf('function attLoadRegisterLocalFirst');
        var block = js.slice(start, js.indexOf('\nfunction attCollectTargetsFromRepoRelaxed', start));
        expect(block).toMatch(/attHasMeaningfulAttendanceData\(localRec\)/);
    });

    it('background reconcile accepts periodRecords-only remote via shared helper', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = js.indexOf('function attBackgroundReconcile');
        var block = js.slice(start, js.indexOf('\nvar ATT_LEGACY_PERIOD_MERGE_KEY', start));
        expect(block).toMatch(/attHasMeaningfulAttendanceData\(remote\)/);
        expect(block).not.toMatch(/!remote\.records \|\| !Object\.keys\(remote\.records\)/);
    });

    it('attReadSheetByKeyAsync loads periodRecords-only sheet from IDB', function () {
        var helper = loadHelperReader();
        helper.emsIdbKvGet = function () {
            return Promise.resolve(JSON.stringify(PERIOD_ONLY_SHEET));
        };
        return helper.emsAttReadSheetByKeyAsync('att_rec_tenant1_2026-08_teachers__all').then(function (sheet) {
            expect(sheet).not.toBeNull();
            expect(sheet.periodRecords['teacher-uid-1']['5']['period-1']).toBe('P');
        });
    });

    it('attReadSheetByKeyAsync loads periodRecords-only sheet from memory cache', function () {
        var helper = loadHelperReader();
        helper.emsCacheGet = function () { return PERIOD_ONLY_SHEET; };
        return helper.emsAttReadSheetByKeyAsync('att_rec_tenant1_2026-08_teachers__all').then(function (sheet) {
            expect(sheet).not.toBeNull();
        });
    });

    it('local reconcile keeps newer local over stale remote', function () {
        var h = loadMeaningfulHelpers();
        var local = h.attNormalizeRecord({
            timestamp: 2000,
            periodRecords: { t1: { '5': { p1: 'P' } } }
        });
        var remote = h.attNormalizeRecord({
            timestamp: 1000,
            periodRecords: { t1: { '5': { p1: 'A' } } }
        });
        var merged = h.attReconcileAttendanceRecord(local, remote);
        expect(merged.periodRecords.t1['5'].p1).toBe('P');
    });

    it('local reconcile applies newer remote when timestamp is higher', function () {
        var h = loadMeaningfulHelpers();
        var local = h.attNormalizeRecord({
            timestamp: 1000,
            periodRecords: { t1: { '5': { p1: 'P' } } }
        });
        var remote = h.attNormalizeRecord({
            timestamp: 3000,
            periodRecords: { t1: { '5': { p1: 'A' } } }
        });
        var merged = h.attReconcileAttendanceRecord(local, remote);
        expect(merged.periodRecords.t1['5'].p1).toBe('A');
    });

    it('equal-timestamp full cloud acknowledgement repairs an incomplete local snapshot', function () {
        var h = loadMeaningfulHelpers();
        var local = h.attNormalizeRecord({
            timestamp: 2000,
            periodRecords: { t1: { '5': { p1: 'P' } } }
        });
        var remote = h.attNormalizeRecord({
            timestamp: 2000,
            periodRecords: { t1: { '5': { p1: 'P', p2: 'A' } } }
        });
        var merged = h.attReconcileAttendanceRecord(local, remote);
        expect(merged.periodRecords.t1['5'].p2).toBe('A');
    });

    it('newer cleared local sheet still beats stale remote marks', function () {
        var h = loadMeaningfulHelpers();
        var local = h.attNormalizeRecord({ timestamp: 2001, records: {}, periodRecords: {} });
        var remote = h.attNormalizeRecord({
            timestamp: 2000,
            periodRecords: { t1: { '5': { p1: 'P' } } }
        });
        var merged = h.attReconcileAttendanceRecord(local, remote);
        expect(Object.keys(merged.periodRecords || {}).length).toBe(0);
    });

    it('attLoadCanonicalClassSheet uses shared meaningful-data helper', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = js.indexOf('function attLoadCanonicalClassSheet');
        var block = js.slice(start, js.indexOf('\nfunction attAdoptCanonicalIntoOpenRegister', start));
        expect(block).toMatch(/attHasMeaningfulAttendanceData\(local\)/);
    });

    it('helper report collector loads sheets via meaningful attReadSheetByKeyAsync', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        expect(js).toContain('function attHelperHasMeaningfulSheet');
        expect(js).toMatch(/attReadSheetByKeyAsync[\s\S]{0,400}attHelperHasMeaningfulSheet/);
        var reportStart = js.indexOf('global.emsAttCollectReportSheetsAsync');
        var reportBlock = js.slice(reportStart, reportStart + 900);
        expect(reportBlock).toMatch(/emsAttCollectMonthSheetsAsync/);
    });
});
