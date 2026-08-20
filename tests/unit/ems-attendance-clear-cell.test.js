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

    it('does not let equal-timestamp cloud revive cleared local marks', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toMatch(/attRecordTimestamp\(remoteData\)\s*>\s*localTs/);
        expect(js).toContain('_localWriteTs: writeTs');
        expect(js).toMatch(/Local SSOT wins on equal\/older remote/);
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
});
