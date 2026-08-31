import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Teacher timetable period boxes in smart register', function () {
    it('wires periodRecords + teacher period helpers', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain('periodRecords');
        expect(js).toContain('function attTeacherPeriodsForWeekday');
        expect(js).toContain('function attBuildTeacherPeriodBoxesHtml');
        expect(js).toContain('window.setTeacherAllPeriods');
        expect(js).toContain('window.cycleTeacherPeriodStatus');
        expect(js).toContain('attRollupPeriodDayStatus');
        expect(js).toMatch(/attDiffPeriodRecordsPatch|diffDayMapField\('periodRecords'\)/);
    });

    it('keeps legacy day controls for teachers', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain('یومیہ حاضری (پرانا سسٹم)');
        expect(js).toContain('att-period-bulk');
        expect(js).toMatch(/setCellStatus[\s\S]{0,400}attApplyStatusToAllTeacherPeriods/);
    });

    it('rolls period marks into legacy day status', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var statusStart = src.indexOf('function attStatusKind');
        var statusEnd = src.indexOf('\nfunction attReadTimetablePeriods', statusStart);
        var start = src.indexOf('function attRollupPeriodDayStatus');
        var end = src.indexOf('\nfunction attEnsurePeriodDayMap');
        expect(statusStart).toBeGreaterThan(-1);
        expect(start).toBeGreaterThan(-1);
        var fnSrc = src.slice(statusStart, statusEnd) + '\n' + src.slice(start, end);
        var sandbox = { window: {} };
        vm.runInNewContext(fnSrc + '\nthis.attRollupPeriodDayStatus = attRollupPeriodDayStatus;', sandbox);
        var sym = { P: 'P', A: 'A', L: 'L' };
        expect(sandbox.attRollupPeriodDayStatus({ a: 'P', b: 'P' }, sym)).toBe('P');
        expect(sandbox.attRollupPeriodDayStatus({ a: 'ح', b: 'P' }, sym)).toBe('P');
        expect(sandbox.attRollupPeriodDayStatus({ a: 'غ', b: 'A' }, sym)).toBe('A');
        expect(sandbox.attRollupPeriodDayStatus({ a: 'ر', b: 'L' }, sym)).toBe('L');
        expect(sandbox.attRollupPeriodDayStatus({ a: 'P', b: 'A' }, sym)).toBe('جزوی حاضری');
        expect(sandbox.attRollupPeriodDayStatus({ a: 'L', b: 'L' }, sym)).toBe('L');
        expect(sandbox.attRollupPeriodDayStatus({}, sym)).toBe('');
        expect(sandbox.attRollupPeriodDayStatus({ a: 'P' }, sym, ['a', 'b'])).toBe('نامکمل');
    });

    it('shows historical Urdu marks with the current device symbols', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = src.indexOf('function attStatusKind');
        var end = src.indexOf('\nfunction attReadTimetablePeriods', start);
        var sandbox = { window: {} };
        vm.runInNewContext(src.slice(start, end), sandbox);
        var sym = { P: 'P', A: 'A', L: 'L' };
        expect(sandbox.attDisplayStatus('ح', sym)).toBe('P');
        expect(sandbox.attDisplayStatus('غ', sym)).toBe('A');
        expect(sandbox.attDisplayStatus('ر', sym)).toBe('L');

        var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
        expect(css).toMatch(/td\.col-locked \.print-status-text\s*\{[\s\S]{0,220}display:\s*inline-block/);
    });

    it('filters timetable periods by teacher and weekday', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = src.indexOf('function attReadTimetablePeriods');
        var end = src.indexOf('\nfunction attIsTeacherRegister');
        expect(start).toBeGreaterThan(-1);
        var fnSrc = src.slice(start, end);
        var periods = [
            { id: 'PRD-1', teacherId: 'T1', days: [1, 3], start: '08:00', name: 'A' },
            { id: 'PRD-2', teacherId: 'T1', days: [2], start: '09:00', name: 'B' },
            { id: 'PRD-3', teacherId: 'T2', days: [1], start: '08:00', name: 'C' },
            { id: 'PRD-4', teacherId: '', teacherName: 'علی', days: [1], start: '10:00', name: 'D' }
        ];
        var sandbox = {
            localStorage: {
                getItem: function () { return JSON.stringify(periods); },
                setItem: function () {}
            },
            currentAttState: null,
            attGetUsers: function () { return []; },
            attFilterEligibleUsers: function (list) { return list || []; },
            attUserMatchesType: function () { return false; },
            attPersistConfigBlob: function () { return Promise.resolve(); },
            ATT_PERIODS_KEY: 'ems_att_periods',
            console: { info: function () {} }
        };
        sandbox.window = sandbox;
        vm.runInNewContext(
            fnSrc + '\nthis.attTeacherPeriodsForWeekday = attTeacherPeriodsForWeekday;',
            sandbox
        );
        var mon = sandbox.attTeacherPeriodsForWeekday('T1', 'علی', 1);
        expect(mon.map(function (p) { return p.id; })).toEqual(['PRD-1']);
        var tue = sandbox.attTeacherPeriodsForWeekday('T1', '', 2);
        expect(tue.map(function (p) { return p.id; })).toEqual(['PRD-2']);
    });
});
