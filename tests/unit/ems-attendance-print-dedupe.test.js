import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadDashNormalizeApi() {
    var src = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
    var start = src.indexOf('function attDashReadDayObservation');
    var end = src.indexOf('function attDashApplyStatsKpis');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    var body = src.slice(start, end);

    // Minimal deps used by the extracted block
    var prelude = [
        'var localStorage = { getItem: function () { return null; } };',
        'function dayNumOf(dateStr) { return parseInt(String(dateStr || "").substring(8, 10), 10); }',
        'function attDashGetUserId(u) { return u && u.id ? String(u.id) : ""; }',
        'function attDashNormType(u) { return String(u && u.type || "student").toLowerCase(); }',
        'function attDashGetSymbols() { return { P: "P", A: "A", L: "L" }; }',
        'function attDashStatusPresent(st) { return st === "P" || st === "حاضر"; }',
        'function attDashStatusAbsent(st) { return st === "A" || st === "غائب"; }',
        'function attDashStatusLeave(st) { return st === "L" || st === "رخصت"; }',
        'function attDashSheetTimestamp(data) { return (data && data.timestamp) || 0; }',
        'function attDashComputeRate(present, absent, leave) {',
        '  var markedTotal = (present || 0) + (absent || 0) + (leave || 0);',
        '  if (markedTotal <= 0) return { rate: null, markedTotal: 0, notTaken: true };',
        '  return { rate: Math.min(100, Math.round(((present || 0) / markedTotal) * 100)), markedTotal: markedTotal, notTaken: false };',
        '}',
        'var console = globalThis.console;'
    ].join('\n');

    var sandbox = { console: console, globalThis: {} };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(
        prelude + '\n' + body + '\n'
        + 'this.attDashBuildFinalMarksForDay = attDashBuildFinalMarksForDay;'
        + 'this.attDashStatsFromFinalMarks = attDashStatsFromFinalMarks;'
        + 'this.attDashClassBreakdownFromFinal = attDashClassBreakdownFromFinal;'
        + 'this.attDashAssertStatsInvariant = attDashAssertStatsInvariant;',
        sandbox
    );
    return sandbox;
}

function makeRoster(n, className) {
    var users = [];
    for (var i = 1; i <= n; i++) {
        users.push({ id: 'S' + i, type: 'student', class: className || 'A' });
    }
    return users;
}

function sheet(opts) {
    return {
        key: opts.key || 'att_rec_x',
        type: opts.type || 'students',
        classId: opts.classId || 'A',
        period: opts.period == null ? 'all' : opts.period,
        data: {
            timestamp: opts.ts || 1000,
            records: opts.records || {}
        }
    };
}

describe('Attendance print/dashboard dedupe + final-state', function () {
    it('wires shared final-state helpers into dashboard', function () {
        var js = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        expect(js).toContain('function attDashBuildFinalMarksForDay');
        expect(js).toContain('function attDashStatsFromFinalMarks');
        expect(js).toContain('function attDashClassBreakdownFromFinal');
        expect(js).toContain('attDashAssertStatsInvariant');
        expect(js).toMatch(/localStats\.markedTotal > 0/);
        expect(js).toContain('attDashGetUsers()');
        expect(js).toContain('_attDashLastCalc');
    });

    it('2026-08-06 fixture: target 10 → P7/A2/L1; duplicates do not inflate class-wise', function () {
        var api = loadDashNormalizeApi();
        var dateStr = '2026-08-06';
        var users = makeRoster(10, 'A');
        var day = 6;
        var recordsAll = {};
        for (var i = 1; i <= 7; i++) recordsAll['S' + i] = { [day]: 'P' };
        recordsAll.S8 = { [day]: 'A' };
        recordsAll.S9 = { [day]: 'A' };
        recordsAll.S10 = { [day]: 'L' };

        // Duplicate period sheet with same marks (old bug double-counted class-wise)
        var recordsPeriod = JSON.parse(JSON.stringify(recordsAll));
        var sheets = [
            sheet({ key: 'all', period: 'all', ts: 2000, records: recordsAll }),
            sheet({ key: 'prd', period: 'PRD-1', ts: 1500, records: recordsPeriod })
        ];

        var final = api.attDashBuildFinalMarksForDay(dateStr, sheets, users);
        var stats = api.attDashStatsFromFinalMarks(final, users);
        var classRows = api.attDashClassBreakdownFromFinal(final, users);

        expect(stats.total).toBe(10);
        expect(stats.present).toBe(7);
        expect(stats.absent).toBe(2);
        expect(stats.leave).toBe(1);
        expect(stats.markedTotal).toBe(10);
        expect(stats.notMarked).toBe(0);
        expect(stats.present + stats.absent + stats.leave + stats.notMarked).toBe(stats.total);
        expect(stats.markedTotal).toBeLessThanOrEqual(stats.total);
        expect(stats.invariantBroken).toBeFalsy();

        expect(classRows.length).toBe(1);
        expect(classRows[0].total).toBe(10);
        expect(classRows[0].present).toBe(7);
        expect(classRows[0].absent).toBe(2);
        expect(classRows[0].leave).toBe(1);
        expect(classRows[0].present + classRows[0].absent + classRows[0].leave).toBe(10);

        // Exact calculated rows for 2026-08-06
        var rows = Object.keys(final.marks).sort().map(function (uid) {
            return { uid: uid, status: final.marks[uid].status || 'unmarked', classId: final.marks[uid].classId };
        });
        expect(rows.filter(function (r) { return r.status === 'P'; }).length).toBe(7);
        expect(rows.filter(function (r) { return r.status === 'A'; }).length).toBe(2);
        expect(rows.filter(function (r) { return r.status === 'L'; }).length).toBe(1);
    });

    it('matches register absent=2 (not summary absent=1) when all-sheet has two A', function () {
        var api = loadDashNormalizeApi();
        var users = makeRoster(10, 'A');
        var records = {};
        for (var i = 1; i <= 7; i++) records['S' + i] = { 6: 'P' };
        records.S8 = { 6: 'A' };
        records.S9 = { 6: 'A' };
        records.S10 = { 6: 'L' };
        // Stale cloud period sheet wrongly marks only one absent + extra presents
        var stale = JSON.parse(JSON.stringify(records));
        stale.S9 = { 6: 'P' }; // old wrong state
        var sheets = [
            sheet({ period: 'all', ts: 5000, records: records }),
            sheet({ period: 'PRD-x', ts: 1000, records: stale })
        ];
        var stats = api.attDashStatsFromFinalMarks(
            api.attDashBuildFinalMarksForDay('2026-08-06', sheets, users),
            users
        );
        expect(stats.absent).toBe(2);
        expect(stats.present).toBe(7);
    });

    it('clear/tombstone on newer period=all beats older period mark', function () {
        var api = loadDashNormalizeApi();
        var users = makeRoster(3, 'A');
        var sheets = [
            sheet({
                period: 'all',
                ts: 9000,
                records: {
                    S1: { 6: 'P' },
                    S2: {}, // cleared day 6
                    S3: { 6: 'L' }
                }
            }),
            sheet({
                period: 'PRD-old',
                ts: 1000,
                records: {
                    S1: { 6: 'P' },
                    S2: { 6: 'A' }, // stale cloud absent
                    S3: { 6: 'L' }
                }
            })
        ];
        var final = api.attDashBuildFinalMarksForDay('2026-08-06', sheets, users);
        var stats = api.attDashStatsFromFinalMarks(final, users);
        expect(final.marks.S2.status).toBe('');
        expect(stats.absent).toBe(0);
        expect(stats.present).toBe(1);
        expect(stats.leave).toBe(1);
        expect(stats.notMarked).toBe(1);
        expect(stats.present + stats.absent + stats.leave + stats.notMarked).toBe(3);
    });

    it('never allows P+A+L > target; flags invariant', function () {
        var api = loadDashNormalizeApi();
        var bad = api.attDashAssertStatsInvariant({
            present: 8,
            absent: 3,
            leave: 2,
            notMarked: 0,
            total: 10,
            markedTotal: 13
        }, 'test');
        expect(bad.invariantBroken).toBe(true);
        expect(bad.diagnosticError).toMatch(/marked\(13\) > target\(10\)/);
    });

    it('P/A/L are mutually exclusive per student in final marks', function () {
        var api = loadDashNormalizeApi();
        var users = makeRoster(2, 'A');
        var sheets = [
            sheet({ period: 'all', ts: 3000, records: { S1: { 6: 'P' }, S2: { 6: 'A' } } }),
            sheet({ period: 'PRD-1', ts: 2000, records: { S1: { 6: 'A' }, S2: { 6: 'L' } } })
        ];
        var final = api.attDashBuildFinalMarksForDay('2026-08-06', sheets, users);
        expect(final.marks.S1.status).toBe('P');
        expect(final.marks.S2.status).toBe('A');
        var stats = api.attDashStatsFromFinalMarks(final, users);
        expect(stats.present + stats.absent + stats.leave).toBeLessThanOrEqual(2);
    });
});
