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

  it('renames module to حاضری مطالعہ and exposes reports from sheets', function () {
    const html = read('index.html');
    expect(html).toContain('حاضری مطالعہ');
    expect(html).toContain('id="evt-reports-view"');
    expect(html).toContain('id="btn-evt-open-reports"');
    expect(html).toContain('id="btn-evt-generate-report"');
    expect(html).toContain('evtGenerateReport');
    expect(html).toContain('id="evt-rep-from"');
    expect(html).toContain('id="evt-rep-sheets"');
    expect(html).not.toMatch(/onclick="switchAttTab\('att-event-register'[^"]*"\)"><i class="fas fa-star"><\/i> تقریبات/);
  });

  it('HTML has multi-date marking and read-only month register', function () {
    const html = read('index.html');
    expect(html).toContain('id="evt-mark-date"');
    expect(html).toContain('evtOnMarkDateChange');
    expect(html).toContain('id="evt-month-view"');
    expect(html).toContain('id="evt-view-month"');
    expect(html).toContain('id="evt-view-sheets"');
    expect(html).toContain('id="evt-view-all-sheets"');
    expect(html).toContain('ماہانہ رجسٹر (صرف دیکھیں)');
    expect(html).toContain('evtLoadMonthRegister');
    expect(html).not.toContain('id="evt-date"');
  });

  it('JS opens marking on sheet click and saves sheet separately', function () {
    const js = read('attendance.js');
    expect(js).toContain('window.openEventSheet');
    expect(js).toContain('evtOpenSheetBuilder');
    expect(js).toContain('btn-save-event-sheet');
    expect(js).toContain("mode === 'builder'");
    expect(js).toContain("mode === 'marking'");
    expect(js).toContain("mode === 'month'");
    expect(js).toContain("mode === 'reports'");
    expect(js).toContain('evtBackToSheetsList');
    expect(js).toContain('editEventRosterFromMarking');
  });

  it('JS stores sheets+sessions v2 and supports date change + month view + reports', function () {
    const js = read('attendance.js');
    expect(js).toContain('version: 2');
    expect(js).toContain('attSaveEventSheet');
    expect(js).toContain('evtMigrateLegacyArray');
    expect(js).toContain('evtOnMarkDateChange');
    expect(js).toContain('evtLoadMarkingForDate');
    expect(js).toContain('evtOpenMonthView');
    expect(js).toContain('evtLoadMonthRegister');
    expect(js).toContain('evtToggleViewAllSheets');
    expect(js).toContain('evtFindSession');
    expect(js).toContain('evtOpenReports');
    expect(js).toContain('evtGenerateReport');
    expect(js).toContain('evtPrintReport');
  });

  it('reports include درجہ وار browse from study sheet sessions', function () {
    const html = read('index.html');
    expect(html).toContain('id="evt-rep-summary-pane"');
    expect(html).toContain('id="evt-rep-browse-pane"');
    expect(html).toContain('id="evt-browse-class-list"');
    expect(html).toContain('id="evt-browse-record-wrap"');
    expect(html).toContain('name="evt_browse_cal"');
    expect(html).toContain("evtSetReportSubMode('browse')");
    expect(html).toContain('درجہ وار ریکارڈ');

    const js = read('attendance.js');
    expect(js).toContain('window.evtSetReportSubMode');
    expect(js).toContain('window.evtBrowseOpenStudent');
    expect(js).toContain('window.evtBrowseRefreshCalendar');
    expect(js).toContain('evtBrowseCollectStudentMarks');
    expect(js).toContain('attCollectiveCountMarksByBucket');
    expect(js).toContain('evtBrowseBucketMarks');
  });
});
