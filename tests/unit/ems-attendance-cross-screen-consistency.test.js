import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function source(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('Attendance cross-screen consistency', function () {
    it('recovers literal dotted Firestore fields without overwriting a current nested cell', function () {
        var helper = source('attendance-helper.js');
        var sandbox = {
            console: console,
            Promise: Promise,
            Date: Date,
            Intl: Intl,
            setTimeout: setTimeout,
            clearTimeout: clearTimeout
        };
        sandbox.global = sandbox;
        sandbox.window = sandbox;
        vm.runInNewContext(helper, sandbox);
        var normalized = sandbox.emsNormalizeAttendanceCloudDocument({
            records: { TCH1: { '1': 'P' } },
            'records.TCH1.1': 'A',
            'records.TCH1.2': 'P',
            'periodRecords.TCH1.2.PRD1': 'A'
        });
        expect(normalized.records.TCH1['1']).toBe('P');
        expect(normalized.records.TCH1['2']).toBe('P');
        expect(normalized.periodRecords.TCH1['2'].PRD1).toBe('A');
        expect(normalized['records.TCH1.2']).toBeUndefined();
        expect(normalized['periodRecords.TCH1.2.PRD1']).toBeUndefined();
    });

    it('uses the same fresh month collector for dashboard and reports', function () {
        var helper = source('attendance-helper.js');
        var dash = source('att-dashboard.js');
        expect(helper).toContain('global.emsAttEnsureMonthFresh');
        expect(helper).toContain('global.emsAttCollectMonthSheetsAsync');
        expect(helper).toMatch(/emsAttCollectReportSheetsAsync[\s\S]*?emsAttCollectMonthSheetsAsync/);
        expect(dash).toMatch(/attDashCollectSheetsAsync[\s\S]*?emsAttCollectMonthSheetsAsync/);
    });

    it('keeps legacy sheets for recovery but excludes them from daily readers once canonical exists', function () {
        var helper = source('attendance-helper.js');
        var sandbox = { console: console, Promise: Promise, Date: Date, Intl: Intl };
        sandbox.global = sandbox;
        sandbox.window = sandbox;
        vm.runInNewContext(helper, sandbox);
        var rows = sandbox.emsAttCanonicalMonthRows([
            { key: 'teacher-canon', type: 'teachers', classId: '', period: 'all', data: { timestamp: 20 } },
            { key: 'teacher-old', type: 'teachers', classId: 'اولی', period: 'all', data: { timestamp: 10 } },
            { key: 'student-canon', type: 'students', classId: 'اولی', period: 'all', data: { timestamp: 20 } },
            { key: 'student-old-hour', type: 'students', classId: 'اولی', period: 'P1', data: { timestamp: 10 } },
            { key: 'legacy-only', type: 'students', classId: 'ثانیہ', period: 'P2', data: { timestamp: 5 } }
        ]);
        expect(Array.from(rows, function (row) { return row.key; })).toEqual([
            'teacher-canon', 'student-canon', 'legacy-only'
        ]);
    });

    it('refreshes Smart and Collective canonical sheets before reading local cache', function () {
        var att = source('attendance.js');
        var smartStart = att.indexOf('function attLoadRegisterLocalFirst');
        var smartEnd = att.indexOf('\nfunction attCollectTargetsFromRepoRelaxed', smartStart);
        var collectiveStart = att.indexOf('function attLoadCanonicalClassSheet');
        var collectiveEnd = att.indexOf('\n/** True when a teacher', collectiveStart);
        expect(att.slice(smartStart, smartEnd)).toMatch(/emsAttEnsureMonthFresh[\s\S]*?attAdoptLegacyPeriodSheets/);
        expect(att.slice(collectiveStart, collectiveEnd)).toMatch(/emsAttEnsureMonthFresh[\s\S]*?emsOfflineGetCachedAttendance/);
        expect(att.slice(collectiveStart, collectiveEnd)).toContain("attAdoptLegacyPeriodSheets(keys, month, type, '')");
    });

    it('never lets old period sheets refill an already covered canonical register', function () {
        var att = source('attendance.js');
        var start = att.indexOf('function attAdoptLegacyPeriodSheets');
        var end = att.indexOf('\nfunction attLoadRegisterLocalFirst', start);
        var block = att.slice(start, end);
        expect(block).toContain('canonicalHadPeriodCoverage');
        expect(block).toMatch(/if \(canonicalHadPeriodCoverage\) return/);
        expect(block).toMatch(/legacySheets\.sort[\s\S]*?attRecordTimestamp/);
    });

    it('accepts a complete equal-timestamp cloud document during month refresh', async function () {
        var helper = source('attendance-helper.js');
        var start = helper.indexOf('function fetchAttendanceDocsForMonth');
        var end = helper.indexOf('\n    /** Prefer AttendanceSummary', start);
        var cached = null;
        var remote = {
            timestamp: 2000,
            periodRecords: { t1: { '5': { p1: 'P', p2: 'A' } } }
        };
        var local = {
            timestamp: 2000,
            periodRecords: { t1: { '5': { p1: 'P' } } }
        };
        var doc = { id: 'att_rec_2026-08_teachers__all', data: function () { return remote; } };
        var snap = { forEach: function (fn) { fn(doc); } };
        var col = {
            where: function () { return this; },
            get: function () { return Promise.resolve(snap); }
        };
        var sandbox = {
            console: console,
            Promise: Promise,
            Date: Date,
            firebase: { firestore: { FieldPath: { documentId: function () { return '__name__'; } } } },
            emsFirestoreSubColRef: function () { return col; },
            emsOfflineGetCachedAttendance: function () { return Promise.resolve(local); },
            emsOfflineCacheAttendanceFromRemote: function (id, data) { cached = data; return Promise.resolve({ ok: true }); },
            emsAttOfflineKeyIndexInvalidate: function () {},
            emsInvalidateAttDashboardCache: function () {}
        };
        sandbox.global = sandbox;
        sandbox.window = sandbox;
        var prelude = [
            'function getTenantId() { return "tenant1"; }',
            'function getDb() { return {}; }',
            'function shouldUseFirestore() { return true; }',
            'function attSheetTimestamp(x) { return Number(x && x.timestamp) || 0; }',
            'function attNormalizeAttendanceCloudDocument(x) { return x; }',
            'function attLocalKeyFromCloudDocId(tid, id) { return "att_rec_" + tid + "_" + id.slice(8); }'
        ].join('\n');
        vm.runInNewContext(prelude + '\n' + helper.slice(start, end), sandbox);
        var result = await sandbox.emsAttEnsureMonthFresh('2026-08', { force: true });
        expect(result.ok).toBe(true);
        expect(cached.periodRecords.t1['5'].p2).toBe('A');
    });

    it('does not let automatic month refresh overwrite a pending local delete', async function () {
        var helper = source('attendance-helper.js');
        var start = helper.indexOf('function fetchAttendanceDocsForMonth');
        var end = helper.indexOf('\n    /** Prefer AttendanceSummary', start);
        var cached = null;
        var remote = { timestamp: 2000, records: { t1: { '5': 'P' } } };
        var local = { timestamp: 2001, records: {} };
        var doc = { id: 'att_rec_2026-08_teachers__all', data: function () { return remote; } };
        var snap = { forEach: function (fn) { fn(doc); } };
        var col = { where: function () { return this; }, get: function () { return Promise.resolve(snap); } };
        var sandbox = {
            console: console,
            Promise: Promise,
            Date: Date,
            firebase: { firestore: { FieldPath: { documentId: function () { return '__name__'; } } } },
            emsFirestoreSubColRef: function () { return col; },
            emsOfflineGetCachedAttendance: function () { return Promise.resolve(local); },
            emsOfflineCacheAttendanceFromRemote: function (id, data) { cached = data; return Promise.resolve(true); },
            attHasPendingCloudPersistForDoc: function () { return true; },
            emsAttOfflineKeyIndexInvalidate: function () {},
            emsInvalidateAttDashboardCache: function () {}
        };
        sandbox.global = sandbox;
        sandbox.window = sandbox;
        var prelude = [
            'function getTenantId() { return "tenant1"; }',
            'function getDb() { return {}; }',
            'function shouldUseFirestore() { return true; }',
            'function attSheetTimestamp(x) { return Number(x && x.timestamp) || 0; }',
            'function attNormalizeAttendanceCloudDocument(x) { return x; }',
            'function attLocalKeyFromCloudDocId(tid, id) { return "att_rec_" + tid + "_" + id.slice(8); }'
        ].join('\n');
        vm.runInNewContext(prelude + '\n' + helper.slice(start, end), sandbox);
        var result = await sandbox.emsAttEnsureMonthFresh('2026-08', { force: true });
        expect(result.ok).toBe(true);
        expect(result.pendingLocalKept).toBe(1);
        expect(cached).toBe(null);
    });

    it('collective teacher register includes already-saved hours even when the active weekday timetable changed', function () {
        var collective = source('att-collective.js');
        var attendance = source('attendance.js');
        expect(collective).toContain('attTeacherPeriodsForRegisterDay');
        expect(collective).toContain('savedPeriodMap');
        expect(attendance).toMatch(/function attTeacherPeriodsForRegisterDay\([^)]*savedPeriodMap/);
        expect(attendance).toContain('var pmap = savedPeriodMap ||');
    });

    it('collective whole-day clear deletes hidden hour maps and sends every clear cell', function () {
        var collective = source('att-collective.js');
        expect(collective).toContain('attClearDayOnSheetData');
        expect(collective).toContain('wholeDay: true');
        expect(collective).toContain('clearCellsBySheet');
        expect(collective).toContain('persistOpts.immediateCloud = true');
    });

    it('Smart Register uses the same canonical daily status as the dashboard', function () {
        var att = source('attendance.js');
        var start = att.indexOf('function attDisplayDayMark');
        var end = att.indexOf('\nfunction attEnsurePeriodDayMap', start);
        var sandbox = {
            window: { currentAttState: { period: 'all', periodRecords: { S1: { 4: { P1: 'A' } } } } },
            attGetAttSymbols: function () { return { P: 'P', A: 'A', L: 'L' }; },
            attDisplayStatus: function (value) { return value || ''; },
            attIsTeacherRegister: function () { return false; },
            attIsStaffAttendanceRegister: function () { return false; },
            attStudentPeriodsForRegisterDay: function () { return [{ id: 'P1' }]; },
            attRollupPeriodDayStatus: function () { return 'A'; }
        };
        vm.runInNewContext(att.slice(start, end) + '\nthis.attDisplayDayMark = attDisplayDayMark;', sandbox);
        expect(sandbox.attDisplayDayMark('S1', 4, 2, { fallback: 'P', className: 'اولی' })).toBe('P');
        sandbox.window.currentAttState.period = 'P2';
        expect(sandbox.attDisplayDayMark('S1', 4, 2, { fallback: 'P', className: 'اولی' })).toBe('');
    });
});

describe('Attendance timetable button wiring', function () {
    it('wires every visible timetable action to a real handler', function () {
        var html = source('index.html');
        var att = source('attendance.js');
        [
            'tt-view-teacher', 'tt-view-class',
            'tt-filter-teacher', 'tt-filter-class', 'tt-filter-book',
            'tt-filter-day', 'tt-filter-search', 'btn-save-add-more', 'btn-save-period'
        ].forEach(function (id) {
            expect(html).toContain('id="' + id + '"');
        });
        [
            'ttSetView', 'ttClearFilters', 'renderTimetable', 'attOpenNewPeriodModal',
            'editTimetablePeriod', 'deleteTimetablePeriod', 'ttTakeAttendance'
        ].forEach(function (name) {
            expect(att).toContain('window.' + name);
        });
        expect(att).toMatch(/closest\('#btn-save-period'\)/);
        expect(att).toMatch(/closest\('#btn-save-add-more'\)/);
        expect(att).toMatch(/attSavePeriodFromModal\(\{ closeAfter:/);
        expect(html).not.toContain('btn-att-tt-push-browser');
        expect(att).not.toContain('attPushBrowserTimetableToFirebase');
    });
});
