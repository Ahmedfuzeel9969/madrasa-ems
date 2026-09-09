import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function read(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('Attendance events — role + class bulk select', function () {
  it('adds teachers+students+staff bulk and class multi-select UI', function () {
    const html = read('index.html');
    expect(html).toContain("evtBulkSelect('teachers_students_staff')");
    expect(html).toContain('اساتذہ + طلباء + عملہ');
    expect(html).toContain('id="evt-include-classes"');
    expect(html).toContain('id="evt-class-all"');
    expect(html).toContain('evtBulkSelectByClasses');
    expect(html).toContain("evtBulkSelect('all')");
    expect(html).toContain('evt-exclude-class');
  });

  it('implements class-scoped students/teachers selection helpers', function () {
    const js = read('attendance.js');
    expect(js).toContain("group === 'teachers_students_staff'");
    expect(js).toContain('evtBulkSelectByClasses');
    expect(js).toContain('evtTeacherIdsForClasses');
    expect(js).toContain('evtPopulateIncludeClasses');
    expect(js).toContain('evtToggleAllClasses');
  });
});
