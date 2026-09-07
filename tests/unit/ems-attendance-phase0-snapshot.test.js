import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const phase0 = require('../../scripts/attendance-phase0-snapshot');

function fakeDoc(id, data) {
  return { id: id, data: function () { return data; } };
}

describe('Attendance Phase 0 preservation snapshot', function () {
  it('parses only canonical all-register IDs as canonical', function () {
    expect(phase0.parseAttendanceId('att_rec_2026-08_students_Class-A_all')).toMatchObject({
      month: '2026-08', type: 'students', classId: 'Class-A', periodId: 'all', canonical: true
    });
    expect(phase0.parseAttendanceId('att_rec_2026-08_students_Class-A_PRD-1')).toMatchObject({
      periodId: 'PRD-1', canonical: false
    });
  });

  it('counts canonical and legacy attendance without mutating documents', function () {
    var canonical = {
      records: { S1: { 1: 'P', 2: 'A' } },
      periodRecords: { S1: { 1: { 'PRD-1': 'P' } } }
    };
    var legacy = { records: { S1: { 1: 'P' } } };
    var snap = {
      size: 2,
      docs: [
        fakeDoc('att_rec_2026-08_students_Class-A_all', canonical),
        fakeDoc('att_rec_2026-08_students_Class-A_PRD-1', legacy)
      ]
    };
    var result = phase0.summarizeAttendance(snap);
    expect(result.documentCount).toBe(2);
    expect(result.canonicalDocumentCount).toBe(1);
    expect(result.legacyDocumentCount).toBe(1);
    expect(result.dailyMarksCanonical).toBe(2);
    expect(result.dailyMarksAll).toBe(3);
    expect(result.periodMarksCanonical).toBe(1);
    expect(result.attendanceDates).toEqual(['2026-08-01', '2026-08-02']);
    expect(canonical.records.S1[1]).toBe('P');
  });

  it('uses deterministic checksums independent of object key order', function () {
    var left = phase0.stableStringify({ b: 2, a: { y: 2, x: 1 } });
    var right = phase0.stableStringify({ a: { x: 1, y: 2 }, b: 2 });
    expect(left).toBe(right);
    expect(phase0.sha256(left)).toBe(phase0.sha256(right));
  });

  it('parses nested and string timetable payloads', function () {
    var rows = [{ id: 'PRD-1' }, { id: 'PRD-2' }];
    expect(phase0.parseTimetableList({ data: JSON.stringify(rows) })).toEqual(rows);
    expect(phase0.parseTimetableList({ data: { data: JSON.stringify(rows) } })).toEqual(rows);
  });
});
