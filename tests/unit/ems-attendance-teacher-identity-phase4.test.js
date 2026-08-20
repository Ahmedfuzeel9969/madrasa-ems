import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadPeriodIdentityHelpers(overrides) {
    overrides = overrides || {};
    var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var uidStart = src.indexOf('function attGetUserId');
    var uidEnd = src.indexOf('\nfunction attGetUserClass');
    var periodStart = src.indexOf('function attReadTimetablePeriods');
    var periodEnd = src.indexOf('\nfunction attIsTeacherRegister');
    var fnSrc = src.slice(uidStart, uidEnd)
        + '\n' + src.slice(periodStart, periodEnd);

    var storage = overrides.periodsJson != null
        ? overrides.periodsJson
        : '[]';
    var sandbox = {
        localStorage: {
            _data: { ems_att_periods: storage, ems_att_custom_teachers: '[]' },
            getItem: function (k) { return this._data[k] != null ? this._data[k] : null; },
            setItem: function (k, v) { this._data[k] = v; }
        },
        currentAttState: overrides.currentAttState || null,
        attGetUsers: overrides.attGetUsers || function () { return []; },
        attFilterEligibleUsers: function (list) { return list || []; },
        attUserMatchesType: function (u, t) {
            return !!(u && String(u.type || '').toLowerCase() === String(t || '').toLowerCase());
        },
        attPersistConfigBlob: function () { return Promise.resolve(); },
        ATT_PERIODS_KEY: 'ems_att_periods',
        console: { info: function () {} }
    };
    sandbox.window = sandbox;

    vm.runInNewContext(
        fnSrc
        + '\nthis.attPeriodTeacherIdMatches = attPeriodTeacherIdMatches;'
        + '\nthis.attFindUniqueTeacherIdByName = attFindUniqueTeacherIdByName;'
        + '\nthis.attMigrateLegacyPeriodTeacherIds = attMigrateLegacyPeriodTeacherIds;'
        + '\nthis.attTeacherPeriodsForWeekday = attTeacherPeriodsForWeekday;'
        + '\nthis.attTeacherPeriodsForRegisterDay = attTeacherPeriodsForRegisterDay;'
        + '\nthis.attResolvePeriodById = attResolvePeriodById;'
        + '\nthis.attIsPeriodArchived = attIsPeriodArchived;'
        + '\nthis.attActiveTimetablePeriods = attActiveTimetablePeriods;'
        + '\nthis.attReadAllTimetablePeriodsRaw = attReadAllTimetablePeriodsRaw;'
        + '\nthis.attReadTimetablePeriods = attReadTimetablePeriods;'
        + '\nthis.attSaveTimetablePeriodsSync = attSaveTimetablePeriodsSync;',
        sandbox
    );
    return sandbox;
}

describe('Phase 4 — teacher identity (TASK 4.1)', function () {
    it('matches timetable periods by stable teacherId only at runtime', function () {
        var periods = [
            { id: 'PRD-1', teacherId: 'T1', days: [1], start: '08:00' },
            { id: 'PRD-2', teacherId: '', teacherName: 'علی', days: [1], start: '10:00' }
        ];
        var h = loadPeriodIdentityHelpers({
            periodsJson: JSON.stringify(periods)
        });
        var mon = h.attTeacherPeriodsForWeekday('T1', 'علی', 1);
        expect(mon.map(function (p) { return p.id; })).toEqual(['PRD-1']);
    });

    it('migrates legacy teacherName only when uniquely provable', function () {
        var periods = [{ id: 'PRD-X', teacherId: '', teacherName: 'احمد', days: [1] }];
        var h = loadPeriodIdentityHelpers({
            periodsJson: JSON.stringify(periods),
            attGetUsers: function () {
                return [
                    { id: 'REG-1', name: 'احمد', type: 'teacher' },
                    { id: 'REG-2', name: 'احمد', type: 'teacher' }
                ];
            }
        });
        expect(h.attMigrateLegacyPeriodTeacherIds(periods)).toBe(false);
        expect(periods[0].teacherId).toBe('');

        var unique = loadPeriodIdentityHelpers({
            periodsJson: JSON.stringify([{ id: 'PRD-Y', teacherId: '', teacherName: 'احمد', days: [1] }]),
            attGetUsers: function () {
                return [{ regId: 'REG-UNIQ', name: 'احمد', type: 'teacher' }];
            }
        });
        var list = JSON.parse(unique.localStorage.getItem('ems_att_periods'));
        expect(unique.attMigrateLegacyPeriodTeacherIds(list)).toBe(true);
        expect(list[0].teacherId).toBe('REG-UNIQ');
    });

    it('does not merge duplicate teacher names into one timetable slot', function () {
        var h = loadPeriodIdentityHelpers();
        expect(h.attFindUniqueTeacherIdByName('علی', [
            { id: 'A', name: 'علی', type: 'teacher' },
            { id: 'B', name: 'علی', type: 'teacher' }
        ])).toBe(null);
        expect(h.attPeriodTeacherIdMatches({ teacherId: 'A' }, 'B')).toBe(false);
    });
});

describe('Phase 4 — period history (TASK 4.2)', function () {
    it('soft-archives periods instead of removing them from storage', function () {
        var periods = [{ id: 'PRD-OLD', name: 'سبق', teacherId: 'T1', days: [1] }];
        var h = loadPeriodIdentityHelpers({ periodsJson: JSON.stringify(periods) });
        periods[0].archived = true;
        periods[0].archivedAt = 123;
        h.attSaveTimetablePeriodsSync(periods);

        expect(h.attReadTimetablePeriods().length).toBe(0);
        var resolved = h.attResolvePeriodById('PRD-OLD');
        expect(resolved).toBeTruthy();
        expect(h.attIsPeriodArchived(resolved)).toBe(true);
    });

    it('shows historical period boxes from periodRecords after period archive', function () {
        var periods = [{ id: 'PRD-HIST', name: 'پurana', teacherId: 'T1', days: [1], archived: true, archivedAt: 1 }];
        var h = loadPeriodIdentityHelpers({
            periodsJson: JSON.stringify(periods),
            currentAttState: {
                month: '2026-08',
                periodRecords: { T1: { '5': { 'PRD-HIST': 'P' } } }
            }
        });
        var boxes = h.attTeacherPeriodsForRegisterDay('T1', '', '5', 1);
        expect(boxes.map(function (p) { return p.id; })).toContain('PRD-HIST');
    });

    it('preserves period id on edit path in attSavePeriodFromModal wiring', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toMatch(/periodObj\.id = editedId/);
        expect(js).toMatch(/periods\[idx\] = Object\.assign\(\{\}, periods\[idx\], periodObj\)/);
        expect(js).toMatch(/archived:\s*true/);
        expect(js).not.toMatch(/nextPeriods = periods\.filter\(function \(p\) \{ return p\.id !== periodId; \}\)/);
    });
});
