import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadPeriodFilters(periods) {
  const source = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
  const block = source.slice(
    source.indexOf('function attTeacherPeriodsForWeekday'),
    source.indexOf('\nfunction attIsTeacherRegister')
  );
  const sandbox = {
    attReadTimetablePeriods: function () { return periods; },
    attPeriodTeacherIdMatches: function (period, teacherId) {
      return String(period.teacherId || '') === String(teacherId || '');
    }
  };
  vm.runInNewContext(
    block
      + '\nthis.attTeacherPeriodsForWeekday = attTeacherPeriodsForWeekday;'
      + '\nthis.attStudentPeriodsForWeekday = attStudentPeriodsForWeekday;'
      + '\nthis.attStudentPeriodsForRegisterDay = attStudentPeriodsForRegisterDay;',
    sandbox
  );
  return sandbox;
}

describe('نظام الاوقات — خالی دنوں کا مطلب روزانہ', function () {
  it('shows an empty-days teacher lesson on every weekday in Smart Register', function () {
    const env = loadPeriodFilters([
      { id: 'DAILY', teacherId: 'TCH-52', className: 'تجوید', start: '10:10', days: [] },
      { id: 'MONDAY', teacherId: 'TCH-52', className: 'تجوید', start: '11:00', days: [1] }
    ]);

    expect(Array.from(env.attTeacherPeriodsForWeekday('TCH-52', '', 4), p => p.id)).toEqual(['DAILY']);
    expect(Array.from(env.attTeacherPeriodsForWeekday('TCH-52', '', 1), p => p.id)).toEqual(['DAILY', 'MONDAY']);
  });

  it('uses the same daily meaning for student class periods', function () {
    const env = loadPeriodFilters([
      { id: 'DAILY', teacherId: 'TCH-52', className: 'تجوید', start: '10:10', days: [] },
      { id: 'SATURDAY', teacherId: 'TCH-52', className: 'تجوید', start: '11:00', days: [6] }
    ]);

    expect(Array.from(env.attStudentPeriodsForWeekday('تجوید', 2), p => p.id)).toEqual(['DAILY']);
    expect(Array.from(env.attStudentPeriodsForWeekday('تجوید', 6), p => p.id)).toEqual(['DAILY', 'SATURDAY']);
  });

  it('retains a saved old student hour so Smart and Collective can show or clear it', function () {
    const env = loadPeriodFilters([
      { id: 'ACTIVE', teacherId: 'TCH-52', className: 'تجوید', start: '10:10', days: [2] }
    ]);
    env.attResolvePeriodById = function () { return null; };
    const periods = env.attStudentPeriodsForRegisterDay('تجوید', 12, 2, {
      ACTIVE: 'P',
      OLD_ARCHIVED: 'A'
    });
    expect(Array.from(periods, p => p.id)).toEqual(['ACTIVE', 'OLD_ARCHIVED']);
    expect(periods[1].archived).toBe(true);
  });
});
