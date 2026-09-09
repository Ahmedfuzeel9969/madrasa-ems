import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function read(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('Attendance events — sheet then mark flow', function () {
  it('HTML has sheets list, builder, and marking panels', function () {
    const html = read('index.html');
    expect(html).toContain('id="evt-sheets-home"');
    expect(html).toContain('id="evt-sheet-builder"');
    expect(html).toContain('id="evt-marking-panel"');
    expect(html).toContain('id="btn-save-event-sheet"');
    expect(html).toContain('id="btn-save-event-att"');
    expect(html).toContain('نئی شیٹ بنائیں');
    expect(html).toContain("evtBulkSelect('teachers_students_staff')");
    expect(html).toContain('evtBulkSelectByClasses');
  });

  it('JS opens marking on sheet click and saves sheet separately', function () {
    const js = read('attendance.js');
    expect(js).toContain('window.openEventSheet');
    expect(js).toContain('evtOpenSheetBuilder');
    expect(js).toContain('btn-save-event-sheet');
    expect(js).toContain("mode === 'builder'");
    expect(js).toContain("mode === 'marking'");
    expect(js).toContain('evtBackToSheetsList');
    expect(js).toContain('editEventRosterFromMarking');
  });
});
