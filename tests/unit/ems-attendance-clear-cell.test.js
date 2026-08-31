import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Attendance smart-register clear cell', function () {
    it('reads previous sheet from durable storage (not localStorage-only)', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toMatch(/function attReadSheetLocal[\s\S]*?emsDurableReadRaw/);
        expect(js).toContain('attMergeCloudPatches');
        expect(js).toContain('attDeleteDayEntry');
        expect(js).toContain('attPruneDayStatusMap');
    });

    it('converts null clear patches to FieldValue.delete on flush', function () {
        var js = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(js).toMatch(/flushAttendancePatchRow[\s\S]*?FieldValue\.delete\(\)/);
        expect(js).toMatch(/attendance_patch[\s\S]*?mergeAttendancePatchPayload/);
    });

    it('cloud patch marks deleted days as null so Firestore can clear them', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = src.indexOf('function attMergeCloudPatches');
        var end = src.indexOf('\nfunction attPauseDictObserver');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        var fnSrc = src.slice(start, end);
        var sandbox = { console: console };
        vm.runInNewContext(fnSrc + '\nthis.attComputeSheetCloudPatch = attComputeSheetCloudPatch;', sandbox);
        var patch = sandbox.attComputeSheetCloudPatch(
            { records: { u1: { '5': 'P', '6': 'A' } }, timestamp: 1 },
            { records: { u1: { '6': 'A' } }, timestamp: 2 }
        );
        expect(patch['records.u1.5']).toBe(null);
        expect(patch['records.u1.6']).toBeUndefined();
        expect(patch.timestamp).toBe(2);
    });

    it('merge keeps earlier clear when a later edit only changes another day', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = src.indexOf('function attMergeCloudPatches');
        var end = src.indexOf('\n/** Remove a day key');
        expect(start).toBeGreaterThan(-1);
        var fnSrc = src.slice(start, end);
        var sandbox = {};
        vm.runInNewContext(fnSrc + '\nthis.attMergeCloudPatches = attMergeCloudPatches;', sandbox);
        var merged = sandbox.attMergeCloudPatches(
            { 'records.u1.5': null, timestamp: 1 },
            { 'records.u1.6': 'P', timestamp: 2 }
        );
        expect(merged['records.u1.5']).toBe(null);
        expect(merged['records.u1.6']).toBe('P');
        expect(merged.timestamp).toBe(2);
    });

    it('accepts equal-timestamp cloud acknowledgement but rejects older cloud state', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toMatch(/attRecordTimestamp\(remoteData\)\s*>=\s*localTs/);
        expect(js).toContain('_localWriteTs: writeTs');
        expect(js).toMatch(/newer offline\/local mutation stays authoritative/);
        expect(js).toMatch(/fully cleared/);
    });

    it('clear button forces granular Firebase delete paths like P/A/L sync', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var offline = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(js).toContain('attAppendForcedClearPatch');
        expect(js).toContain('clearCells: [{ uid: uid, day: day }]');
        expect(js).toContain('immediateCloud: true');
        expect(js).toContain('attRunPendingCloudPersist');
        expect(js).toMatch(/attAppendForcedClearPatch[\s\S]{0,800}periodRecords\.' \+ uid \+ '\.' \+ day/);
        expect(offline).toMatch(/set\(payload,\s*\{\s*merge:\s*false\s*\}\)/);
        expect(offline).toContain('FieldValue.delete()');
    });

    it('keeps every person in a multi-person forced clear patch', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = src.indexOf('function attMergeCloudPatches');
        var end = src.indexOf('\nfunction attPauseDictObserver');
        var sandbox = {};
        vm.runInNewContext(
            src.slice(start, end) + '\nthis.attAppendForcedClearPatch = attAppendForcedClearPatch;',
            sandbox
        );
        var patch = sandbox.attAppendForcedClearPatch(
            { records: { stale: true }, periodRecords: { stale: true } },
            [{ uid: 'S1', day: 7 }, { uid: 'S2', day: 7 }],
            { timestamp: 300, dailyLocks: {}, locked: false }
        );
        ['S1', 'S2'].forEach(function (uid) {
            expect(patch['records.' + uid + '.7']).toBe(null);
            expect(patch['remarks.' + uid + '.7']).toBe(null);
            expect(patch['late.' + uid + '.7']).toBe(null);
            expect(patch['periodRecords.' + uid + '.7']).toBe(null);
        });
        expect(patch.records).toBeUndefined();
        expect(patch.periodRecords).toBeUndefined();
        expect(patch.timestamp).toBe(300);
    });

    it('clears the complete day including hidden period marks and notes', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var deleteStart = src.indexOf('function attDeleteDayEntry');
        var deleteEnd = src.indexOf('\n/** Build Firestore field-path patch', deleteStart);
        var clearStart = src.indexOf('function attClearDayOnSheetData');
        var clearEnd = src.indexOf('\nwindow.attStudentPeriodsForWeekday', clearStart);
        var sandbox = {};
        vm.runInNewContext(
            src.slice(deleteStart, deleteEnd) + '\n' + src.slice(clearStart, clearEnd)
            + '\nthis.attClearDayOnSheetData = attClearDayOnSheetData;',
            sandbox
        );
        var data = {
            records: { S1: { '8': 'P', '9': 'A' } },
            remarks: { S1: { '8': 'نوٹ' } },
            late: { S1: { '8': '08:10' } },
            periodRecords: { S1: { '8': { active: 'P', archived: 'A' }, '9': { active: 'A' } } }
        };
        expect(sandbox.attClearDayOnSheetData(data, 'S1', 8)).toBe(true);
        expect(data.records.S1['8']).toBeUndefined();
        expect(data.remarks.S1['8']).toBeUndefined();
        expect(data.late.S1['8']).toBeUndefined();
        expect(data.periodRecords.S1['8']).toBeUndefined();
        expect(data.records.S1['9']).toBe('A');
        expect(data.periodRecords.S1['9'].active).toBe('A');
    });
});
